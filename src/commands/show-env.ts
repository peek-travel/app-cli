import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { DEFAULT_REGISTRY_URL, getRegistryUrl, isRegistryOverridden } from "../lib/registry.js";

export default class ShowEnv extends BaseCommand {
  static description = "Show which registry the CLI is talking to (registry developers only)";
  static hidden = true;

  async run(): Promise<void> {
    p.intro("peek show-env");

    const url = getRegistryUrl();
    const overridden = isRegistryOverridden();

    p.log.message(`Registry:    ${url}`);
    p.log.message(`Environment: ${overridden ? "OVERRIDE (not production)" : "production (default)"}`);
    if (overridden) p.log.message(`Production:  ${DEFAULT_REGISTRY_URL}`);

    p.outro(overridden ? 'Run "peek set-env --clear" to return to production.' : "You're on production.");
  }
}
