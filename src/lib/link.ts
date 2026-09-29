import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { legacySlug, PROJECT_FILE, readProject, writeLinkMetadata } from "./project.js";
import { listApps } from "./sync.js";

// No slug given: show what this account can publish to and let them choose. There is no
// name in the publisher API — the slug IS the identifier a developer recognizes. Shared by
// `apps link` (asked explicitly) and `peek dev` / `peek tunnel` (asked because the directory
// isn't linked yet) — same question, two doors.
export async function pickExistingApp(debug = false): Promise<string> {
  const apps = (await listApps({ excludeTestApps: true, debug })).sort((a, b) =>
    a.appId.localeCompare(b.appId),
  );

  if (apps.length === 0) {
    throw new CLIError(
      "This account has no apps in the registry yet.",
      "Run `peek init` to scaffold and create one, or `peek apps link <slug> --create` for a codebase that predates its app.",
    );
  }

  if (!process.stdin.isTTY) {
    throw new CLIError(
      "No app slug given.",
      "Pass the slug: `peek apps link <app-slug>`, or run this command with --app <slug>.",
    );
  }

  const answer = await p.select({
    message: "Which app does this directory publish to?",
    options: apps.map((app) => ({ value: app.appId, label: app.appId })),
  });

  if (p.isCancel(answer)) {
    p.cancel("Cancelled");
    throw new CLIError("Aborted.");
  }

  return answer as string;
}

// The dev loop's own preflight: a directory with no project file isn't necessarily a Peek
// app — it may be an existing codebase someone just ran `peek dev` / `peek tunnel` in.
// Guessing a slug from package.json and silently creating that app would quietly make a
// second app beside the one they meant to develop against, and (for an app that already
// exists under a different slug) there is no local signal at all for which one that is — so
// this asks, every time, instead of guessing.
//
// A brand-new app is deliberately NOT offered here: `peek apps link <slug> --create` (or
// `peek init`) is the one path that creates an app, so there's exactly one place a developer
// has to look for "how do I register something new."
export async function ensureProjectLinked(
  cwd: string,
  options: { appFlag?: string; manifestFile?: string; debug?: boolean } = {},
): Promise<void> {
  if (options.appFlag) return;
  if (readProject(cwd).app?.id) return;
  // A legacy manifest carries the app's own slug at .data.app.id and outranks anything we'd
  // ask for — there is nothing to pick when the file already names its app.
  if (legacySlug(options.manifestFile)) return;

  p.log.warn(`This directory isn't linked to a registry app yet (no ${PROJECT_FILE}).`);
  const appId = await pickExistingApp(options.debug);
  writeLinkMetadata(cwd, appId);
  p.log.step(`Linked to ${appId}.`);
}
