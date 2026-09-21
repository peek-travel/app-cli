import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../base-command.js";
import { CLIError } from "../errors.js";
import { requireAccount } from "../lib/auth.js";
import {
  assertInstalled,
  assertSupportedVersion,
  detectPackageManager,
  foreignLockfiles,
  installArgs,
} from "../lib/pm.js";
import { resolvePlatform, resolveStack } from "../lib/axes.js";
import { type AppDetails, generateAppDetails, hasClaude, writeListingDraft } from "../lib/claude.js";
import { loadManifest, type Manifest, solePlatform } from "../lib/manifest.js";
import { PLATFORMS } from "../lib/platforms.js";
import { STACKS } from "../lib/stacks.js";
import { slugify, writeKitMetadata } from "../lib/project.js";
import { confirmRegistryOverride } from "../lib/registry.js";
import { serveWithTunnel } from "../lib/serve.js";
import {
  announceSharedSecret,
  findApp,
  tryExportManifest,
  upsertManifest,
} from "../lib/sync.js";
import {
  composeSkills,
  DEFAULT_TEMPLATE,
  fetchTemplate,
  gitInit,
  installDependencies,
  selectPlatformManifest,
  substituteTemplateVars,
  writeEnvLocal,
} from "../lib/scaffold.js";

export default class Init extends BaseCommand {
  static summary = "Do the whole first run in one command — scaffold, register, and go live locally";

  // oclif re-wraps each paragraph to the terminal width, so the prose is one long line per
  // paragraph and only the short command list is pre-formatted (short enough not to wrap).
  static description = `The one command that does everything: signs you in, scaffolds the starter kit, installs its dependencies, creates your app in the registry, opens a public tunnel, publishes your test app at that URL, and starts the dev server — so the app is installable and running about a minute after you type it.

Every step is also its own command, for when you don't want all of them:

  peek apps link <slug>  an existing codebase, an existing app — no scaffolding
  peek skills            just (re)compose the Claude skills
  peek apps push         just push the manifest
  peek tunnel            just the public URL, for an app you start yourself
  peek dev               start + tunnel + publish, without scaffolding

The argument is a name for a new app — or the slug of one that already exists, in which case that app is adopted instead: its slug is what this kit publishes to and its live manifest is what lands in app.json. Nothing is created and nothing of the app's is overwritten. The registry is checked either way, because an app's slug is also the address a push writes to: without the check, scaffolding under a name that is already taken would push the starter kit's manifest over that app's.

Or turn steps off with --no-install, --no-sync and --no-dev. Use --app <slug> to REQUIRE an existing app (a slug that isn't there fails rather than creating it).`;

  static examples = [
    "<%= config.bin %> init",
    "<%= config.bin %> init waiver-wizard",
    "<%= config.bin %> init my-existing-app",
    "<%= config.bin %> init --app my-existing-app --no-dev",
  ];

  static args = {
    "app-name": Args.string({
      description:
        "A name for a new app, or the slug of one that already exists — an existing app is adopted, not recreated",
    }),
  };

