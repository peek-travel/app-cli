import { existsSync } from "node:fs";
import { join } from "node:path";
import { Args, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { CLIError } from "../../errors.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { resolvePlatform, resolveStack } from "../../lib/axes.js";
import {
  emptyManifest,
  loadManifest,
  type Manifest,
  manifestPlatforms,
  writeManifest,
} from "../../lib/manifest.js";
import { PLATFORM_VALUES, platformLabel } from "../../lib/platforms.js";
import { PROJECT_FILE, readProject, writeLinkMetadata } from "../../lib/project.js";
import { confirmRegistryOverride } from "../../lib/registry.js";
import { STACK_VALUES } from "../../lib/stacks.js";
import { composeSkills, writeEnvLocal } from "../../lib/scaffold.js";
import {
  announceSharedSecret,
  findApp,
  listApps,
  tryExportManifest,
  upsertManifest,
} from "../../lib/sync.js";

// `peek apps link` is `peek init` with the scaffolding taken out. It exists for the codebase
// that already exists: an app written before the CLI did, or a checkout that has to push to
// an app someone else created in the portal. It creates nothing in the registry and writes
// no source code — it answers the one question every registry-touching command needs
// answered ("which app does this directory publish to?"), brings the manifest down beside
// the code, and composes the skills an agent needs to build here.
export default class Link extends BaseCommand {
  static description =
    "Point this directory at an app in the registry (an existing one, or --create a new one)";

  static examples = [
    "<%= config.bin %> apps link",
    "<%= config.bin %> apps link my-existing-app",
    "<%= config.bin %> apps link my-existing-app --no-manifest",
    "<%= config.bin %> apps link my-existing-app --force",
    "<%= config.bin %> apps link brand-new-app --create",
  ];

  static args = {
    "app-slug": Args.string({
      description: "Slug of the registry app this directory publishes to (prompts if omitted)",
    }),
  };

  static flags = {
    platform: Flags.string({
      description: "Platform to compose skills for (default: derived from the app's manifest)",
      options: [...PLATFORM_VALUES],
    }),
    stack: Flags.string({
      description: "Tech stack to compose skills for",
      options: [...STACK_VALUES],
    }),
    "no-manifest": Flags.boolean({
      description: "Leave ./app.json alone instead of writing the app's manifest to it",
      default: false,
    }),
    "no-skills": Flags.boolean({
      description: "Skip composing Claude skills into .claude/skills",
      default: false,
    }),
    create: Flags.boolean({
      description: "Create the app in the registry (as a draft) if no app has that slug yet",
      default: false,
    }),
    force: Flags.boolean({
      description: "Assume yes: repoint an already-linked directory and overwrite ./app.json",
      default: false,
    }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Link);
    const cwd = process.cwd();

    p.intro("peek apps link");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      const appId = args["app-slug"] ?? (await this.pickApp(flags.debug));

      // Fail before writing anything: a slug that isn't in the registry (or isn't this
      // account's) would otherwise be recorded here and only blow up on the next `peek dev`.
      // --create is the one way past this — for a codebase that predates its app entirely.
      const found = await findApp(appId, flags.debug);

      // A test app is the wrong end of the relationship to link to: `peek dev` would then
      // ask the registry to clone a test app OFF a test app, which it refuses ("Cannot
      // create a test app for a test app") long after the mistake was made.
      if (found?.isTestApp) {
        const source = found.testAppFor;
        throw new CLIError(
          `${appId} is a test app${source ? ` — the one \`peek dev\` cloned off ${source}` : ""}.`,
          source
            ? `Link to ${source} instead: \`peek apps link ${source}\`. \`peek dev\` creates and manages ${appId} for you, and \`peek apps push --test\` pushes at it.`
            : "Link to the app it was cloned from; `peek dev` manages the test app for you.",
        );
      }

      const missing = !found;
      if (missing && !flags.create) {
        throw new CLIError(
          `No app you can publish to has the slug "${appId}".`,
          "Run `peek apps list` to see what's there, `peek apps link <slug> --create` to create it, or `peek init` to scaffold a new app.",
        );
      }
      if (missing) {
        if (flags["no-manifest"] && !existsSync(join(cwd, "app.json"))) {
          throw new CLIError(
            `Can't create ${appId} with --no-manifest and no ./app.json.`,
            "The registry needs a manifest to create an app from. Drop --no-manifest and one will be written for you.",
          );
        }
        p.log.step(`No app has the slug "${appId}" yet — it will be created.`);
      }

      await this.confirmRepoint(cwd, appId, flags.force);

      // Draft, not published: the newest thing the registry holds is what the developer
      // wants beside their code. Null means the app has a slug and no version at all.
      const registryManifest =
        flags["no-manifest"] || missing
          ? null
          : await tryExportManifest(appId, { draft: true, debug: flags.debug });

      const recorded = readProject(cwd);
      // Derive only when it can matter: derivePlatform narrates what it found, and an
      // explicit --platform makes that narration wrong.
      const platform = await resolvePlatform(
        flags.platform,
        flags.platform ? undefined : (this.derivePlatform(registryManifest) ?? recorded.platform),
      );
      const stack = await resolveStack(flags.stack, recorded.stack);

      if (!flags["no-manifest"]) {
        await this.writeAppJson(cwd, appId, platform, registryManifest, flags.force, missing);
      }

      // Draft only: publishing needs a base_url, which `peek dev` (tunnel) or `peek apps use-url`
      // (a deployed host) supplies. Registering here just means the slug is taken and the
      // manifest is on file, so the next `peek dev` has an app to clone a test app from.
      if (missing) await this.createApp(cwd, appId, flags.debug);

      writeLinkMetadata(cwd, appId, { platform, stack });
      p.log.step(`${PROJECT_FILE} now points this directory at ${appId}`);

      if (!flags["no-skills"]) {
        const count = await composeSkills(cwd, platform, stack);
        if (count > 0) {
          p.log.step(`Composed ${count} Claude skills into .claude/skills (${platform} · ${stack})`);
        }
      }

      p.outro(
        [
          `Linked to ${appId}.`,
          "",
          "Next steps:",
          "  peek dev        run this app behind a tunnel as its test app",
          "  peek apps sync  push ./app.json back to the registry",
        ].join("\n"),
      );
    });
  }

  private async createApp(cwd: string, appId: string, debug: boolean): Promise<void> {
    const { manifest } = loadManifest(join(cwd, "app.json"));

    const spin = p.spinner();
    spin.start(`Creating ${appId} in the registry`);
    try {
      const result = await upsertManifest({ appId, manifest, autoPublish: false, debug });
      spin.stop(`Created ${appId} (draft — not published yet)`, 0);
      // In this one response and never again, so persist it before anything else can fail.
      if (result.sharedSecret) {
        await writeEnvLocal(cwd, { PEEK_APP_SECRET: result.sharedSecret });
        p.log.step("Saved the app secret to .env.local as PEEK_APP_SECRET");
        announceSharedSecret(result.sharedSecret);
      }
    } catch (error) {
      spin.stop(`Couldn't create ${appId}`, 1);
      throw error;
    }
  }

  // No slug given: show what this account can publish to. There is no name in the
  // publisher API — the slug IS the identifier a developer recognizes.
  private async pickApp(debug: boolean): Promise<string> {
    const apps = (await listApps({ excludeTestApps: true, debug })).sort((a, b) =>
      a.appId.localeCompare(b.appId),
    );

    if (apps.length === 0) {
      throw new CLIError(
        "This account has no apps in the registry yet.",
        "Run `peek init` to scaffold and create one.",
      );
    }

    if (!process.stdin.isTTY) {
      throw new CLIError("No app slug given.", "Pass the slug: `peek apps link <app-slug>`.");
    }

    const answer = await p.select({
      message: "Which app does this directory publish to?",
      options: apps.map((app) => ({ value: app.appId, label: app.appId })),
    });

    if (p.isCancel(answer)) {
      p.cancel("Cancelled");
      throw new CLIError("Aborted.");
    }

    return answer as string;
  }

  // Relinking is legitimate (an app renamed, a fork pointed at its own app) but it changes
  // where every later push lands, so it isn't silent.
  private async confirmRepoint(cwd: string, appId: string, force: boolean): Promise<void> {
    const current = readProject(cwd).app?.id;
    if (!current || current === appId) return;

    p.log.warn(`This directory already publishes to ${current}.`);
    if (force) return;

    if (!process.stdin.isTTY) {
      throw new CLIError(
        `${PROJECT_FILE} already points at ${current}.`,
        `Pass --force to repoint it at ${appId}.`,
      );
    }

    const answer = await p.confirm({
      message: `Repoint it at ${appId}?`,
      initialValue: false,
    });
    if (p.isCancel(answer) || !answer) throw new CLIError("Aborted.");
  }

  // Which platform's skills does this app want? An app that targets exactly one platform
  // answers for itself; one that targets several can't (skills compose for a single
  // platform), so we say so and let the prompt/flag decide.
  private derivePlatform(manifest: Manifest | null): string | undefined {
    if (!manifest) return undefined;

    const platforms = manifestPlatforms(manifest);
    if (platforms.length === 1) return platforms[0];
    if (platforms.length > 1) {
      p.log.info(
        `This app targets ${platforms.map(platformLabel).join(", ")} — pick which one to compose skills for.`,
      );
    }
    return undefined;
  }

  private async writeAppJson(
    cwd: string,
    appId: string,
    platform: string,
    registryManifest: Manifest | null,
    force: boolean,
    creating: boolean,
  ): Promise<void> {
    const file = join(cwd, "app.json");

    // Nothing to bring down — the app is about to be created, or it exists with no version.
    // Either way, lay a valid empty manifest beside the code so there's something to push,
    // and be explicit that it declares nothing.
    if (!registryManifest) {
      const why = creating
        ? `${appId} doesn't exist yet`
        : `${appId} has no version in the registry yet`;

      if (existsSync(file)) {
        p.log.step(`${why} — keeping your app.json${creating ? " and creating the app from it" : ""}.`);
        return;
      }
      writeManifest(file, emptyManifest(platform));
      p.log.warn(
        [
          `${why}, so there was no manifest to pull.`,
          `Wrote an empty one for ${platformLabel(platform)} — it declares nothing, so the app`,
          "surfaces nothing until you add extendables (see `peek extensions list`).",
        ].join("\n"),
      );
      return;
    }

    if (!existsSync(file)) {
      writeManifest(file, registryManifest);
      p.log.step(`Wrote ${appId}'s manifest to app.json`);
      return;
    }

    if (this.sameManifest(file, registryManifest)) {
      p.log.step("app.json already matches the registry.");
      return;
    }

    if (!force) {
      if (!process.stdin.isTTY) {
        p.log.warn(
          "app.json differs from the registry's manifest — left it alone. Pass --force to overwrite it, or `peek apps sync` to push yours.",
        );
        return;
      }
      const answer = await p.confirm({
        message: `app.json differs from ${appId}'s manifest. Overwrite it?`,
        initialValue: false,
      });
      if (p.isCancel(answer) || !answer) {
        p.log.step("Kept your app.json — push it with `peek apps sync` when you're ready.");
        return;
      }
    }

    writeManifest(file, registryManifest);
    p.log.step(`Overwrote app.json with ${appId}'s manifest`);
  }

  // Compare what's on disk with what came back, through the same loader a push uses — so a
  // manifest that only differs by legacy shape or key order doesn't read as a conflict.
  private sameManifest(file: string, registryManifest: Manifest): boolean {
    try {
      return stable(loadManifest(file).manifest) === stable(registryManifest);
    } catch {
      // Unreadable or invalid: treat as different, so the developer is asked rather than
      // having a broken file quietly kept.
      return false;
    }
  }
}

function stable(manifest: Manifest): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
  );
}
