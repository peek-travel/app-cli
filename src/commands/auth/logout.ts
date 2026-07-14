import { Command } from "@oclif/core";
import * as p from "@clack/prompts";
import { clear, isLoggedIn } from "../../lib/session.js";

export default class AuthLogout extends Command {
  static description = "Sign out of the Peek app registry";

  async run(): Promise<void> {
    await this.parse(AuthLogout);

    p.intro("peek auth logout");

    const wasLoggedIn = isLoggedIn();
    // Always remove the session file — an expired or registry-mismatched token reads as
    // "not signed in" but may still be sitting on disk.
    clear();

    p.outro(wasLoggedIn ? "Signed out." : "Not signed in.");
  }
}
