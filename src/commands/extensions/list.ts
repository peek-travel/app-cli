import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { listExtensions, platformsSummary } from "../../lib/extensions.js";
import { PLATFORM_VALUES, platformLabel } from "../../lib/platforms.js";
import { confirmRegistryOverride, warnOnStderrForSession } from "../../lib/registry.js";

export default class ExtensionsList extends BaseCommand {
  static description = "List the extensions (extendables) available to apps in the registry";

  static examples = [
    "<%= config.bin %> extensions list",
    "<%= config.bin %> extensions list --platform peek",
    "<%= config.bin %> extensions list --json",
  ];

  static flags = {
    platform: Flags.string({
      char: "p",
      description: "Only show extensions available on this platform",
      options: [...PLATFORM_VALUES],
    }),
    json: Flags.boolean({ description: "Output raw JSON instead of a formatted list", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionsList);

    // --json is a machine surface: no clack chrome, and the registry-override warning
    // routed to stderr, so stdout carries nothing but the JSON.
    if (flags.json) warnOnStderrForSession();
    else p.intro("peek extensions list");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      const extensions = await listExtensions(flags.platform, flags.debug);

      if (flags.json) {
        this.log(JSON.stringify(extensions, null, 2));
        return;
      }

      const scope = flags.platform ? `for ${platformLabel(flags.platform)}` : "across all platforms";

      if (extensions.length === 0) {
        p.outro(`No extensions found ${scope}.`);
        return;
      }

      // Sort by slug for a stable, scannable listing. Each entry is a two-line block —
      // the slug + metadata, then the description indented beneath — so the (often
      // sentence-long) descriptions stay readable instead of blowing out a table column.
      const rows = [...extensions].sort((a, b) => a.slug.localeCompare(b.slug));

      const body = rows
        .map((e) => {
          const head = `  ${e.slug}  (${e.type} · ${platformsSummary(e.platforms)})`;
          return e.description ? `${head}\n      ${e.description}` : head;
        })
        .join("\n\n");

      p.log.message(body);
      p.outro(`${rows.length} extension${rows.length === 1 ? "" : "s"} ${scope}.`);
    });
  }
}
