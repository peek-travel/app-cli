import { Args, Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "../../errors.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import {
  buildFieldTree,
  type ExtendableField,
  type FieldNode,
  platformsSummary,
  showExtension,
} from "../../lib/extensions.js";
import { confirmRegistryOverride } from "../../lib/registry.js";
import { failure } from "../../lib/ui.js";

// Bullet per nesting depth; the last one repeats for anything deeper.
const BULLETS = ["•", "◦", "–"];

function fieldSummary(field: ExtendableField): string {
  const parts = [`${field.key} (${field.field_type})`];
  if (field.required) parts.push("required");
  if (field.enum_values?.length) parts.push(`one of: ${field.enum_values.join(", ")}`);
  if (field.default !== null && field.default !== undefined) {
    parts.push(`default: ${JSON.stringify(field.default)}`);
  }
  return parts.join(" · ");
}

// Render a field node and its children, indenting one level deeper per generation.
function renderNode(node: FieldNode, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth + 1);
  const bullet = BULLETS[Math.min(depth, BULLETS.length - 1)];

  if (node.field) {
    out.push(`${indent}${bullet} ${fieldSummary(node.field)}`);
    const blurb = node.field.description ?? node.field.label;
    if (blurb) out.push(`${indent}    ${blurb}`);
  } else if (node.label) {
    out.push(`${indent}${bullet} ${node.label}:`);
  }

  for (const child of node.children) renderNode(child, depth + 1, out);
}

export default class ExtensionsShow extends Command {
  static description = "Show details for a single extension (extendable) by slug";

  static examples = [
    "<%= config.bin %> extensions show booking_portal@v1",
    "<%= config.bin %> extensions show peek_backoffice_api@v1 --json",
  ];

  static args = {
    slug: Args.string({ description: "Extension slug, e.g. booking_portal@v1", required: true }),
  };

  static flags = {
    json: Flags.boolean({ description: "Output raw JSON instead of a formatted view", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsShow);

    if (!flags.json) p.intro("peek extensions show");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    try {
      const ext = await showExtension(args.slug, flags.debug);

      if (flags.json) {
        this.log(JSON.stringify(ext, null, 2));
        return;
      }

      const lines = [
        `Slug:        ${ext.slug}`,
        `Type:        ${ext.type}`,
        `Platforms:   ${platformsSummary(ext.platforms)}`,
        `Global:      ${ext.global ? "yes" : "no"}`,
      ];
      if (ext.description) lines.push("", ext.description);

      if (ext.fields.length > 0) {
        const out: string[] = [];
        for (const node of buildFieldTree(ext.fields)) renderNode(node, 0, out);
        lines.push("", "Fields:", ...out);
      } else {
        lines.push("", "No configurable fields.");
      }

      p.note(lines.join("\n"), ext.slug);
      p.outro("Done.");
    } catch (error) {
      if (error instanceof CLIError) {
        failure(error.message, error.suggestion);
        this.exit(1);
      }
      throw error;
    }
  }
}
