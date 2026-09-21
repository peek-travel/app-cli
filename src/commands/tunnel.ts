import { existsSync } from "node:fs";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { detectPackageManager } from "../lib/pm.js";
import { confirmDerivedAppId } from "../lib/project.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";
import { checkTestIdentifier } from "../lib/sync.js";

// `peek dev` = this, plus starting the app for you. Splitting them out matters for the
// codebase the CLI didn't scaffold: its server is started by something the developer
// already has (a compose file, a debugger, a watcher in another terminal, a framework
// command with its own flags), and the only thing missing is the half only the CLI can do —
// a public URL, and a test app in the registry published at it.
export default class Tunnel extends BaseCommand {
  static description =
    "Expose an app you're already running on a public URL, and publish your test app at it";

  static examples = [
    "<%= config.bin %> tunnel",
    "<%= config.bin %> tunnel --port 8080",
    "<%= config.bin %> tunnel --app other-app",
    "<%= config.bin %> tunnel --no-env",
    "<%= config.bin %> tunnel --port 4000 --test greg",
  ];

  static flags = {
    port: Flags.integer({
      description: "Port your app is already listening on",
      default: 3000,
    }),
    "no-sync": Flags.boolean({
      description: "Just open the tunnel — push nothing to the registry",
      default: false,
    }),
    test: Flags.string({
      description:
        "Name your own test app (<app>-test-<name>) instead of the shared one every `dev` run uses",
      env: "PEEK_TEST_IDENTIFIER",
    }),
    app: Flags.string({
      description: "App slug to develop against (defaults to the one in .peek-kit.json)",
    }),
    "no-env": Flags.boolean({
      description: "Don't write PEEK_APP_URL / PEEK_APP_ID / PEEK_APP_SECRET to .env.local",
      default: false,
    }),
    domain: Flags.string({
      description:
        "Use a persistent named tunnel at <app>-dev.<domain> instead of an ephemeral quick tunnel. Requires a Cloudflare login and access to the domain's zone.",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip the confirmation shown when this directory isn't linked to an app yet",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Tunnel);
    const cwd = process.cwd();

    p.intro("peek tunnel");

    // Wrapped so a CLIError's suggestion is printed too — oclif prints only .message,
    // which would drop the "link to <source> instead" half of a refusal.
    await this.guard(async () => {
      // Only the registry half needs a manifest. `--no-sync` is a bare tunnel, which is
      // useful in any directory at all.
      const appFile = join(cwd, "app.json");
      if (!flags["no-sync"] && !existsSync(appFile)) {
        throw new CLIError(
          "No app.json in the current directory.",
          "Run `peek apps link <app-slug>` to bring an existing app's manifest down beside this codebase, or pass --no-sync to open a tunnel without touching the registry.",
        );
      }

      // Auth/registry prompts run BEFORE the tunnel so a declined prompt can't orphan cloudflared.
      if (!flags["no-sync"]) {
        await ensureLoggedIn();
        await confirmRegistryOverride();
        if (!(await confirmDerivedAppId(cwd, {
          appFlag: flags.app,
          yes: flags.yes,
          manifestFile: appFile,
        }))) {
          p.cancel("Aborted.");
          this.exit(1);
        }
      }

      await serveWithTunnel({
        cwd,
        appFile,
        // Nothing is spawned in attach mode, so the package manager is irrelevant — but
        // ServeOptions wants one, and detecting it costs a file read.
        pm: detectPackageManager("auto", cwd),
        port: flags.port,
        sync: !flags["no-sync"],
        domain: flags.domain,
        appId: flags.app,
        testIdentifier: flags.test ? checkTestIdentifier(flags.test) : undefined,
        attach: true,
        writeEnv: !flags["no-env"],
      });
    });
  }
}
