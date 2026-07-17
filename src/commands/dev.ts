import { existsSync } from "node:fs";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { detectPackageManager } from "../lib/pm.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";

export default class Dev extends BaseCommand {
  static description =
    "Run the app behind a public Cloudflare tunnel, syncing the tunnel URL to the registry";

  static flags = {
    port: Flags.integer({ description: "Local port the dev server listens on", default: 3000 }),
    "no-sync": Flags.boolean({ description: "Skip pushing the tunnel URL to the registry", default: false }),
    domain: Flags.string({
      description:
        "Use a persistent named tunnel at <app>-dev.<domain> instead of an ephemeral quick tunnel. Requires a Cloudflare login and access to the domain's zone.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);
    const cwd = process.cwd();

    p.intro("peek dev");

    const appFile = join(cwd, "app.json");
    if (!existsSync(appFile) || !existsSync(join(cwd, "package.json"))) {
      throw new CLIError(
        "No app.json / package.json in the current directory.",
        "Run this from inside a Peek app directory.",
      );
    }

    const pm = detectPackageManager("auto", cwd);

    // Auth/registry prompts run BEFORE the tunnel so a declined prompt can't orphan cloudflared.
    if (!flags["no-sync"]) {
      await ensureLoggedIn();
      await confirmRegistryOverride();
    }

    await serveWithTunnel({
      cwd,
      appFile,
      pm,
      port: flags.port,
      sync: !flags["no-sync"],
      domain: flags.domain,
    });
  }
}
