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
  // The source app's slug — what `peek sync-app` pushes to and what ships to production.
  id?: string;
  // The test app cloned from it, which is what `peek dev` publishes at the tunnel URL. The
  // registry derives the slug (`<id>-dev`), we just remember what it handed back.
  testId?: string;
}

export interface ProjectFile {
  app?: ProjectApp;
  starterKit?: string;
  cliVersion?: string;
  platform?: string;
  stack?: string;
  createdAt?: string;
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
  options: { flag?: string; legacyAppId?: string } = {},
): ResolvedAppId {
  if (options.flag) return { appId: options.flag, source: "flag" };

  const recorded = readProject(cwd).app?.id;
  if (recorded) return { appId: recorded, source: "project" };

  if (options.legacyAppId) {
    updateProject(cwd, { app: { id: options.legacyAppId } });
    return { appId: options.legacyAppId, source: "manifest" };
  }

  const derived = packageSlug(cwd);
  if (derived) {
    updateProject(cwd, { app: { id: derived } });
    return { appId: derived, source: "package" };
  }

  throw new CLIError(
    "Could not work out which app this is.",
    `Add {"app": {"id": "your-app-slug"}} to ${PROJECT_FILE}, or pass --app <slug>.`,
  );
}

// The generated test-app manifest the old dev loop kept beside app.json. It has no job
// now — a test app is a slug we push the same app.json at, not a second file — but its
// `.data.app.id` is the only record of which test app an existing project was using, so
// we read it once during migration and then take it away.
export const LEGACY_DEV_FILE = "app-dev.json";

export interface OpenedProject {
  manifest: Manifest;
  appId: string;
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
  options: { appIdFlag?: string; quiet?: boolean } = {},
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
        `Dropped base_url (${legacyBaseUrl}) from the manifest — it's set per environment now, by \`peek dev\` and \`peek use-url\`.`,
      );
    }
  }

  const { appId } = resolveAppId(cwd, { flag: options.appIdFlag, legacyAppId });

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

  return { manifest, appId, testAppId };
}

function readLegacyTestAppId(file: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { data?: { app?: { id?: string } } };
    return parsed.data?.app?.id;
  } catch {
    return undefined;
  }
}
