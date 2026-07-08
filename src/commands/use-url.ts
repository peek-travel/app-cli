import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Args, Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { devFileFor, setBaseUrl } from "../lib/serve.js";
import { writeEnvLocal } from "../lib/scaffold.js";
import { syncApp } from "../lib/sync.js";
import { failure } from "../lib/ui.js";

export default class UseUrl extends Command {
  static description =
    "Point your app at a permanent base URL (e.g. a deployed host) and publish it to the registry";

  static args = {
    url: Args.string({ description: "The base URL the app is served from, e.g. https://myapp.fly.dev", required: true }),
  };

  static flags = {
    // Defaults to app-dev.json (the test app). Pass --app to target app.json or any other manifest.
    app: Flags.string({ description: "Path to the app.json to update (defaults to ./app-dev.json)" }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(UseUrl);
    const cwd = process.cwd();

    p.intro("peek use-url");

    const url = normalizeUrl(args.url);

    // Default target is the test app (app-dev.json). --app lets you point at app.json or another manifest.
    const target = flags.app ? resolve(cwd, flags.app) : devFileFor(join(cwd, "app.json"));
    if (!existsSync(target)) {
      throw flags.app
        ? new CLIError(`${flags.app} does not exist.`)
        : new CLIError(
            "No app-dev.json in the current directory.",
            "Run `peek dev` first to create your test app, or pass --app <path> to target a different app.json.",
          );
    }

    await confirmRegistryOverride();
    await ensureLoggedIn();

    // Mutate the file only after auth is settled, so an aborted login doesn't leave a half-changed manifest.
    setBaseUrl(target, url);
    p.log.step(`Set base_url to ${url} in ${basename(target)}`);

    try {
      const result = await syncApp({
        file: target,
        autoPublish: true,
        pull: false,
        debug: flags.debug,
        assumeYes: flags.yes,
      });
      // A publish can mint a fresh secret, returned only once — persist it, mirroring `peek dev`.
      if (result.sharedSecret) {
        await writeEnvLocal(cwd, { PEEK_APP_SECRET: result.sharedSecret });
        p.log.step("Saved a new app secret to .env.local as PEEK_APP_SECRET.");
      }
    } catch (error) {
      if (error instanceof CLIError && error.message === "Aborted.") {
        p.outro("Aborted.");
        return;
      }
      if (error instanceof CLIError) {
        failure(error.message, error.suggestion);
        this.exit(1);
      }
      throw error;
    }

    p.outro(`Done — your app now points at ${url}`);
  }
}

function normalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    // URL normalizes a bare host to a trailing slash — drop it so base_url matches the tunnel form.
    return u.toString().replace(/\/$/, "");
  } catch {
    throw new CLIError(`"${input}" is not a valid http(s) URL.`, "Pass a full URL, e.g. https://myapp.fly.dev");
  }
}
