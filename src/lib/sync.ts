import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { getRegistryApiUrl } from "./registry.js";
import { getAccessToken } from "./session.js";

// An app.json carrying { data: { app: { id, ... } } } is the whole interface — this
// module handles every registry call on its behalf.
// ../../package.json resolves from both src/lib (tsx) and dist/lib (compiled).
const { version: CLI_VERSION } = createRequire(import.meta.url)("../../package.json") as { version: string };
const USER_AGENT = `peek-cli/${CLI_VERSION}`;
const PROD_PUBLISH_ERROR = "Auto-publish is not allowed in production without allow-prod=true";

export interface SyncOptions {
  file: string;
  autoPublish: boolean;
  pull: boolean;
  debug: boolean;
  // Skip the interactive "Continue?" confirm — used by `peek init`, which registers
  // a freshly-scaffolded app non-interactively. The prod-publish confirm still prompts.
  assumeYes?: boolean;
}

interface AppPayload {
  data?: { app?: { id?: string } };
}

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

function readAppFile(file: string): { raw: string; appId: string } {
  if (!existsSync(file)) {
    throw new CLIError(`${file} not found`);
  }

  const raw = readFileSync(file, "utf8");

  let parsed: AppPayload;
  try {
    parsed = JSON.parse(raw) as AppPayload;
  } catch {
    throw new CLIError(`${file} is not valid JSON`);
  }

  const appId = parsed.data?.app?.id;
  if (!appId) {
    throw new CLIError(`No app ID found in ${file} at .data.app.id`);
  }

  return { raw, appId };
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

async function pull(url: string, options: SyncOptions, appId: string): Promise<void> {
  const dirty = await fileHasLocalChanges(options.file);

  p.log.info(
    [
      "Ready to pull from registry:",
      `  File to overwrite: ${options.file}`,
      `  App ID: ${appId}`,
      `  Registry URL: ${url}`,
      `  Endpoint: /apps/${appId}/export`,
    ].join("\n"),
  );

  if (dirty) {
    p.log.warn(`${options.file} has uncommitted changes that will be lost!`);
  }

  if (!options.assumeYes && !(await confirm(`Overwrite ${options.file} with the registry version?`))) {
    throw new CLIError("Aborted.");
  }

  const exportUrl = `${url}/apps/${appId}/export`;
  if (options.debug) p.log.info(`GET ${exportUrl}`);

  const response = await fetch(exportUrl, { method: "GET", headers: authHeaders() });
  const body = await response.text();

  if (options.debug) {
    p.log.info(`HTTP ${response.status}\n${body}`);
  }

  if (!response.ok) {
    throw requestError(response.status, body);
  }

  writeFileSync(options.file, `${JSON.stringify(JSON.parse(body), null, 2)}\n`, "utf8");
  p.log.success(`Updated ${options.file} from registry`);
}

interface UpsertResult {
  status: number;
  body: string;
}

async function upsert(url: string, options: SyncOptions, allowProd: boolean): Promise<UpsertResult> {
  const params = new URLSearchParams({ "auto-publish": String(options.autoPublish) });
  if (allowProd) params.set("allow-prod", "true");
  const finalUrl = `${url}/apps/upsert?${params.toString()}`;

  if (options.debug) p.log.info(`POST ${finalUrl}`);

  const response = await fetch(finalUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: readFileSync(options.file, "utf8"),
  });

  return { status: response.status, body: await response.text() };
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

async function push(url: string, options: SyncOptions): Promise<{ action: string; sharedSecret?: string }> {
  p.log.info(
    [
      "Ready to sync:",
      `  File: ${options.file}`,
      `  Registry: ${url}`,
      `  Auto-publish: ${options.autoPublish}`,
    ].join("\n"),
  );

  if (!options.assumeYes && !(await confirm("Continue?"))) {
    throw new CLIError("Aborted.");
  }

  let result = await upsert(url, options, false);

  // A prod app rejects a blind auto-publish; the registry signals it with this exact 403.
  if (result.status === 403 && detail(result.body) === PROD_PUBLISH_ERROR) {
    p.log.warn("Auto-publishing this app would create a new production version.");
    if (!(await confirm("Proceed with production publish?"))) {
      throw new CLIError("Aborted.");
    }
    p.log.step("Retrying with allow-prod=true...");
    result = await upsert(url, options, true);
  }

  if (options.debug) {
    p.log.info(`HTTP ${result.status}\n${result.body}`);
  }

  if (result.status >= 400) {
    throw requestError(result.status, result.body);
  }

  const body = JSON.parse(result.body) as {
    data?: { action?: string; app?: { shared_secret_key?: string } };
  };

  const action = body.data?.action ?? "unknown";

  // Only shout the "save this now, it won't be shown again" warning on a manual `peek sync`,
  // where the developer must persist the secret themselves. In the assumeYes flows (init/dev)
  // the caller saves it to .env.local and prints its own concise note — so skip it here to
  // avoid the mixed message.
  const secret = body.data?.app?.shared_secret_key;
  if (secret && !options.assumeYes) announceSecret(secret);

  // Strip transient fields before writing the canonical payload back to disk.
  delete body.data?.action;
  if (body.data?.app) delete body.data.app.shared_secret_key;
  writeFileSync(options.file, `${JSON.stringify(body, null, 2)}\n`, "utf8");

  p.log.success(`Complete: action ${action}`);

  return { action, sharedSecret: secret };
}

export interface SyncResult {
  appId: string;
  action?: string;
  // Present only when the registry minted a new secret this run — it's returned once and
  // never again, so the caller (e.g. `peek init`) must persist it now or it's lost.
  sharedSecret?: string;
}

export async function syncApp(options: SyncOptions): Promise<SyncResult> {
  const url = getRegistryApiUrl();
  const { appId } = readAppFile(options.file);

  if (options.debug) p.log.info(`App ID: ${appId}`);

  if (options.pull) {
    await pull(url, options, appId);
    return { appId };
  }

  const { action, sharedSecret } = await push(url, options);
  return { appId, action, sharedSecret };
}

export interface CreateTestAppResult {
  testAppId: string;
  // The registry mints the test app's shared secret once, at creation, and returns it in
  // THIS response only — a later upsert/publish never returns it again. The caller must
  // persist it now (to .env.local as PEEK_APP_SECRET) or the running app has no secret.
  sharedSecret?: string;
}

// Create a test app for an already-registered source app and write the registry's export
// of it to destFile (the app-dev.json in the developer's project). This is a sibling of the
// /export route: same /apps/:id/ path, but POST to /test-apps — the registry mints a second,
// test-only app cloned from the source and returns it in the same exportable shape.
export async function createTestApp(
  sourceAppId: string,
  destFile: string,
  debug = false,
): Promise<CreateTestAppResult> {
  const endpoint = `${getRegistryApiUrl()}/apps/${sourceAppId}/test-apps`;
  if (debug) p.log.info(`POST ${endpoint}`);

  const response = await fetch(endpoint, { method: "POST", headers: authHeaders() });
  const body = await response.text();

  if (debug) p.log.info(`HTTP ${response.status}\n${body}`);
  if (!response.ok) {
    throw requestError(response.status, body);
  }

  const parsed = JSON.parse(body) as {
    data?: { action?: string; app?: { id?: string; shared_secret_key?: string } };
  };
  const testAppId = parsed.data?.app?.id;
  if (!testAppId) {
    throw new CLIError(`Test app response had no app id at .data.app.id`);
  }

  const sharedSecret = parsed.data?.app?.shared_secret_key;

  // Never persist the secret or the transient action field to disk — mirror push()'s
  // write-back. The secret lives in .env.local, set by the caller from the return value.
  delete parsed.data?.action;
  if (parsed.data?.app) delete parsed.data.app.shared_secret_key;
  writeFileSync(destFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  return { testAppId, sharedSecret };
}
