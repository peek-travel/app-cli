import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createRequire } from "node:module";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { loadManifest, type Manifest, writeManifest } from "./manifest.js";

// Every scaffolded app carries one CLI-owned file, `.peek-kit.json`, recording what the
// project IS: which app in the registry it publishes to, which test app the dev loop uses,
// and what created it. It is committed — the app's slug is identity, not a secret, and a
// fresh clone has to push to the same app.
//
// This file exists because the manifest no longer can hold it: `app.json` is the manifest
// and only the manifest, the app's slug moved into the URL you push to, and the registry
// rejects unknown manifest keys with a 400. So the one thing app.json used to tell us —
// which app this is — lives here instead.
//
// ../../package.json resolves from both src/lib (tsx) and dist/lib (compiled).
const { version: CLI_VERSION } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

export const PROJECT_FILE = ".peek-kit.json";

export interface ProjectApp {
  // The source app's slug — what `peek apps sync` pushes to and what ships to production.
  id?: string;
  // The test app cloned from it, which is what `peek dev` publishes at the tunnel URL. The
  // registry derives the slug (`<id>-test-<identifier>`, identifier "dev" unless asked
  // otherwise, truncated to 50 chars), we just remember what it handed back.
  testId?: string;
}

export interface ProjectFile {
  app?: ProjectApp;
  starterKit?: string;
  cliVersion?: string;
  platform?: string;
  stack?: string;
  createdAt?: string;
  // When this directory was pointed at an existing registry app by `peek apps link` rather than
  // scaffolded by `peek init`. Mutually exclusive with starterKit in practice, and the one
  // signal that the code here predates the app it publishes to.
  linkedAt?: string;
}

function projectPath(cwd: string): string {
  return join(cwd, PROJECT_FILE);
}

export function readProject(cwd: string): ProjectFile {
  const path = projectPath(cwd);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectFile;
  } catch {
    // A hand-mangled file shouldn't break the dev loop — treat it as absent and let the
    // next write lay down a clean one.
    return {};
  }
}

