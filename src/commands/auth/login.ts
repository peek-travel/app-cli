import * as p from "@clack/prompts";
import { BaseCommand } from "../../base-command.js";
import { login } from "../../lib/auth.js";
import { isLoggedIn } from "../../lib/session.js";

export default class AuthLogin extends BaseCommand {
  static description = "Sign in to the Peek app registry";

  async run(): Promise<void> {
    await this.parse(AuthLogin);

    p.intro("peek auth login");

    if (isLoggedIn()) {
      p.outro("Already signed in. Run `peek auth logout` first to switch accounts.");
      return;
    }

    await login();
    p.outro("Signed in.");
  }
}
