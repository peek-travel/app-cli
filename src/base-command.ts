import { Command, Flags } from "@oclif/core";
import * as p from "@clack/prompts";
import { CLIError } from "./errors.js";
import { skipEnvConfirmForSession } from "./lib/registry.js";
import { failure } from "./lib/ui.js";

// Shared base for every command. Its baseFlags are inherited by all subclasses, so
// --skip-env-confirm is accepted (and shown under a GLOBAL help group) everywhere without
// each command redeclaring it. The flag is per-invocation only — nothing is persisted.
export abstract class BaseCommand extends Command {
  static baseFlags = {
    "skip-env-confirm": Flags.boolean({
      description: 'Skip the "Continue against this registry?" prompt when pointed at a non-production registry',
      helpGroup: "GLOBAL",
    }),
  };

  // Every registry-touching command ends the same three ways, so they end here instead of
  // in each command: a CLIError prints its suggestion too (oclif's handler prints only
  // .message, which drops the registry's 422 detail and every "run this instead" hint) and
  // exits 1; an explicit abort is a clean outro, not a failure; anything else is a bug and
  // keeps its stack.
  protected async guard(body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } catch (error) {
      if (error instanceof CLIError) {
        if (error.message === "Aborted.") {
          p.outro("Aborted.");
          return;
        }
        failure(error.message, error.suggestion);
        this.exit(1);
      }
      throw error;
    }
  }

  public async init(): Promise<void> {
    await super.init();
    // Parse here (before run) so the opt-out is registered no matter which command was invoked;
    // the command's own this.parse() call in run() still works and returns the same flags.
    const { flags } = await this.parse(this.ctor as typeof BaseCommand);
    if ((flags as { "skip-env-confirm"?: boolean })["skip-env-confirm"]) {
      skipEnvConfirmForSession();
    }
  }
}
