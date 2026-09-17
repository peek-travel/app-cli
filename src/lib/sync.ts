import { createRequire } from "node:module";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { loadManifest, type Manifest, writeManifest } from "./manifest.js";
import { getRegistryApiUrl } from "./registry.js";
import { getAccessToken } from "./session.js";

// The registry client. Everything the CLI needs from the publisher API lives here, and the
// shape of that API is worth stating once:
//
//   POST /apps/:app_id/upsert     write a manifest onto a slug, creating the app if new
//   PUT  /apps/:app_id/base-url   set the origin relative extendable URLs resolve against
//   GET  /apps/:app_id/export     the bare manifest back out again (lossless round trip)
//   POST /apps/:app_id/test-apps  clone a test app off a source app
//   GET  /apps/:app_id/versions   versions, with their install links
//   POST /apps/:app_id/versions/:id/publish
//
// The app's slug is in the URL, never in the body — which is what lets one checked-in
// manifest be pushed at a production app and at a test app. base_url is its own endpoint
// for the same reason: the same manifest is served from a laptop tunnel, from staging and
// from production, and only the origin differs.
//
// ../../package.json resolves from both src/lib (tsx) and dist/lib (compiled).
const { version: CLI_VERSION } = createRequire(import.meta.url)("../../package.json") as { version: string };
const USER_AGENT = `peek-cli/${CLI_VERSION}`;
const PROD_PUBLISH_ERROR = "Auto-publish is not allowed in production without allow-prod=true";

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (!token) {
    throw new CLIError("Not signed in.", "Run `peek auth login` first.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
  };
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  debug?: boolean;
  // When set, a response with this status is returned to the caller instead of thrown, so
  // it can react (the prod-publish 403 is the only case).
  tolerate?: number;
}

interface Response_ {
  status: number;
  body: string;
}

