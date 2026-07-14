import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Args, Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { requireAccount } from "../lib/auth.js";
import { assertSupportedVersion, detectPackageManager, installArgs } from "../lib/pm.js";
import { type AppDetails, generateAppDetails, hasClaude, writeAppCopy } from "../lib/claude.js";
import { PLATFORMS } from "../lib/platforms.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";
import {
  DEFAULT_TEMPLATE,
  fetchTemplate,
  gitInit,
  installDependencies,
  selectPlatformManifest,
  substituteTemplateVars,
} from "../lib/scaffold.js";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    // Fold accents to their base letter first ("café" → "cafe") rather than dropping them.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Strip non-standard chars outright (so "Peek's App!" → "peeks-app", not "peek-s-app-").
    // Only whitespace is a word separator and becomes a dash.
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
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
    platform: Flags.string({
      description: "Platform to develop for",
      options: PLATFORMS.map((pl) => pl.value),
    }),
    goal: Flags.string({
      description:
        "What the app should do — used to tailor the listing copy (needs the Claude CLI)",
    }),
    "with-claude": Flags.boolean({
      description: "Use the Claude CLI (if installed) to generate the name, description, and listing",
      default: false,
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

    // Gate first: no scaffolding, no prompts, no Claude calls until the user has a developer
    // account. A declined sign-in stops here rather than building a starter kit they can't ship.
    if (!(await requireAccount())) {
      this.exit(1);
    }

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

    // Default is the classic "what's your app name?" prompt with the template's default copy.
    // Opt in with --with-claude to go description-first: ask what the app should do, then let
    // the Claude CLI invent the name, description, and listing copy — never prompting for a
    // name. An explicit app-name arg always wins over both.
    let details: AppDetails | null = null;
    let appName: string;

    if (args["app-name"]) {
      appName = args["app-name"];
    } else if (flags["with-claude"] && (await this.ensureClaude())) {
      const appGoal = await this.resolveAppGoal(flags.goal);
      details = appGoal ? await this.generateDetails(appGoal) : null;
      appName = details?.name ?? (await this.resolveAppName(undefined));
    } else {
      appName = await this.resolveAppName(undefined);
    }

    const platform = await this.resolvePlatform(flags.platform);

    const slug = slugify(appName);
    const targetDir = resolve(process.cwd(), slug);

    this.validateSlug(slug, targetDir);

    const templateSource = TEMPLATES[flags.template] ?? flags.template;

    const fetchSpinner = p.spinner();
    fetchSpinner.start(`Fetching template ${templateSource}`);
    await fetchTemplate(templateSource, targetDir);
    fetchSpinner.stop("Template fetched");

    // Starter kit ships a manifest per platform and no plain app.json — materialize the
    // selected platform's manifest as app.json before the var-substitution/sync steps run.
    await selectPlatformManifest(targetDir, platform);

    // Move into the freshly-cloned app dir so the rest of the flow (install, dev server,
    // sync) runs from inside it. targetDir stays absolute, so callers that already pass it
    // explicitly are unaffected — this just makes the process's cwd match the app.
    process.chdir(targetDir);

    await substituteTemplateVars(targetDir, {
      APP_NAME: appName,
      APP_SLUG: slug,
    });

    if (details) {
      const wrote = await writeAppCopy(join(targetDir, "app.json"), details);
      if (wrote) p.log.step("Wrote your app description and listing (via Claude)");
    }

    await gitInit(targetDir);

    const pm = detectPackageManager(flags.pm, targetDir);

    if (!flags["no-install"]) {
      assertSupportedVersion(pm);
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

  private async resolvePlatform(provided?: string): Promise<string> {
    if (provided) return provided;

    const answer = await p.select({
      message: "Which platform are you developing for?",
      options: PLATFORMS.map((pl) => ({ value: pl.value, label: pl.label })),
    });

    if (p.isCancel(answer)) {
      p.cancel("Cancelled");
      this.exit(1);
    }

    return answer as string;
  }

  private async resolveAppGoal(provided?: string): Promise<string> {
    if (provided !== undefined) return provided.trim();
    // No TTY (CI, piped, scripted) → can't prompt; skip rather than block on stdin.
    if (!process.stdin.isTTY) return "";

    const answer = await p.text({
      message: "What should your app do?",
      placeholder: "Show recent waivers and let staff check on those bookings",
    });

    if (p.isCancel(answer)) {
      p.cancel("Cancelled");
      this.exit(1);
    }

    return ((answer as string) ?? "").trim();
  }

  // Verify the Claude CLI is usable when --with-claude was requested. If not, say so and let
  // the caller fall back to the classic name prompt rather than silently ignoring the flag.
  private async ensureClaude(): Promise<boolean> {
    if (await hasClaude()) return true;
    p.log.warn(
      "--with-claude was set but no usable Claude CLI was found — asking for a name instead.",
    );
    return false;
  }

  // From the plain-language goal, have Claude invent the name, description, and listing copy
  // in one shot. Caller only reaches here when Claude is available and a goal was given.
  // Best-effort: unparseable output returns null and the caller falls back to asking for a name.
  private async generateDetails(goal: string): Promise<AppDetails | null> {
    const spin = p.spinner();
    spin.start("Naming your app and writing its listing with Claude");
    const details = await generateAppDetails(goal);
    if (!details) {
      spin.stop("Couldn't generate details — falling back", 0);
      return null;
    }
    spin.stop(`Named it "${details.name}"`, 0);
    return details;
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
