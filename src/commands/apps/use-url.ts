import { Flags, Args } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { CLIError } from "../../errors.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { readProject } from "../../lib/project.js";
import { confirmRegistryOverride } from "../../lib/registry.js";
import { publishDraft, setBaseUrl } from "../../lib/sync.js";

export default class AppsUseUrl extends BaseCommand {
  static description =
    "Point an app at a permanent base URL (e.g. a deployed host) and publish it";

  // Was `peek use-url` before the surface was organized into topics.
  // hiddenAliases, not aliases: it still resolves and still warns, but the retired name
  // is not offered to anyone reading `peek --help` for the first time.
  static hiddenAliases = ["use-url"];
  static deprecateAliases = true;

  static examples = [
    "<%= config.bin %> apps use-url https://myapp.fly.dev",
    "<%= config.bin %> apps use-url https://myapp.fly.dev --prod",
  ];

  static args = {
    url: Args.string({ description: "The base URL the app is served from, e.g. https://myapp.fly.dev", required: true }),
  };

  static flags = {
    // Defaults to this project's test app — the same app `peek dev` publishes — because
    // that's the one whose base_url normally moves (tunnel → a real host). --prod targets
    // the source app, and --app targets any slug.
    prod: Flags.boolean({
      description: "Target the source (production) app instead of the test app",
      default: false,
    }),
    app: Flags.string({ description: "App slug to point at the URL" }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppsUseUrl);
    const cwd = process.cwd();

    p.intro("peek apps use-url");

    const url = normalizeUrl(args.url);
    const appId = this.targetApp(cwd, flags);

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      // Publishing makes the new origin live for everyone who has the app installed, so
      // say what's about to happen and get a yes — loudly for a production app.
      if (!flags.yes) {
        p.log.info(
          [
            "Ready to publish:",
            `  App: ${appId}`,
            `  Base URL: ${url}`,
          ].join("\n"),
        );
        const message = flags.prod
          ? "This publishes a new PRODUCTION version. Continue?"
          : "Continue?";
        const answer = await p.confirm({ message, initialValue: false });
        if (p.isCancel(answer) || !answer) throw new CLIError("Aborted.");
      }

      // base_url isn't in the manifest — it's its own endpoint, written onto the draft
      // (cloning the published version first if needed). Publishing is the separate step
      // that makes it live.
      await setBaseUrl(appId, url, flags.debug);
      p.log.step(`Set base_url to ${url}`);

      const version = await publishDraft(appId, flags.debug);
      p.log.success(`Published ${version.displayVersion}`);

      const links = Object.entries(version.appUrls);
      if (links.length > 0) {
        p.note(links.map(([label, link]) => `  ${label}  ${link}`).join("\n"), "Install links");
      }

      // Inside the guard: a declined confirm aborts, and an abort must not print a "done".
      p.outro(`Done — ${appId} now answers at ${url}`);
    });
  }

  private targetApp(cwd: string, flags: { app?: string; prod: boolean }): string {
    if (flags.app) return flags.app;

    const project = readProject(cwd).app ?? {};

    if (flags.prod) {
      if (!project.id) {
        throw new CLIError(
          "No app recorded for this directory.",
          "Run this from inside a Peek app directory, or pass --app <slug>.",
        );
      }
      return project.id;
    }

    if (!project.testId) {
      throw new CLIError(
        "This project has no test app yet.",
        "Run `peek dev` once to create one, pass --app <slug>, or use --prod to target the source app.",
      );
    }
    return project.testId;
  }
}

function normalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    // URL normalizes a bare host to a trailing slash — drop it so base_url matches the tunnel form.
    return u.toString().replace(/\/$/, "");
  } catch {
    throw new CLIError(`"${input}" is not a valid http(s) URL.`, "Pass a full URL, e.g. https://myapp.fly.dev");
  }
}
