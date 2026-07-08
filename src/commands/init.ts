import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Args, Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { ensureLoggedIn } from "../lib/auth.js";
import { detectPackageManager, installArgs } from "../lib/pm.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";
import {
  DEFAULT_TEMPLATE,
  fetchTemplate,
  gitInit,
  installDependencies,
  substituteTemplateVars,
} from "../lib/scaffold.js";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return SLUG_RE.test(slug) ? slug : `app-${slug}`.replace(/-+$/, "");
}

const TEMPLATES: Record<string, string> = {
  nextjs: DEFAULT_TEMPLATE,
};

export default class Init extends Command {
  static description = "Scaffold a new Peek app from a starter template";

  static args = {
    "app-name": Args.string({
      description: "Name of the app / target directory",
    }),
  };

  static flags = {
    template: Flags.string({
      description: "Starter template to use",
      default: "nextjs",
    }),
    pm: Flags.string({
      description: "Package manager to use",
      options: ["auto", "npm", "pnpm", "yarn", "bun"],
      default: "auto",
    }),
    "no-install": Flags.boolean({
      description: "Skip dependency install",
      default: false,
    }),
    "no-sync": Flags.boolean({
      description: "Skip registering the app in the registry",
      default: false,
    }),
    "no-dev": Flags.boolean({
      description: "Skip starting the dev server",
      default: false,
    }),
    port: Flags.integer({
      description: "Local port the dev server listens on",
      default: 3000,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);

    p.intro("peek init");

    p.note(
      [
        "Let's ship your Peek Pro App. Here's what we'll do:",
        "",
        "  1. Scaffold  — starter template, ready to run",
        "  2. Register  — your app goes live in the registry",
        "  3. Dev       — running locally behind a public tunnel",
        "",
        "Takes about a minute. Let's build.",
      ].join("\n"),
      "Welcome",
    );

    const appName = await this.resolveAppName(args["app-name"]);
    const slug = slugify(appName);
    const targetDir = resolve(process.cwd(), slug);

    this.validateSlug(slug, targetDir);

    await ensureLoggedIn();

    const templateSource = TEMPLATES[flags.template] ?? flags.template;

    const fetchSpinner = p.spinner();
    fetchSpinner.start(`Fetching template ${templateSource}`);
    await fetchTemplate(templateSource, targetDir);
    fetchSpinner.stop("Template fetched");

    await substituteTemplateVars(targetDir, {
      APP_NAME: appName,
      APP_SLUG: slug,
    });

    await gitInit(targetDir);

    const pm = detectPackageManager(flags.pm, targetDir);

    if (!flags["no-install"]) {
      p.log.step(`Installing dependencies with ${pm}`);
      await installDependencies(pm, installArgs(pm), targetDir);
    }

    const appFile = join(targetDir, "app.json");
    const hasAppJson = existsSync(appFile);
    // Registration must happen behind the tunnel: the registry rejects a publish with a null
    // base_url, and the tunnel is what supplies one. So the first sync rides the serve flow.
    const wantSync = !flags["no-sync"] && hasAppJson;

    if (!flags["no-sync"] && !hasAppJson) {
      p.log.warn("No app.json in template — skipping registry registration.");
    }

    // Serving runs the dev server behind the tunnel and (if wanted) registers the app.
    // It needs installed deps, and it blocks — so skip it when install or dev is skipped.
    const willServe = !flags["no-install"] && !flags["no-dev"];

    if (!willServe) {
      // We're not running the app for them — hand off with manual next steps.
      this.printNextSteps(slug, targetDir, flags["no-install"]);
      if (wantSync) {
        p.log.warn(
          "Skipped registry registration — it needs a running tunnel. Run `peek dev` from the app dir to register.",
        );
      }
      return;
    }

    // Auto-serve path: we open the tunnel, register, and start the dev server ourselves —
    // so we do NOT tell the developer to run `peek dev`; we're already doing it. Leaving the
    // clack block open (no outro) keeps everything below on one connected tree.
    p.log.step(`Setting up ${slug} and starting it locally`);
    if (wantSync) await confirmRegistryOverride();
    await serveWithTunnel({
      cwd: targetDir,
      appFile,
      pm,
      port: flags.port,
      sync: wantSync,
    });
  }

  private async resolveAppName(provided?: string): Promise<string> {
    if (provided) return provided;

    const answer = await p.text({
      message: "What's your app name?",
      placeholder: "Demo App",
      validate: (value) => {
        if (!value) return "App name is required";
      },
    });

    if (p.isCancel(answer)) {
      p.cancel("Cancelled");
      this.exit(1);
    }

    return answer as string;
  }

  private validateSlug(slug: string, targetDir: string): void {
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      throw new CLIError(
        `Directory "${slug}" already exists and is not empty`,
        "Choose a different name or remove the existing directory.",
      );
    }
  }

  private printNextSteps(
    appName: string,
    targetDir: string,
    skippedInstall: boolean,
  ): void {
    const lines = [
      `Your app is ready at ${targetDir}`,
      "",
      "Next steps:",
      `  cd ${appName}`,
    ];

    if (skippedInstall) {
      lines.push("  <your package manager> install");
    }

    // `peek dev` (not a bare dev server) is the right entry point — it opens the tunnel and
    // syncs the public URL to the registry, which the app needs to run against it.
    lines.push("  peek dev");

    p.outro(lines.join("\n"));
  }
}
