import { Command, Flags } from "@oclif/core";
import { skipEnvConfirmForSession } from "./lib/registry.js";

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
