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

export function detectPackageManager(override?: string, targetDir?: string): PackageManager {
  if (override && override !== "auto") {
    if (!KNOWN.includes(override as PackageManager)) {
      throw new Error(`Unknown package manager: ${override}`);
    }
    return override as PackageManager;
  }

  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    const name = userAgent.split("/")[0];
    if (KNOWN.includes(name as PackageManager)) {
      return name as PackageManager;
    }
  }

  if (targetDir) {
    for (const [lockfile, pm] of Object.entries(LOCKFILES)) {
      if (existsSync(join(targetDir, lockfile))) {
        return pm;
      }
    }
  }

  return "npm";
}

export function installArgs(pm: PackageManager): string[] {
  return pm === "yarn" ? [] : ["install"];
}