export function writeProject(cwd: string, project: ProjectFile): void {
  writeFileSync(projectPath(cwd), `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

// Merge a patch into the project file, preserving anything already there (including keys
// this CLI version doesn't know about). `app` merges one level deeper so recording a test
// app can't drop the source app's slug.
export function updateProject(cwd: string, patch: ProjectFile): ProjectFile {
  const current = readProject(cwd);
  const merged: ProjectFile = {
    ...current,
    ...patch,
    app: { ...current.app, ...patch.app },
  };
  if (Object.keys(merged.app ?? {}).length === 0) delete merged.app;
  writeProject(cwd, merged);
  return merged;
}

// Record what this app was scaffolded from: the starter kit, the CLI version that created
// it, the selected platform/stack, and the app slug the registry will know it by.
export function writeKitMetadata(
  cwd: string,
  starterKit: string,
  platform: string,
  stack: string,
  appId: string,
): void {
  updateProject(cwd, {
    app: { id: appId },
    starterKit,
    cliVersion: CLI_VERSION,
    platform,
    stack,
    createdAt: new Date().toISOString(),
  });
}

// Record that an EXISTING codebase now publishes to an existing registry app. Deliberately
// not writeKitMetadata: nothing scaffolded this directory, so there is no starter kit to
// name and no creation date to claim — only which app it pushes to, and the axes its skills
// were composed for (absent when we couldn't work them out and composed nothing).
export function writeLinkMetadata(
  cwd: string,
  appId: string,
  axes: { platform?: string; stack?: string } = {},
): void {
  const patch: ProjectFile = {
    app: { id: appId },
    cliVersion: CLI_VERSION,
    linkedAt: new Date().toISOString(),
  };
  // Only set what we know — spreading an undefined platform over a recorded one would
  // silently forget it (JSON.stringify drops the key).
  if (axes.platform) patch.platform = axes.platform;
  if (axes.stack) patch.stack = axes.stack;
  updateProject(cwd, patch);
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

// Turn a human app name (or a package.json name) into a registry slug. The registry allows
// [a-z0-9-] up to 50 chars; we also want a leading letter, so anything that would start
// with a digit or a dash is prefixed rather than rejected.
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    // Fold accents to their base letter first ("café" → "cafe") rather than dropping them.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Strip non-standard chars outright (so "Peek's App!" → "peeks-app", not "peek-s-app-").
    // Only whitespace is a word separator and becomes a dash.
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return SLUG_RE.test(slug) ? slug : `app-${slug}`.replace(/-+$/, "");
}

// The slug implied by the project's package.json "name". The last-resort fallback for an
// app that has neither a project file nor a legacy manifest to name it — and the same
// derivation `peek dev` uses for a named tunnel, so the two agree.
export function packageSlug(cwd: string): string | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    const { name } = JSON.parse(readFileSync(path, "utf8")) as { name?: string };
    const slug = name ? slugify(name) : "";
    return slug.length > 0 ? slug : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolvedAppId {
  appId: string;
  // Where the slug came from, so a command can explain itself (and so a derived slug can be
  // written back into the project file the first time we have to guess).
  source: "flag" | "project" | "manifest" | "package";
}

// Which app in the registry does this directory publish to? In order: an explicit --app
// flag, the project file, the slug a legacy `app.json` envelope still carries, then the
// package.json name. Anything we had to derive is recorded so the answer is stable from
// then on.
export function resolveAppId(
  cwd: string,
  options: { flag?: string; legacyAppId?: string; persist?: boolean } = {},
): ResolvedAppId {
  // Recording what we had to derive is the point of this function — it's what makes the
  // answer stable from then on. `persist: false` is for a caller that has to VALIDATE the
  // answer first (the dev loop refuses a test app), so a slug it rejects is never written.
  const record = (patch: { id: string }): void => {
    if (options.persist !== false) updateProject(cwd, { app: patch });
  };

  if (options.flag) return { appId: options.flag, source: "flag" };

  const recorded = readProject(cwd).app?.id;
  if (recorded) return { appId: recorded, source: "project" };

  if (options.legacyAppId) {
    record({ id: options.legacyAppId });
    return { appId: options.legacyAppId, source: "manifest" };
  }

  const derived = packageSlug(cwd);
  if (derived) {
    record({ id: derived });
    return { appId: derived, source: "package" };
  }

  throw new CLIError(
    "Could not work out which app this is.",
    `Add {"app": {"id": "your-app-slug"}} to ${PROJECT_FILE}, or pass --app <slug>.`,
  );
}

// Which app slug a manifest move (`peek apps push` / `peek apps pull`) targets: an explicit
// --app wins, then --test (this project's test app), then the app this directory publishes
// to. A legacy manifest still carrying `.data.app.id` names its own app, so an un-migrated
// project resolves too.
export function targetAppId(
  cwd: string,
  options: { flag?: string; test?: boolean; manifestFile?: string } = {},
): string {
  if (options.flag) return options.flag;

  if (options.test) {
    const testId = readProject(cwd).app?.testId;
    if (!testId) {
      throw new CLIError(
        "This project has no test app yet.",
        "Run `peek dev` once to create one, or pass --app <slug>.",
      );
    }
    return testId;
  }

  return resolveAppId(cwd, { legacyAppId: legacySlug(options.manifestFile) }).appId;
}

function legacySlug(file?: string): string | undefined {
  if (!file) return undefined;
  try {
    return loadManifest(file).legacyAppId;
  } catch {
    // An unreadable/invalid manifest is the push's problem to report, not the slug
    // lookup's — fall through to the project file.
    return undefined;
  }
}

// A directory with no project file isn't necessarily a Peek app — it may be an existing
// codebase someone ran `peek dev` / `peek tunnel` in. Left alone we'd derive a slug from
// package.json and CREATE that app in the registry, which quietly makes a second app beside
// the one they meant to develop against. Cheap to confirm, expensive to undo.
//
// Returns false when the developer declined, so the caller can stop before it opens a
// tunnel or starts a server.
export async function confirmDerivedAppId(
  cwd: string,
  options: { appFlag?: string; yes?: boolean; manifestFile?: string } = {},
): Promise<boolean> {
  if (options.appFlag) return true;
  if (readProject(cwd).app?.id) return true;
  // A legacy manifest carries the app's own slug at .data.app.id and outranks anything we
  // could derive, so there is nothing being guessed here — warning about package.json
  // would name an app this run isn't going to touch.
  if (legacySlug(options.manifestFile)) return true;

  // No package.json name to derive from: resolveAppId raises its own (good) error later.
  const derived = packageSlug(cwd);
  if (!derived) return true;

  p.log.warn(
    [
      `This directory isn't linked to a registry app yet (no ${PROJECT_FILE}).`,
      `Continuing will develop against "${derived}", taken from package.json — and create that app if nothing has the slug.`,
      "To use an app that already exists instead, run `peek apps link` or pass --app <slug>.",
    ].join("\n"),
  );

  if (options.yes || !process.stdin.isTTY) return true;

  const answer = await p.confirm({ message: `Use "${derived}"?`, initialValue: false });
  return !p.isCancel(answer) && answer === true;
}

