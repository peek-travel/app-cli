import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLIError } from "../errors.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const KNOWN: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

// Minimum major version a package manager must be to install the starter template.
// The template targets pnpm 11: its pnpm-workspace.yaml uses the `allowBuilds` build
// policy (pnpm 10.16+) and pnpm 11 also raised the Node floor. Older pnpm fails with
// confusing errors ("packages field missing or empty" on 9, an ignored-builds prompt
// on unpinned 10), so guard up front with an actionable message instead.
const MIN_MAJOR: Partial<Record<PackageManager, number>> = { pnpm: 11 };

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
  return KNOWN.includes(name as PackageManager)
    ? (name as PackageManager)
    : undefined;
}

function isInstalled(pm: PackageManager): boolean {
  try {
    return spawnSync(pm, ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function detectPackageManager(
  override?: string,
  targetDir?: string,
): PackageManager {
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

// Parse the major version out of a `pm --version` string ("10.25.0" -> 10). Returns
// undefined for anything unparseable so callers can treat "unknown" as "don't block".
export function parseMajor(version: string): number | undefined {
  const major = Number.parseInt(version.trim().split(".")[0], 10);
  return Number.isNaN(major) ? undefined : major;
}

// Pure version-policy check: given a package manager and the major version installed
// (undefined if it couldn't be determined), return a CLIError to throw or undefined to
// proceed. Split out from the spawn so it's deterministically testable.
export function unsupportedVersionError(
  pm: PackageManager,
  major: number | undefined,
): CLIError | undefined {
  const min = MIN_MAJOR[pm];
  if (min === undefined || major === undefined || major >= min)
    return undefined;

  return new CLIError(
    `${pm} ${major} is too old — the starter template needs ${pm} ${min} or newer.`,
    `Upgrade (e.g. "npm install -g ${pm}@latest" or "corepack use ${pm}@${min}"), ` +
      `then re-run. Or pick another package manager: "peek init --pm npm".`,
  );
}

function installedMajor(pm: PackageManager): number | undefined {
  const result = spawnSync(pm, ["--version"], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string")
    return undefined;
  return parseMajor(result.stdout);
}

// Throw a clear, actionable CLIError when the selected package manager is too old for
// the template. A no-op for package managers without a minimum, or when the version
// can't be read (don't block on an unknown).
export function assertSupportedVersion(pm: PackageManager): void {
  const error = unsupportedVersionError(pm, installedMajor(pm));
  if (error) throw error;
}
