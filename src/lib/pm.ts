import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const KNOWN: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

const LOCKFILES: Record<string, PackageManager> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "package-lock.json": "npm",
};

// The invoking package manager, per npm_config_user_agent (e.g. "pnpm dlx" sets pnpm,
// plain "npx" sets npm). Undefined if not launched by a package manager.
function invokingPm(): PackageManager | undefined {
  const name = process.env.npm_config_user_agent?.split("/")[0];
  return KNOWN.includes(name as PackageManager) ? (name as PackageManager) : undefined;
}

function isInstalled(pm: PackageManager): boolean {
  try {
    return spawnSync(pm, ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function detectPackageManager(override?: string, targetDir?: string): PackageManager {
  if (override && override !== "auto") {
    if (!KNOWN.includes(override as PackageManager)) {
      throw new Error(`Unknown package manager: ${override}`);
    }
    return override as PackageManager;
  }

  // 1. A lockfile in the project wins — it's the template author's / project's explicit choice.
  if (targetDir) {
    for (const [lockfile, pm] of Object.entries(LOCKFILES)) {
      if (existsSync(join(targetDir, lockfile))) {
        return pm;
      }
    }
  }

  // 2. A deliberate non-npm invocation (`pnpm dlx`, `yarn dlx`, `bunx`) — honor it.
  const invoking = invokingPm();
  if (invoking && invoking !== "npm") return invoking;

  // 3. npm invocation (including `npx`, which always sets npm). npx forcing npm shouldn't
  //    override a developer who uses pnpm — prefer pnpm when it's on PATH.
  if (isInstalled("pnpm")) return "pnpm";

  // 4. Fall back to however we were invoked, else npm.
  return invoking ?? "npm";
}

export function installArgs(pm: PackageManager): string[] {
  return pm === "yarn" ? [] : ["install"];
}