// The generated test-app manifest the old dev loop kept beside app.json. It has no job
// now — a test app is a slug we push the same app.json at, not a second file — but its
// `.data.app.id` is the only record of which test app an existing project was using, so
// we read it once during migration and then take it away.
export const LEGACY_DEV_FILE = "app-dev.json";

export interface OpenedProject {
  manifest: Manifest;
  appId: string;
  // Where the slug came from, so a caller that deferred recording it (persist: false) can
  // record it once it's satisfied, and only if it wasn't already on file.
  appIdSource: ResolvedAppId["source"];
  // The test app this project already has, if we know of one. Absent on a fresh project —
  // `peek dev` asks the registry for one and records it.
  testAppId?: string;
}

// Open a project directory: its manifest, the app it publishes to, and the test app it
// uses. Migrates in place on the way through, because an app scaffolded against the old
// publisher API has all three facts in the wrong places:
//
//   * app.json in the `{data: {app: …}}` envelope  → rewritten as the flat manifest
//   * the app slug inside that envelope            → moved into .peek-kit.json
//   * app-dev.json holding the test app's slug     → moved too, and the file removed
//
// Doing it here (rather than in a `peek migrate` the developer has to know about) is what
// keeps the promise that `peek dev` in an existing app still just works.
export function openProject(
  cwd: string,
  appFile: string,
  options: { appIdFlag?: string; quiet?: boolean; persist?: boolean } = {},
): OpenedProject {
  const step = (message: string): void => {
    if (!options.quiet) p.log.step(message);
  };

  const { manifest, legacyAppId, legacyBaseUrl, converted } = loadManifest(appFile);

  if (converted) {
    writeManifest(appFile, manifest);
    step(
      `Migrated ${basename(appFile)} to the current manifest format (extendables keyed by "global" and by platform).`,
    );
    if (legacyBaseUrl) {
      step(
        `Dropped base_url (${legacyBaseUrl}) from the manifest — it's set per environment now, by \`peek dev\` and \`peek apps use-url\`.`,
      );
    }
  }

  const { appId, source } = resolveAppId(cwd, {
    flag: options.appIdFlag,
    legacyAppId,
    persist: options.persist,
  });

  let testAppId = readProject(cwd).app?.testId;

  const legacyDevFile = join(cwd, LEGACY_DEV_FILE);
  if (existsSync(legacyDevFile)) {
    testAppId = readLegacyTestAppId(legacyDevFile) ?? testAppId;
    if (testAppId) updateProject(cwd, { app: { testId: testAppId } });
    rmSync(legacyDevFile, { force: true });
    step(
      `Removed ${LEGACY_DEV_FILE}${testAppId ? ` — its test app (${testAppId}) is recorded in ${PROJECT_FILE}` : ""}.`,
    );
  }

  return { manifest, appId, testAppId, appIdSource: source };
}

function readLegacyTestAppId(file: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { data?: { app?: { id?: string } } };
    return parsed.data?.app?.id;
  } catch {
    return undefined;
  }
}
