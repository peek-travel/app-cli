import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIError } from "../errors.js";
import {
  LEGACY_DEV_FILE,
  openProject,
  packageSlug,
  readProject,
  resolveAppId,
  slugify,
  updateProject,
  writeKitMetadata,
} from "./project.js";

// openProject narrates what it migrated through clack; nothing here asserts on that output.
vi.mock("@clack/prompts", () => ({ log: { step: () => {} } }));

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "peek-project-"));
});

function write(name: string, contents: unknown): void {
  writeFileSync(join(cwd, name), JSON.stringify(contents), "utf8");
}

describe("slugify", () => {
  it("makes a registry-safe slug from a human name", () => {
    expect(slugify("Waiver Wizard")).toBe("waiver-wizard");
    expect(slugify("Peek's App!")).toBe("peeks-app");
    expect(slugify("Café Deluxe")).toBe("cafe-deluxe");
  });

  it("prefixes anything that wouldn't start with a letter", () => {
    expect(slugify("2 Fast")).toBe("app-2-fast");
  });
});

describe("the project file", () => {
  it("merges patches without dropping the app it already knows", () => {
    writeKitMetadata(cwd, "nextjs-starter-kit", "peek", "javascript", "waiver-wizard");
    updateProject(cwd, { app: { testId: "waiver-wizard-test-dev" } });

    const project = readProject(cwd);
    expect(project.app).toEqual({ id: "waiver-wizard", testId: "waiver-wizard-test-dev" });
    expect(project.starterKit).toBe("nextjs-starter-kit");
    expect(project.platform).toBe("peek");
  });

  it("treats a mangled file as absent rather than failing the dev loop", () => {
    writeFileSync(join(cwd, ".peek-kit.json"), "{not json", "utf8");
    expect(readProject(cwd)).toEqual({});
  });
});

describe("resolveAppId", () => {
  it("prefers the flag, then the project file", () => {
    write(".peek-kit.json", { app: { id: "recorded" } });

    expect(resolveAppId(cwd, { flag: "explicit" })).toEqual({
      appId: "explicit",
      source: "flag",
    });
    expect(resolveAppId(cwd)).toEqual({ appId: "recorded", source: "project" });
  });

  it("adopts the slug a legacy manifest carried, and records it", () => {
    expect(resolveAppId(cwd, { legacyAppId: "from-manifest" })).toEqual({
      appId: "from-manifest",
      source: "manifest",
    });
    expect(readProject(cwd).app?.id).toBe("from-manifest");
  });

  it("falls back to the package name, and records that too", () => {
    write("package.json", { name: "Waiver Wizard" });

    expect(resolveAppId(cwd)).toEqual({ appId: "waiver-wizard", source: "package" });
    expect(readProject(cwd).app?.id).toBe("waiver-wizard");
  });

  it("gives up with a suggestion when nothing names the app", () => {
    expect(() => resolveAppId(cwd)).toThrow(CLIError);
    expect(() => resolveAppId(cwd)).toThrow(/Could not work out which app this is/);
  });
});

describe("packageSlug", () => {
  it("is undefined when there's no usable name", () => {
    expect(packageSlug(cwd)).toBeUndefined();
    write("package.json", { version: "1.0.0" });
    expect(packageSlug(cwd)).toBeUndefined();
  });
});

describe("openProject, on a project built against the old API", () => {
  beforeEach(() => {
    write("app.json", {
      data: {
        app: {
          id: "waiver-wizard",
          app_version: {
            base_url: "https://example.com",
            platforms: ["peek"],
            registry_extendables: [
              { slug: "app_registry_webhook@v1", configuration: { url: "/hook" } },
            ],
            platform_extendables: {
              peek: [{ slug: "peek_backoffice_api@v1", configuration: {} }],
            },
          },
        },
      },
    });
    write(LEGACY_DEV_FILE, { data: { app: { id: "waiver-wizard-test-dev" } } });
  });

  it("moves every fact to where it lives now", () => {
    const opened = openProject(cwd, join(cwd, "app.json"));

    // The manifest keeps only what a manifest holds...
    expect(opened.manifest).toEqual({
      global: [{ slug: "app_registry_webhook@v1", configuration: { url: "/hook" } }],
      peek: [{ slug: "peek_backoffice_api@v1", configuration: {} }],
      acme: null,
      cng: null,
    });
    // ...and the file on disk is rewritten to match, so a pull returns the same bytes.
    expect(JSON.parse(readFileSync(join(cwd, "app.json"), "utf8"))).toEqual(opened.manifest);

    // The slug moves out of the manifest, and the test app out of app-dev.json.
    expect(opened.appId).toBe("waiver-wizard");
    expect(opened.testAppId).toBe("waiver-wizard-test-dev");
    expect(readProject(cwd).app).toEqual({
      id: "waiver-wizard",
      testId: "waiver-wizard-test-dev",
    });
    expect(existsSync(join(cwd, LEGACY_DEV_FILE))).toBe(false);
  });

  it("is a no-op the second time", () => {
    openProject(cwd, join(cwd, "app.json"));
    const again = openProject(cwd, join(cwd, "app.json"));

    expect(again.appId).toBe("waiver-wizard");
    expect(again.testAppId).toBe("waiver-wizard-test-dev");
  });
});
