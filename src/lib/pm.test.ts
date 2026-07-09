import { describe, expect, it } from "vitest";
import { CLIError } from "../errors.js";
import { installArgs, parseMajor, runArgs, unsupportedVersionError } from "./pm.js";

describe("installArgs", () => {
  it("suppresses pnpm's strict ignored-builds failure", () => {
    expect(installArgs("pnpm")).toEqual(["install", "--config.strict-dep-builds=false"]);
  });

  it("uses a plain install for npm and bun", () => {
    expect(installArgs("npm")).toEqual(["install"]);
    expect(installArgs("bun")).toEqual(["install"]);
  });

  it("passes no args for yarn (bare `yarn` installs)", () => {
    expect(installArgs("yarn")).toEqual([]);
  });
});

describe("runArgs", () => {
  it("skips pnpm's pre-run deps check and keeps strict builds demoted", () => {
    expect(runArgs("pnpm", "dev")).toEqual([
      "run",
      "--config.strict-dep-builds=false",
      "--config.verify-deps-before-run=false",
      "dev",
    ]);
  });

  it("uses a bare `run <script>` for other managers", () => {
    expect(runArgs("npm", "dev")).toEqual(["run", "dev"]);
    expect(runArgs("yarn", "dev")).toEqual(["run", "dev"]);
    expect(runArgs("bun", "build")).toEqual(["run", "build"]);
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
