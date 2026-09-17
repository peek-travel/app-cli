import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIError } from "../errors.js";
import {
  assertInstalled,
  detectPackageManager,
  foreignLockfiles,
  installArgs,
  parseMajor,
  unsupportedVersionError,
} from "./pm.js";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync }));

// Pretend only these package managers are on PATH — everything else exits non-zero, the
// way spawning a binary that isn't there does.
function onPath(...installed: string[]): void {
  spawnSync.mockImplementation((command: string) => ({
    status: installed.includes(command) ? 0 : 1,
    stdout: "10.25.0",
  }));
}

function projectWith(...lockfiles: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "peek-pm-"));
  for (const lockfile of lockfiles) writeFileSync(join(dir, lockfile), "", "utf8");
  return dir;
}

describe("detectPackageManager", () => {
  const userAgent = process.env.npm_config_user_agent;

  beforeEach(() => {
    // npx always reports npm, which is the case the reports come from.
    process.env.npm_config_user_agent = "npm/10.9.0 node/v22.11.0";
  });

  afterEach(() => {
    if (userAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = userAgent;
    spawnSync.mockReset();
  });

  it("uses the lockfile's package manager when it is installed", () => {
    onPath("npm", "pnpm");

    expect(detectPackageManager("auto", projectWith("pnpm-lock.yaml"))).toBe("pnpm");
  });

  it("ignores the lockfile's package manager when it is not installed", () => {
    // The starter template ships a pnpm-lock.yaml, so this is every developer who has
    // never installed pnpm running `npx @peektravel/app-cli init`.
    onPath("npm");

    expect(detectPackageManager("auto", projectWith("pnpm-lock.yaml"))).toBe("npm");
  });

  it("skips an uninstalled lockfile owner for one that is installed", () => {
    onPath("npm");

    expect(detectPackageManager("auto", projectWith("pnpm-lock.yaml", "package-lock.json"))).toBe(
      "npm",
    );
  });

  it("prefers pnpm over an npx invocation when pnpm is on PATH", () => {
    onPath("npm", "pnpm");

    expect(detectPackageManager("auto", projectWith())).toBe("pnpm");
  });

  it("honors an explicit override without probing PATH", () => {
    onPath("npm");

    expect(detectPackageManager("pnpm", projectWith("package-lock.json"))).toBe("pnpm");
  });
});

describe("assertInstalled", () => {
  afterEach(() => spawnSync.mockReset());

  it("throws an actionable error when the binary is missing", () => {
    onPath("npm");

    expect(() => assertInstalled("pnpm")).toThrow(CLIError);
    expect(() => assertInstalled("pnpm")).toThrow(/pnpm is not installed/);
  });

  it("passes when the binary is there", () => {
    onPath("npm", "pnpm");

    expect(() => assertInstalled("pnpm")).not.toThrow();
  });
});

describe("foreignLockfiles", () => {
  it("lists the lockfiles belonging to another package manager", () => {
    const dir = projectWith("pnpm-lock.yaml");

    expect(foreignLockfiles("npm", dir)).toEqual([join(dir, "pnpm-lock.yaml")]);
  });

  it("leaves the chosen package manager's own lockfile alone", () => {
    const dir = projectWith("pnpm-lock.yaml");

    expect(foreignLockfiles("pnpm", dir)).toEqual([]);
  });

  it("is empty for a project with no lockfiles", () => {
    expect(foreignLockfiles("npm", projectWith())).toEqual([]);
  });
});

describe("installArgs", () => {
  it("uses a plain install for npm, pnpm, and bun", () => {
    expect(installArgs("npm")).toEqual(["install"]);
    expect(installArgs("pnpm")).toEqual(["install"]);
    expect(installArgs("bun")).toEqual(["install"]);
  });

  it("passes no args for yarn (bare `yarn` installs)", () => {
    expect(installArgs("yarn")).toEqual([]);
  });
});

describe("parseMajor", () => {
  it("extracts the major version", () => {
    expect(parseMajor("10.25.0")).toBe(10);
    expect(parseMajor("9.12.3")).toBe(9);
    expect(parseMajor(" 8.0.0\n")).toBe(8);
  });

  it("returns undefined for unparseable input", () => {
    expect(parseMajor("")).toBeUndefined();
    expect(parseMajor("not-a-version")).toBeUndefined();
  });
});

describe("unsupportedVersionError", () => {
  it("blocks pnpm below the minimum with an actionable message", () => {
    const error = unsupportedVersionError("pnpm", 9);
    expect(error).toBeInstanceOf(CLIError);
    expect(error?.message).toContain("pnpm 9 is too old");
    expect(error?.suggestion).toContain("--pm npm");
  });

  it("allows pnpm at or above the minimum", () => {
    expect(unsupportedVersionError("pnpm", 10)).toBeUndefined();
    expect(unsupportedVersionError("pnpm", 11)).toBeUndefined();
  });

  it("does not block package managers without a minimum", () => {
    expect(unsupportedVersionError("npm", 6)).toBeUndefined();
    expect(unsupportedVersionError("yarn", 1)).toBeUndefined();
    expect(unsupportedVersionError("bun", 0)).toBeUndefined();
  });

  it("does not block when the version is unknown", () => {
    expect(unsupportedVersionError("pnpm", undefined)).toBeUndefined();
  });
});