  static flags = {
    // The strict form of what the positional arg does loosely: REQUIRE an app that already
    // exists. Worth keeping separate for scripts — with the bare arg, a slug that isn't in
    // the registry is a new app, which in CI would turn a typo into a second app.
    app: Flags.string({
      description: "Require an existing registry app (by slug) — fail instead of creating one",
    }),
    platform: Flags.string({
      description: "Platform to develop for",
      options: PLATFORMS.map((pl) => pl.value),
    }),
    stack: Flags.string({
      description: "Tech stack to build on",
      options: STACKS.map((st) => st.value),
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

    // Wrapped so a CLIError's suggestion is printed too — oclif's own handler shows only
    // .message, which would drop every "choose another name" / "run this instead" hint
    // the steps below raise.
    await this.guard(async () => {
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

      // Work out what app this is before anything is written to disk. Either it already
      // exists in the registry — in which case we adopt it, slug and manifest — or the slug is
      // free and we're creating it.
      let details: AppDetails | null = null;
      let appName: string;
      let slug: string;
      let existing: Manifest | null = null;

      if (flags.app) {
        // --app names the app, so there is nothing for Claude to name. Listing copy is written
        // in the portal, and an app that already exists already has its own.
        if (flags["with-claude"]) {
          p.log.warn("--with-claude only names and describes a NEW app — ignoring it for --app.");
        }
        slug = flags.app;
        appName = args["app-name"] ?? flags.app;
        existing = await this.lookupApp(slug, { mustExist: true });
      } else {
        // Default is the classic "what's your app name?" prompt with the template's default copy.
        // Opt in with --with-claude to go description-first: ask what the app should do, then let
        // the Claude CLI invent the name, description, and listing copy — never prompting for a
        // name. An explicit app-name arg always wins over both.
        if (args["app-name"]) {
          appName = args["app-name"];
        } else if (flags["with-claude"] && (await this.ensureClaude())) {
          const appGoal = await this.resolveAppGoal(flags.goal);
          details = appGoal ? await this.generateDetails(appGoal) : null;
          appName = details?.name ?? (await this.resolveAppName(undefined));
        } else {
          appName = await this.resolveAppName(undefined);
        }
        slug = slugify(appName);

        if (flags["no-sync"]) {
          // Nothing may touch the registry, so we can't know whether the slug is taken. Say
          // so: the kit gets the starter manifest, and the first push decides the rest.
          p.log.warn(
            `--no-sync: not checking whether "${slug}" already exists, so this kit ships the starter manifest.`,
          );
        } else {
          // The slug the developer named may already BE an app — that's the shortcut this
          // command is built around (`peek init my-existing-app`). It also has to be checked
          // when the name came from a prompt or from Claude, because a slug is the address a
          // push writes to: scaffolding onto a taken slug and pushing would overwrite that
          // app's manifest with the starter kit's.
          existing = await this.lookupApp(slug, {
            // An explicitly typed slug is consent; a name we suggested is not.
            confirmAdoption: !args["app-name"],
          });
        }
      }

      // An existing app's manifest already says which platform it targets; only ask when it
      // can't answer (no version yet, or it targets several).
      const platform = await resolvePlatform(
        flags.platform,
        existing ? solePlatform(existing) : undefined,
      );
      const stack = await resolveStack(flags.stack);

      // The directory is named after the app, not after the registry slug — they differ only
      // when --app is paired with a name for the folder.
      const dirName = slugify(appName);
      const targetDir = resolve(process.cwd(), dirName);

      this.validateSlug(dirName, targetDir);

      // Always the starter kit vendored into the CLI — there is no user-facing template option.
      const fetchSpinner = p.spinner();
      fetchSpinner.start("Copying the starter kit");
      await fetchTemplate(DEFAULT_TEMPLATE, targetDir);
      fetchSpinner.stop("Starter kit ready");

      // Starter kit ships a manifest per platform and no plain app.json — materialize the
      // selected platform's manifest as app.json before the var-substitution/sync steps run.
      // For an existing app, its own manifest is the one that lands there instead: the kit's
      // example would replace live extendable declarations with example ones.
      await selectPlatformManifest(targetDir, platform, existing ?? undefined);
      if (existing) p.log.step(`Wrote ${slug}'s manifest from the registry to app.json`);

      // Stamp the app with what it is — the slug the registry knows it by — plus what created
      // it (starter kit + CLI version), before we cd in. app.json can't hold the slug: it is
      // the manifest and only the manifest, and the slug rides in the URL we push to.
      writeKitMetadata(targetDir, basename(DEFAULT_TEMPLATE), platform, stack, slug);

      // Compose the app's Claude skills: generic globals + the selected platform's + stack's
      // skills, into .claude/skills/. This is how skills reach a scaffolded app now that the
      // template no longer bundles them.
      const skillCount = await composeSkills(targetDir, platform, stack);
      if (skillCount > 0) {
        p.log.step(`Added ${skillCount} Claude skills (${platform} · ${stack})`);
      }

      // Move into the freshly-scaffolded app dir so the rest of the flow (install, dev server,
      // sync) runs from inside it. targetDir stays absolute, so callers that already pass it
      // explicitly are unaffected — this just makes the process's cwd match the app.
      process.chdir(targetDir);

      await substituteTemplateVars(targetDir, {
        APP_NAME: appName,
        APP_SLUG: slug,
      });

      if (details) {
        // Store copy is a per-platform LISTING, written and reviewed in the portal — it is
        // deliberately not in the manifest, so Claude's draft lands in a file the developer
        // can paste from rather than being pushed anywhere.
        const wrote = await writeListingDraft(targetDir, appName, details);
        if (wrote) p.log.step("Drafted your listing copy in LISTING.md (via Claude)");
      }

      await gitInit(targetDir);

      const pm = detectPackageManager(flags.pm, targetDir);

      if (!flags["no-install"]) {
        // An explicit --pm is the only way to select a package manager we haven't already
        // confirmed is on PATH; say so here rather than let the install spawn ENOENT.
        if (flags.pm && flags.pm !== "auto") assertInstalled(pm);
        assertSupportedVersion(pm);

        // The template ships pnpm's lockfile. Installing with anything else leaves it stale
        // and pointing later commands back at a package manager this machine may not have.
        const stale = foreignLockfiles(pm, targetDir);
        for (const lockfile of stale) rmSync(lockfile, { force: true });
        if (stale.length > 0) {
          p.log.step(
            `Removed ${stale.map((file) => basename(file)).join(", ")} — installing with ${pm}`,
          );
        }

        p.log.step(`Installing dependencies with ${pm}`);
        await installDependencies(pm, installArgs(pm), targetDir);
      }

      const appFile = join(targetDir, "app.json");
      const hasAppJson = existsSync(appFile);
      const wantSync = !flags["no-sync"] && hasAppJson;

      if (!flags["no-sync"] && !hasAppJson) {
        p.log.warn("No app.json in template — skipping registry registration.");
      }

      // Serving runs the dev server behind the tunnel and (if wanted) publishes the test app.
      // It needs installed deps, and it blocks — so skip it when install or dev is skipped.
      const willServe = !flags["no-install"] && !flags["no-dev"];

      if (!willServe) {
        // No dev server, but the app can still exist in the registry: only PUBLISHING needs a
        // base_url (and therefore the tunnel) — a draft doesn't. So register the manifest as a
        // draft here and hand off, rather than leaving the developer with a local-only app.
        if (wantSync) await this.registerDraft(slug, targetDir, appFile);
        this.printNextSteps(dirName, targetDir, flags["no-install"], wantSync);
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

  // Is this app already in the registry? Answered before a single file is written, so a
  // wrong slug costs nothing and an existing app is never half-adopted.
  //
  //   null              the slug is free — we're creating this app
  //   a Manifest        the app exists and this is its manifest, to scaffold from
  //   null + it exists  the app exists but has no version yet (nothing to export)
  //
  // `mustExist` is --app: a missing app is an error, not a new one. `confirmAdoption` asks
  // first, for when the developer didn't name the slug themselves.
  private async lookupApp(
    appId: string,
    options: { mustExist?: boolean; confirmAdoption?: boolean } = {},
  ): Promise<Manifest | null> {
    await confirmRegistryOverride();

    const spin = p.spinner();
    spin.start(`Checking the registry for ${appId}`);

    const found = await findApp(appId);

    if (!found) {
      if (options.mustExist) {
        spin.stop(`No app you can publish to has the slug "${appId}"`, 1);
        throw new CLIError(
          `No app you can publish to has the slug "${appId}".`,
          "Run `peek apps list` to see what's there, or drop --app to create a new app under that slug.",
        );
      }
      spin.stop(`"${appId}" is free — we'll create it`, 0);
      return null;
    }

    // Building a kit ON a test app is never what's wanted: it's a clone the dev loop owns,
    // and a kit that publishes to it can't have a test app of its own (the registry won't
    // nest them). Point at the source instead.
    if (found.isTestApp) {
      spin.stop(`${appId} is a test app, not an app to build on`, 1);
      const source = found.testAppFor;
      throw new CLIError(
        `${appId} is a test app${source ? ` — the one \`peek dev\` cloned off ${source}` : ""}.`,
        source
          ? `Scaffold for the app it clones instead: \`peek init ${source}\`. Its test app is created and kept up to date by \`peek dev\`.`
          : "Scaffold for the app it was cloned from; `peek dev` manages the test app for you.",
      );
    }

    spin.stop(`${appId} already exists in the registry`, 0);

    // The developer didn't choose this slug — we derived it from a name they typed, or
    // Claude invented it — so adopting someone's live app silently is not on. Pushing to it
    // is what would happen if we carried on, and that would overwrite its manifest.
    if (options.confirmAdoption && !(await this.confirmAdoption(appId))) {
      throw new CLIError(
        `"${appId}" is already taken.`,
        "Run `peek init <another-name>`, or `peek init --app " + appId + "` to build on that app deliberately.",
      );
    }

    p.log.step(
      `This kit will publish to ${appId} — its manifest is what lands in app.json, and nothing of its own is overwritten.`,
    );

    // The draft, not the published version: the newest thing the registry holds is what a
    // fresh kit should be built on.
    const manifest = await tryExportManifest(appId, { draft: true });
    if (!manifest) {
      p.log.step(`${appId} has no version yet, so the kit's starter manifest is used.`);
    }
    return manifest;
  }

  private async confirmAdoption(appId: string): Promise<boolean> {
    p.log.warn(
      [
        `An app with the slug "${appId}" already exists.`,
        "Continuing builds this kit ON that app: it publishes to that slug, and its manifest",
        "replaces the starter kit's in app.json.",
      ].join("\n"),
    );

    // No TTY: refuse rather than guess. Adopting an app nobody asked for and pushing to it
    // is the one outcome here that can't be undone from the CLI.
    if (!process.stdin.isTTY) return false;

    const answer = await p.confirm({ message: `Build on ${appId}?`, initialValue: false });
    return !p.isCancel(answer) && answer === true;
  }

  // Register the app without running it. Draft only: publishing needs a base_url, which only
  // `peek dev` (tunnel) or `peek apps use-url` (a real host) can supply.
  private async registerDraft(appId: string, targetDir: string, appFile: string): Promise<void> {
    await confirmRegistryOverride();

    const spin = p.spinner();
    spin.start(`Registering ${appId} in the registry`);
    try {
      const { manifest } = loadManifest(appFile);
      const result = await upsertManifest({ appId, manifest, autoPublish: false });
      spin.stop(registered(appId, result.action), 0);
      // Shown in this one response and never again, so it has to be persisted now. Written
      // to .env.local as well as printed: an app that skipped the dev loop has no other copy.
      if (result.sharedSecret) {
        await writeEnvLocal(targetDir, { PEEK_APP_SECRET: result.sharedSecret });
        p.log.step("Saved the app secret to .env.local as PEEK_APP_SECRET");
        announceSharedSecret(result.sharedSecret);
      }
    } catch (error) {
      spin.stop(`Couldn't register ${appId}`, 1);
      throw error;
    }
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
    dirName: string,
    targetDir: string,
    skippedInstall: boolean,
    registered: boolean,
  ): void {
    const lines = [
      `Your app is ready at ${targetDir}`,
      "",
      "Next steps:",
      `  cd ${dirName}`,
    ];

    if (skippedInstall) {
      lines.push("  <your package manager> install");
    }

    // `peek dev` (not a bare dev server) is the right entry point — it opens the tunnel and
    // syncs the public URL to the registry, which the app needs to run against it.
    lines.push("  peek dev");

    if (registered) {
      lines.push(
        "",
        "The app is registered as a draft. `peek dev` publishes it at a public tunnel URL;",
        "`peek apps use-url <url>` publishes it at a deployed host.",
      );
    }

    p.outro(lines.join("\n"));
  }
}

// The registry's upsert action, said out loud. Pushing a manifest we just pulled is a
// no_change, which is a success worth naming rather than reporting as an update.
function registered(appId: string, action: string): string {
  if (action === "created") return `Created ${appId} in the registry (draft — not published yet)`;
  if (action === "no_change") return `${appId} is already up to date in the registry`;
  return `Updated ${appId}'s draft in the registry`;
}
