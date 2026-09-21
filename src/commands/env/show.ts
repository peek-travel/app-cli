import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { DEFAULT_REGISTRY_URL, getRegistryUrl, isRegistryOverridden } from "../../lib/registry.js";

export default class EnvShow extends BaseCommand {
  static description = "Show which registry the CLI is talking to (registry developers only)";
  static hidden = true;

  // Was `peek show-env` before the surface was organized into topics.
  // hiddenAliases, not aliases: it still resolves and still warns, but the retired name
  // is not offered to anyone reading `peek --help` for the first time.
  static hiddenAliases = ["show-env"];
  static deprecateAliases = true;

  async run(): Promise<void> {
    p.intro("peek env show");

    const url = getRegistryUrl();
    const overridden = isRegistryOverridden();

    p.log.message(`Registry:    ${url}`);
    p.log.message(`Environment: ${overridden ? "OVERRIDE (not production)" : "production (default)"}`);
    if (overridden) p.log.message(`Production:  ${DEFAULT_REGISTRY_URL}`);

    p.outro(overridden ? 'Run "peek env set --clear" to return to production.' : "You're on production.");
  }
}
