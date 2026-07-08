import { Args, Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { syncApp } from "../lib/sync.js";
import { failure } from "../lib/ui.js";

export default class SyncApp extends Command {
  static description = "Sync an app.json to the Peek app registry";

  static args = {
    file: Args.string({ description: "Path to the app.json to sync", required: true }),
  };

  static flags = {
    pull: Flags.boolean({ description: "Fetch the registry version and overwrite the local file", default: false }),
    "no-publish": Flags.boolean({ description: "Upsert without auto-publishing", default: false }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncApp);

    p.intro("peek sync-app");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    try {
      await syncApp({
        file: args.file,
        autoPublish: !flags["no-publish"],
        pull: flags.pull,
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
}
