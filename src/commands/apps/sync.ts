import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";

// The retired one-command-two-directions form. `sync-app` (and then `apps sync --pull`)
// hid the most consequential thing about the operation — which way the bytes move — behind
// a flag, so it is now `apps push` and `apps pull`. This shim stays because published
// skills, scripts and docs say the old name: it forwards, and says what to say instead.
//
// It carries the old flag set only so oclif doesn't reject an old invocation before we get
// to forward it; the real flag definitions live on push/pull.
export default class AppsSync extends BaseCommand {
  static description = "Deprecated — use `apps push` or `apps pull`";
  static hidden = true;

  // Deliberately NOT oclif's `state = "deprecated"` + `deprecateAliases`: between them they
  // print two warnings (one for the retired alias, one for the retired command) and neither
  // can say which of the two replacements this invocation actually needs. One accurate line,
  // emitted below, beats two vague ones.
  static hiddenAliases = ["sync-app"];

  static args = {
    file: Args.string({ description: "Path to the manifest", default: "app.json" }),
  };

  static flags = {
    app: Flags.string({ description: "App slug" }),
    test: Flags.boolean({ description: "Target this project's test app", default: false }),
    pull: Flags.boolean({ description: "Pull instead of push", default: false }),
    draft: Flags.boolean({ description: "With --pull, fetch the draft", default: false }),
    "no-publish": Flags.boolean({ description: "Upsert without auto-publishing", default: false }),
    yes: Flags.boolean({ char: "y", description: "Skip the confirmation prompt", default: false }),
    debug: Flags.boolean({ description: "Print request URLs and raw responses", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppsSync);

    this.warn(
      `Deprecated: this is now two commands — run \`peek apps ${flags.pull ? "pull" : "push"}\` instead.`,
    );

    // Forward the raw argv so every flag keeps its original meaning, minus the one flag
    // that has become the command name. --draft only exists on pull, and --no-publish only
    // on push, so drop whichever the destination doesn't take.
    const forwarded = this.argv.filter((arg) => arg !== "--pull");
    const [id, drop] = flags.pull
      ? (["apps:pull", "--no-publish"] as const)
      : (["apps:push", "--draft"] as const);

    await this.config.runCommand(
      id,
      forwarded.filter((arg) => arg !== drop),
    );
  }
}
