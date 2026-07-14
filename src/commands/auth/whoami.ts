import { Command } from "@oclif/core";
import * as p from "@clack/prompts";
import { fetchUserEmail } from "../../lib/auth.js";
import { getRegistryUrl } from "../../lib/registry.js";
import { isLoggedIn } from "../../lib/session.js";

export default class AuthWhoami extends Command {
  static description = "Show which account you're signed in as, and against which registry";

  async run(): Promise<void> {
    await this.parse(AuthWhoami);

    p.intro("peek auth whoami");

    if (!isLoggedIn()) {
      p.outro("Not signed in. Run `peek auth login` to sign in.");
      return;
    }

    const email = await fetchUserEmail();

    p.note(
      [`Account:  ${email ?? "(unknown — couldn't reach the registry)"}`, `Registry: ${getRegistryUrl()}`].join("\n"),
      "Signed in",
    );
    p.outro("Done.");
  }
}