async function request(options: RequestOptions): Promise<Response_> {
  const url = `${getRegistryApiUrl()}${options.path}`;
  if (options.debug) p.log.info(`${options.method} ${url}`);

  const response = await fetch(url, {
    method: options.method,
    headers:
      options.body === undefined
        ? authHeaders()
        : { ...authHeaders(), "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.text();

  if (options.debug) p.log.info(`HTTP ${response.status}\n${body}`);

  if (response.status >= 400 && response.status !== options.tolerate) {
    throw requestError(response.status, body);
  }

  return { status: response.status, body };
}

function parse<T>(body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new CLIError(`The registry returned a response that isn't JSON:\n${body.trim()}`);
  }
}

function detail(body: string): string {
  try {
    return (JSON.parse(body) as { errors?: { detail?: string } }).errors?.detail ?? "";
  } catch {
    return "";
  }
}

// Build the failure error with the FULL response body in the message so it survives
// every code path — oclif's default handler prints only .message, and callers like
// `peek init` don't render the suggestion. JSON bodies are pretty-printed; anything
// else (or an empty body) is shown verbatim.
function requestError(status: number, body: string): CLIError {
  let readable = body.trim();
  try {
    readable = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // not JSON — keep the raw text
  }
  return new CLIError(
    `Request failed with status ${status}${readable ? `\n${readable}` : " (empty response body)"}`,
  );
}

// ---------------------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------------------

export interface UpsertResult {
  // created | updated | published | no_change
  action: string;
  appId: string;
  manifest: Manifest;
  // Present only on a `created`: the registry mints the app's shared secret once and shows
  // it in that one response, never again. A caller that doesn't persist it loses it.
  sharedSecret?: string;
}

interface UpsertBody {
  data?: {
    action?: string;
    app?: { id?: string; shared_secret_key?: string };
    manifest?: Manifest;
    publish_error?: unknown;
  };
}

function upsertResult(body: string): UpsertResult {
  const parsed = parse<UpsertBody>(body).data ?? {};
  return {
    action: parsed.action ?? "unknown",
    appId: parsed.app?.id ?? "",
    manifest: parsed.manifest ?? {},
    sharedSecret: parsed.app?.shared_secret_key,
  };
}

export interface UpsertOptions {
  appId: string;
  manifest: Manifest;
  autoPublish: boolean;
  allowProd?: boolean;
  debug?: boolean;
  // Asked only when the registry refuses a blind production publish. Returning false
  // aborts; the default (no handler) aborts too.
  confirmProd?: () => Promise<boolean>;
}

// Write a manifest onto an app slug, creating the app if nothing has that slug yet.
export async function upsertManifest(options: UpsertOptions): Promise<UpsertResult> {
  const params = new URLSearchParams({ "auto-publish": String(options.autoPublish) });

  const send = (allowProd: boolean): Promise<Response_> => {
    const query = new URLSearchParams(params);
    if (allowProd) query.set("allow-prod", "true");
    return request({
      method: "POST",
      path: `/apps/${encodeURIComponent(options.appId)}/upsert?${query.toString()}`,
      body: options.manifest,
      debug: options.debug,
      tolerate: 403,
    });
  };

  let response = await send(options.allowProd ?? false);

  // A prod app rejects a blind auto-publish; the registry signals it with this exact 403.
  if (response.status === 403 && detail(response.body) === PROD_PUBLISH_ERROR) {
    p.log.warn("Auto-publishing this app would create a new production version.");
    if (!(options.confirmProd && (await options.confirmProd()))) {
      throw new CLIError("Aborted.");
    }
    p.log.step("Retrying with allow-prod=true...");
    response = await send(true);
  }

  if (response.status >= 400) throw requestError(response.status, response.body);

  return upsertResult(response.body);
}

// The manifest the registry holds. Defaults to the published version — the draft is what
// you get with `draft: true`, which is what a pull right after a push wants.
export async function exportManifest(
  appId: string,
  options: { draft?: boolean; debug?: boolean } = {},
): Promise<Manifest> {
  const query = options.draft ? "?include-draft=true" : "";
  const { body } = await request({
    method: "GET",
    path: `/apps/${encodeURIComponent(appId)}/export${query}`,
    debug: options.debug,
  });
  return parse<Manifest>(body);
}

// Point an app at the origin it is served from. Writes the draft, cloning a published
// version first — so it never edits a live version underneath its installs.
export async function setBaseUrl(appId: string, baseUrl: string | null, debug = false): Promise<void> {
  await request({
    method: "PUT",
    path: `/apps/${encodeURIComponent(appId)}/base-url`,
    body: { base_url: baseUrl },
    debug,
  });
}

export interface TestAppResult {
  testAppId: string;
  // Whether this call created the test app or handed back the existing one.
  created: boolean;
  // The registry mints the test app's shared secret once, at creation, and returns it in
  // THIS response only — a later upsert/publish never returns it again. The caller must
  // persist it now (to .env.local as PEEK_APP_SECRET) or the running app has no secret.
  sharedSecret?: string;
}

// Create (or hand back) the test app cloned from a source app. Idempotent per identifier,
// so the dev loop can call it every run and get the same environment.
//
// `baseUrl` matters only on the run that creates it: a test app goes out PUBLISHED so it can
// be installed straight away, and a published version whose extendable URLs are relative
// needs its origin in the same breath. Later runs move it with setBaseUrl.
export async function createTestApp(
  sourceAppId: string,
  options: { baseUrl?: string; debug?: boolean } = {},
): Promise<TestAppResult> {
  const { body } = await request({
    method: "POST",
    path: `/apps/${encodeURIComponent(sourceAppId)}/test-apps`,
    body: { identifier: "dev", base_url: options.baseUrl },
    debug: options.debug,
  });

  const result = upsertResult(body);
  if (!result.appId) {
    throw new CLIError("The test app response carried no app id at .data.app.id");
  }

  return {
    testAppId: result.appId,
    created: result.action === "created",
    sharedSecret: result.sharedSecret,
  };
}

export interface AppVersion {
  id: string;
  status: string;
  displayVersion: string;
  baseUrl: string | null;
  // App-store install links, keyed by platform. Test apps get sandbox links, everything
  // else prod. This is the CLI's only source for them — the manifest has no app_urls.
  appUrls: Record<string, string>;
  platforms: string[];
}

interface VersionBody {
  id: string;
  status: string;
  display_version: string;
  base_url: string | null;
  app_urls?: Record<string, string>;
  platforms?: string[];
}

function version(body: VersionBody): AppVersion {
  return {
    id: body.id,
    status: body.status,
    displayVersion: body.display_version,
    baseUrl: body.base_url,
    appUrls: body.app_urls ?? {},
    platforms: body.platforms ?? [],
  };
}

export async function listVersions(appId: string, debug = false): Promise<AppVersion[]> {
  const { body } = await request({
    method: "GET",
    path: `/apps/${encodeURIComponent(appId)}/versions`,
    debug,
  });
  return (parse<{ data?: VersionBody[] }>(body).data ?? []).map(version);
}

export async function publishVersion(
  appId: string,
  versionId: string,
  debug = false,
): Promise<AppVersion> {
  const { body } = await request({
    method: "POST",
    path: `/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(versionId)}/publish`,
    debug,
  });
  return version(parse<{ data: VersionBody }>(body).data);
}

// Publish whatever the app currently has in flight, and return the version that is now
// live. There is deliberately no "publish this manifest" call: pushing a manifest and
// setting a base_url both write the same draft, so the publish is a separate step that
// picks that draft up — and if there is nothing unpublished, the live version is the answer
// and we make no call at all.
export async function publishDraft(appId: string, debug = false): Promise<AppVersion> {
  const versions = await listVersions(appId, debug);
  // There is at most one draft per app, so it's unambiguous; a version parked mid-review
  // (publishing_requested / in_review / approved) is the next best thing to publish.
  const unpublished =
    versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status !== "published");

  if (!unpublished) {
    const published = versions.find((v) => v.status === "published");
    if (!published) {
      throw new CLIError(
        `${appId} has no version to publish.`,
        "Push a manifest first with `peek sync-app`.",
      );
    }
    return published;
  }

  return publishVersion(appId, unpublished.id, debug);
}

// ---------------------------------------------------------------------------------------
// `peek sync-app` — the manual push/pull of a manifest file
// ---------------------------------------------------------------------------------------

export interface SyncOptions {
  file: string;
  appId: string;
  autoPublish: boolean;
  pull: boolean;
  // Pull the draft instead of the published version.
  draft?: boolean;
  debug: boolean;
  // Skip the interactive "Continue?" confirm — used by `peek init`, which registers
  // a freshly-scaffolded app non-interactively. The prod-publish confirm still prompts.
  assumeYes?: boolean;
}

export interface SyncResult {
  appId: string;
  action?: string;
  // Present only when the registry minted a new secret this run — it's returned once and
  // never again, so the caller (e.g. `peek init`) must persist it now or it's lost.
  sharedSecret?: string;
}

async function confirm(message: string): Promise<boolean> {
  const answer = await p.confirm({ message, initialValue: false });
  return !p.isCancel(answer) && answer === true;
}

async function fileHasLocalChanges(file: string): Promise<boolean> {
  // Mirrors the reference's `git diff` guard so --pull can't silently clobber edits.
  for (const args of [["diff", "--quiet", file], ["diff", "--cached", "--quiet", file]]) {
    try {
      await execa("git", args);
    } catch (error) {
      // exit code 1 = differences; anything else (not a repo, git missing) → treat as clean
      if ((error as { exitCode?: number }).exitCode === 1) return true;
    }
  }
  return false;
}

async function pull(options: SyncOptions): Promise<void> {
  const dirty = await fileHasLocalChanges(options.file);
  const what = options.draft ? "draft" : "published version";

  p.log.info(
    [
      "Ready to pull from registry:",
      `  File to overwrite: ${options.file}`,
      `  App: ${options.appId}`,
      `  Registry: ${getRegistryApiUrl()}`,
      `  Source: the app's ${what}`,
    ].join("\n"),
  );

  if (dirty) {
    p.log.warn(`${options.file} has uncommitted changes that will be lost!`);
  }

  if (!options.assumeYes && !(await confirm(`Overwrite ${options.file} with the registry version?`))) {
    throw new CLIError("Aborted.");
  }

  const manifest = await exportManifest(options.appId, {
    draft: options.draft,
    debug: options.debug,
  });
  writeManifest(options.file, manifest);
  p.log.success(`Updated ${options.file} from registry`);
}

function announceSecret(secret: string): void {
  p.log.warn(
    [
      "IMPORTANT: A new shared secret key was generated!",
      `  → ${secret}`,
      "",
      "Save this secret in a secure place. It will NOT be shown again.",
      "",
      "Deployment:",
      "  • PRODUCTION: set as env var PEEK_APP_SECRET",
      "  • SANDBOX / LOCAL / DEV: shared sandbox secret; runtime falls back to it if unset",
    ].join("\n"),
  );
}

async function push(options: SyncOptions): Promise<SyncResult> {
  const { manifest, converted } = loadManifest(options.file);

  // An out-of-date manifest (legacy envelope, or the old "registry" key) is converted in
  // memory; write the current form back so the file the developer keeps matches what we
  // pushed and what a pull would return.
  if (converted) {
    writeManifest(options.file, manifest);
    p.log.step(`Migrated ${options.file} to the current manifest format`);
  }

  p.log.info(
    [
      "Ready to sync:",
      `  File: ${options.file}`,
      `  App: ${options.appId}`,
      `  Registry: ${getRegistryApiUrl()}`,
      `  Auto-publish: ${options.autoPublish}`,
    ].join("\n"),
  );

  if (!options.assumeYes && !(await confirm("Continue?"))) {
    throw new CLIError("Aborted.");
  }

  const result = await upsertManifest({
    appId: options.appId,
    manifest,
    autoPublish: options.autoPublish,
    debug: options.debug,
    confirmProd: () => confirm("Proceed with production publish?"),
  });

  // Only shout the "save this now, it won't be shown again" warning on a manual `peek
  // sync-app`, where the developer must persist the secret themselves. In the assumeYes
  // flows (init/dev) the caller saves it to .env.local and prints its own concise note — so
  // skip it here to avoid the mixed message.
  if (result.sharedSecret && !options.assumeYes) announceSecret(result.sharedSecret);

  // Write the registry's canonical manifest back to disk, so the file and the registry
  // agree byte for byte after a push.
  writeManifest(options.file, result.manifest);

  p.log.success(`Complete: action ${result.action}`);

  return { appId: options.appId, action: result.action, sharedSecret: result.sharedSecret };
}

export async function syncApp(options: SyncOptions): Promise<SyncResult> {
  if (options.debug) p.log.info(`App: ${options.appId}`);

  if (options.pull) {
    await pull(options);
    return { appId: options.appId };
  }

  return push(options);
}
