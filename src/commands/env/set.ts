import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { CLIError } from "../../errors.js";
import { clearRegistryOverride, getRegistryUrl, setRegistryOverride } from "../../lib/registry.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export default class EnvSet extends BaseCommand {
  static description = "Override the registry URL the CLI talks to (registry developers only)";
  static hidden = true;

  // Was `peek set-env` before the surface was organized into topics.
  // hiddenAliases, not aliases: it still resolves and still warns, but the retired name
  // is not offered to anyone reading `peek --help` for the first time.
  static hiddenAliases = ["set-env"];
  static deprecateAliases = true;

  static args = {
    url: Args.string({ description: "Registry base URL, e.g. https://app-registry-dev.example.com" }),
  };

  static flags = {
    clear: Flags.boolean({ description: "Remove the override and go back to production", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvSet);

    p.intro("peek env set");

    if (flags.clear) {
      clearRegistryOverride();
      p.outro(`Registry override cleared. Now targeting ${getRegistryUrl()}`);
      return;
    }

    if (!args.url) {
      throw new CLIError("A registry URL is required.", "Usage: peek env set <url>, or peek env set --clear");
    }

    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      throw new CLIError(`"${args.url}" is not a valid URL.`);
    }

    // Every registry call sends the bearer token — never let it travel plaintext.
    // Plain http is allowed only for a loopback registry running on this machine.
    if (parsed.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new CLIError(
        `Refusing non-HTTPS registry "${parsed.toString()}" — your auth token would be sent unencrypted.`,
        "Use an https:// URL (plain http is allowed only for localhost).",
      );
    }

    p.log.warn(
      `This points the CLI at a non-production registry: ${parsed.toString()}\n` +
        "Every command that talks to the registry will warn you again before proceeding.",
    );

    const proceed = await p.confirm({ message: "Set this as your active registry?", initialValue: false });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      return;
    }

    setRegistryOverride(parsed.toString());
    p.outro(`Registry override saved: ${parsed.toString()}`);
  }
}
