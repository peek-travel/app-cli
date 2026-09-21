import { Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { ensureLoggedIn } from "../../lib/auth.js";
import { readProject } from "../../lib/project.js";
import {
  confirmRegistryOverride,
  getRegistryUrl,
  warnOnStderrForSession,
} from "../../lib/registry.js";
import { listApps, type RegistryApp } from "../../lib/sync.js";

export default class AppsList extends BaseCommand {
  static description = "List the apps this account can publish to";

  static examples = [
    "<%= config.bin %> apps list",
    "<%= config.bin %> apps list --search waiver",
    "<%= config.bin %> apps list --test-apps",
    "<%= config.bin %> apps list --json",
  ];

  static flags = {
    search: Flags.string({ description: "Only show apps whose slug matches this text" }),
    "test-apps": Flags.boolean({
      description: "Also show the test apps `peek dev` cloned off them",
      default: false,
    }),
    json: Flags.boolean({ description: "Output raw JSON instead of a formatted list", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppsList);
    const cwd = process.cwd();

    // --json is a machine surface: no clack chrome, and the registry-override warning
    // routed to stderr, so stdout carries nothing but the JSON.
    if (flags.json) warnOnStderrForSession();
    else p.intro("peek apps list");

    await confirmRegistryOverride();
    await ensureLoggedIn();

    await this.guard(async () => {
      // Test apps are clones of the apps beside them in this list — same listing, derived
      // slug, owned by the dev loop. They are not something you build on or link to, so
      // they're out of the default answer to "which apps do I have?".
      const apps = (
        await listApps({
          search: flags.search,
          excludeTestApps: !flags["test-apps"],
          debug: flags.debug,
        })
      ).sort((a, b) => a.appId.localeCompare(b.appId));

      if (flags.json) {
        // Slugs and the test-app relationship. The endpoint also hands back each app's
        // shared secret, and this output is piped, logged and pasted — so it never
        // carries one.
        this.log(
          JSON.stringify(
            apps.map((app) => ({
              id: app.appId,
              isTestApp: app.isTestApp,
              testAppFor: app.testAppFor ?? null,
            })),
            null,
            2,
          ),
        );
        return;
      }

      if (apps.length === 0) {
        p.outro(
          flags.search
            ? `No app slug matches "${flags.search}" on ${getRegistryUrl()}.`
            : "This account has no apps yet. Run `peek init` to create one.",
        );
        return;
      }

      const project = readProject(cwd).app ?? {};
      p.log.message(apps.map((app) => row(app, project)).join("\n"));

      const sources = apps.filter((app) => !app.isTestApp).length;
      const testApps = apps.length - sources;
      p.outro(
        [
          `${sources} app${sources === 1 ? "" : "s"}`,
          testApps > 0 ? ` + ${testApps} test app${testApps === 1 ? "" : "s"}` : "",
          ` on ${getRegistryUrl()}.`,
          " Point a directory at one with `peek apps link <slug>`.",
        ].join(""),
      );
    });
  }

}

// One app per line: its slug, then what it is — a test app names the app it clones, and the
// app (or test app) of the directory we're standing in is marked, so the listing answers
// "which of these am I in?" without a second command. The slug stays first and unindented
// so it's still the thing you copy.
function row(app: RegistryApp, project: { id?: string; testId?: string }): string {
  const notes: string[] = [];
  if (app.isTestApp) {
    notes.push(app.testAppFor ? `test app for ${app.testAppFor}` : "test app");
  }
  if (app.appId === project.id) notes.push("← this directory");
  else if (app.appId === project.testId) notes.push("← this directory's test app");

  return `  ${app.appId}${notes.length > 0 ? `  (${notes.join(", ")})` : ""}`;
}
