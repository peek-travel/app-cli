import { resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { loadManifest } from "../lib/manifest.js";
import { readProject, resolveAppId } from "../lib/project.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { syncApp } from "../lib/sync.js";
import { failure } from "../lib/ui.js";

export default class SyncApp extends BaseCommand {
  static description = "Push (or pull) an app.json manifest to the Peek app registry";

  static args = {
    file: Args.string({
      description: "Path to the manifest to sync (defaults to ./app.json)",
      default: "app.json",
    }),
  };

  static flags = {
    // The manifest no longer names the app it belongs to — the slug is in the URL we push
    // to. It comes from .peek-kit.json unless named here.
    app: Flags.string({ description: "App slug to push to (defaults to the one in .peek-kit.json)" }),
    test: Flags.boolean({
      description: "Target this project's test app instead of the source app",
      default: false,
    }),
    pull: Flags.boolean({ description: "Fetch the registry version and overwrite the local file", default: false }),
    draft: Flags.boolean({
      description: "With --pull, fetch the app's draft instead of its published version",
      default: false,
    }),
    "no-publish": Flags.boolean({ description: "Upsert without auto-publishing", default: false }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncApp);
    const cwd = process.cwd();
    const file = resolve(cwd, args.file);

    p.intro("peek sync-app");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    try {
      await syncApp({
        file,
        appId: this.targetApp(cwd, file, flags),
        autoPublish: !flags["no-publish"],
        pull: flags.pull,
        draft: flags.draft,
        debug: flags.debug,
        assumeYes: flags.yes,
      });
    } catch (error) {
      if (error instanceof CLIError && error.message === "Aborted.") {
        p.outro("Aborted.");
        return;
      }
      // Surface the full CLIError body (e.g. the registry's 422 validation detail),
      // which oclif's default handler would otherwise drop — it prints only .message.
      if (error instanceof CLIError) {
        failure(error.message, error.suggestion);
        this.exit(1);
      }
      throw error;
    }

    p.outro("Done.");
  }

  // Which app slug this push targets: --app wins, then --test (the project's test app),
  // then the project's source app. A legacy manifest still carrying `.data.app.id` names
  // its own app, so an un-migrated project resolves too.
  private targetApp(cwd: string, file: string, flags: { app?: string; test: boolean }): string {
    if (flags.app) return flags.app;

    if (flags.test) {
      const testId = readProject(cwd).app?.testId;
      if (!testId) {
        throw new CLIError(
          "This project has no test app yet.",
          "Run `peek dev` once to create one, or pass --app <slug>.",
        );
      }
      return testId;
    }

    return resolveAppId(cwd, { legacyAppId: safeLegacyAppId(file) }).appId;
  }
}

function safeLegacyAppId(file: string): string | undefined {
  try {
    return loadManifest(file).legacyAppId;
  } catch {
    // An unreadable/invalid manifest is the push's problem to report, not the slug
    // lookup's — fall through to the project file.
    return undefined;
  }
}
