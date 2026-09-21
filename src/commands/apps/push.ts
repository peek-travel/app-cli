import { resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { targetAppId } from "../../lib/project.js";
import { confirmRegistryOverride } from "../../lib/registry.js";
import { pushManifest } from "../../lib/sync.js";

export default class AppsPush extends BaseCommand {
  static description = "Push this app's app.json manifest to the registry";

  static examples = [
    "<%= config.bin %> apps push",
    "<%= config.bin %> apps push --test",
    "<%= config.bin %> apps push --no-publish",
    "<%= config.bin %> apps push --app other-app",
  ];

  static args = {
    file: Args.string({
      description: "Path to the manifest to push (defaults to ./app.json)",
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
    "no-publish": Flags.boolean({ description: "Upsert without auto-publishing", default: false }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppsPush);
    const cwd = process.cwd();
    const file = resolve(cwd, args.file);

    p.intro("peek apps push");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      await pushManifest({
        file,
        appId: targetAppId(cwd, { flag: flags.app, test: flags.test, manifestFile: file }),
        autoPublish: !flags["no-publish"],
        debug: flags.debug,
        assumeYes: flags.yes,
      });
      p.outro("Done.");
    });
  }
}
