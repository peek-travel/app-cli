import { Command } from "@oclif/core";
import * as p from "@clack/prompts";
import { login } from "../lib/auth.js";
import { isLoggedIn } from "../lib/session.js";

export default class Login extends Command {
  static description = "Sign in to the Peek app registry";

  async run(): Promise<void> {
    await this.parse(Login);

    p.intro("peek login");

    if (isLoggedIn()) {
      p.outro("Already signed in. Run `peek logout` first to switch accounts.");
      return;
    }

    await login();
    p.outro("Signed in.");
  }
}
