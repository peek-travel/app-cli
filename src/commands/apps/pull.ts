import { resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { targetAppId } from "../../lib/project.js";
import { confirmRegistryOverride } from "../../lib/registry.js";
import { pullManifest } from "../../lib/sync.js";

export default class AppsPull extends BaseCommand {
  static description = "Overwrite the local app.json with the manifest the registry holds";

  static examples = [
    "<%= config.bin %> apps pull",
    "<%= config.bin %> apps pull --draft",
    "<%= config.bin %> apps pull --app other-app",
  ];

  static args = {
    file: Args.string({
      description: "Path to the manifest to overwrite (defaults to ./app.json)",
      default: "app.json",
    }),
  };

  static flags = {
    app: Flags.string({ description: "App slug to pull from (defaults to the one in .peek-kit.json)" }),
    test: Flags.boolean({
      description: "Target this project's test app instead of the source app",
      default: false,
    }),
    draft: Flags.boolean({
      description: "Fetch the app's draft instead of its published version",
      default: false,
    }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppsPull);
    const cwd = process.cwd();
    const file = resolve(cwd, args.file);

    p.intro("peek apps pull");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      await pullManifest({
        file,
        // A pull doesn't read the file, so a broken local manifest can't name the app —
        // only the project file (or --app) can. That's why manifestFile isn't passed.
        appId: targetAppId(cwd, { flag: flags.app, test: flags.test }),
        draft: flags.draft,
        debug: flags.debug,
        assumeYes: flags.yes,
      });
      p.outro("Done.");
    });
  }
}
