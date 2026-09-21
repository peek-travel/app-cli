import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { resolvePlatform, resolveStack } from "../lib/axes.js";
import { PLATFORM_VALUES, platformLabel } from "../lib/platforms.js";
import { readProject, updateProject } from "../lib/project.js";
import { composeSkills } from "../lib/scaffold.js";
import { STACK_VALUES, stackLabel } from "../lib/stacks.js";

// The app-building skills are the CLI's other payload, and until now `peek init` was the
// only way to get them — which left out both of the flows this command serves: a codebase
// that was never scaffolded (`peek apps link` composes them once; this re-composes them), and a
// scaffolded app whose skills are now older than the installed CLI.
//
// Purely local: no auth, no registry, no network.
export default class Skills extends BaseCommand {
  static description = "Compose (or refresh) this app's Claude skills in .claude/skills";

  static examples = [
    "<%= config.bin %> skills",
    "<%= config.bin %> skills --platform peek --stack javascript",
  ];

  static flags = {
    platform: Flags.string({
      description: "Platform whose skills to compose (default: the one in .peek-kit.json)",
      options: [...PLATFORM_VALUES],
    }),
    stack: Flags.string({
      description: "Tech stack whose skills to compose (default: the one in .peek-kit.json)",
      options: [...STACK_VALUES],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Skills);
    const cwd = process.cwd();

    p.intro("peek skills");

    await this.guard(async () => {
      const recorded = readProject(cwd);
      const platform = await resolvePlatform(flags.platform, recorded.platform);
      const stack = await resolveStack(flags.stack, recorded.stack);

      // Overwrites the skills it owns and leaves anything else in .claude/skills alone, so
      // a project's own skills survive a refresh.
      const count = await composeSkills(cwd, platform, stack);

      // Remember the axes so the next run (and `peek apps link`) doesn't have to ask.
      updateProject(cwd, { platform, stack });

      if (count === 0) {
        p.outro(
          `No skills to compose for ${platformLabel(platform)} · ${stackLabel(stack)} — this CLI ships none for that combination.`,
        );
        return;
      }

      p.outro(
        `Composed ${count} skills into .claude/skills (${platformLabel(platform)} · ${stackLabel(stack)}).`,
      );
    });
  }
}
