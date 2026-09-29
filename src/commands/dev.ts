import { existsSync } from "node:fs";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { ensureProjectLinked } from "../lib/link.js";
import { detectPackageManager } from "../lib/pm.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";
import { checkTestIdentifier } from "../lib/sync.js";

// The whole local loop in one command: start the app, put it behind a public URL, and
// publish the test app at that URL so it can be installed and used for real. If the app is
// already running — started by a compose file, a debugger, another terminal — `peek tunnel`
// is this minus the starting.
export default class Dev extends BaseCommand {
  static description =
    "Start the app, expose it on a public URL, and publish your test app at that URL";

  static examples = [
    "<%= config.bin %> dev",
    "<%= config.bin %> dev --app my-existing-app",
    '<%= config.bin %> dev --cmd "make serve"',
    "<%= config.bin %> dev --test greg",
  ];

  static flags = {
    port: Flags.integer({ description: "Local port the dev server listens on", default: 3000 }),
    "no-sync": Flags.boolean({ description: "Skip pushing anything to the registry", default: false }),
    test: Flags.string({
      description:
        "Name your own test app (<app>-test-<name>) instead of the shared one every `dev` run uses",
      env: "PEEK_TEST_IDENTIFIER",
    }),
    app: Flags.string({
      description: "App slug to develop against (defaults to the one in .peek-kit.json)",
    }),
    cmd: Flags.string({
      description:
        'Shell command that starts the app instead of "./bin/server" or "<pm> run dev" (e.g. "make serve"). It must listen on $PORT.',
    }),
    domain: Flags.string({
      description:
        "Use a persistent named tunnel at <app>-dev.<domain> instead of an ephemeral quick tunnel. Requires a Cloudflare login and access to the domain's zone.",
    }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);
    const cwd = process.cwd();

    p.intro("peek dev");

    // Wrapped so a CLIError's suggestion is printed too — oclif prints only .message,
    // which would drop the "link to <source> instead" half of a refusal.
    await this.guard(async () => {
      const appFile = join(cwd, "app.json");
      if (!existsSync(appFile)) {
        throw new CLIError(
          "No app.json in the current directory.",
          "Run this from inside a Peek app directory. For a codebase that isn't one yet, `peek apps link <app-slug>` brings an existing app's manifest down beside it, and `peek init` scaffolds a new app.",
        );
      }

      // Not a Node project, or started by something other than an npm script: an executable
      // ./bin/server (the Rails/Phoenix/Go convention) is used before falling back to
      // "<pm> run dev", and only then do we need package.json at all.
      const binServer = join(cwd, "bin/server");
      const command = flags.cmd ?? (existsSync(binServer) ? binServer : undefined);

      if (!command && !existsSync(join(cwd, "package.json"))) {
        throw new CLIError(
          "No package.json, no bin/server, and no --cmd in the current directory.",
          'Run this from inside the app, add a `bin/server` executable, pass --cmd "<command>", or use `peek tunnel` if you start it yourself.',
        );
      }

      const pm = detectPackageManager("auto", cwd);

      // Auth/registry prompts run BEFORE the tunnel so a declined prompt can't orphan cloudflared.
      if (!flags["no-sync"]) {
        await ensureLoggedIn();
        await confirmRegistryOverride();
        await ensureProjectLinked(cwd, { appFlag: flags.app, manifestFile: appFile, debug: flags.debug });
      }

      await serveWithTunnel({
        cwd,
        appFile,
        pm,
        port: flags.port,
        sync: !flags["no-sync"],
        domain: flags.domain,
        appId: flags.app,
        testIdentifier: flags.test ? checkTestIdentifier(flags.test) : undefined,
        command,
      });
    });
  }
}
