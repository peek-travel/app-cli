import { beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

const CLI = join(import.meta.dirname, "..", "bin", "run.js");
// PEEK_INIT_TEMPLATE points init at this lightweight fixture instead of the bundled kit,
// keeping the suite fast and hermetic. It's a test-only seam — there is no user-facing
// template option.
const FIXTURE_TEMPLATE = `file:${join(import.meta.dirname, "fixtures", "starter-nextjs")}`;

// The CLI reads auth (session.json) and config (settings.json) from configDir(),
// which honors XDG_CONFIG_HOME. Point it at a throwaway dir per test so the suite
// never touches — or depends on — the developer's real ~/.config/peek. Also drop any
// inherited PEEK_TOKEN so the isolated env is the only source of auth.
let configHome: string;

function cliEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const { PEEK_TOKEN: _drop, XDG_CONFIG_HOME: _dropXdg, ...rest } = process.env;
  return { ...rest, XDG_CONFIG_HOME: configHome, PEEK_TOKEN: "test-token", ...extra };
}

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "peek-config-"));
  // `requireAccount` probes the registry to verify developer access before scaffolding.
  // Point it at an unroutable URL so that check fails fast (fetch rejects → treated as a
  // non-blocking network error) instead of reaching the real registry from the test suite.
  const peekDir = join(configHome, "peek");
  await mkdir(peekDir, { recursive: true });
  await writeFile(join(peekDir, "settings.json"), JSON.stringify({ registryUrl: "http://127.0.0.1:1" }));
});

describe("peek init", () => {
  it("scaffolds, substitutes vars, and installs deps", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "peek-init-"));
    const appName = "demo-app";

    await execa(
      CLI,
      ["init", appName, "--platform", "peek", "--no-sync", "--no-dev"],
      { cwd: workdir, env: cliEnv({ PEEK_INIT_TEMPLATE: FIXTURE_TEMPLATE }) },
    );

    const targetDir = join(workdir, appName);

    const pkg = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
    expect(pkg.name).toBe(appName);

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain(appName);
    expect(readme).not.toContain("{{APP_NAME}}");

    const app = JSON.parse(await readFile(join(targetDir, "app.json"), "utf8"));
    expect(app.data.app.id).toBe(appName);
    expect(app.data.app.name.en).toBe(appName);

    const nodeModules = await stat(join(targetDir, "node_modules"));
    expect(nodeModules.isDirectory()).toBe(true);

    const nextBin = await stat(join(targetDir, "node_modules", "next"));
    expect(nextBin.isDirectory()).toBe(true);

    const gitDir = await stat(join(targetDir, ".git"));
    expect(gitDir.isDirectory()).toBe(true);
  }, 120_000);

  it("coerces a messy app name into a valid slug directory", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "peek-init-"));

    await execa(
      CLI,
      ["init", "My Cool App!", "--platform", "peek", "--no-install", "--no-sync", "--no-dev"],
      { cwd: workdir, env: cliEnv({ PEEK_INIT_TEMPLATE: FIXTURE_TEMPLATE }) },
    );

    const slugDir = await stat(join(workdir, "my-cool-app"));
    expect(slugDir.isDirectory()).toBe(true);

    // APP_NAME keeps the original label; APP_SLUG is the sanitized id.
    const app = JSON.parse(await readFile(join(workdir, "my-cool-app", "app.json"), "utf8"));
    expect(app.data.app.id).toBe("my-cool-app");
    expect(app.data.app.name.en).toBe("My Cool App!");
  });

  it("refuses to scaffold into a non-empty directory", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "peek-init-"));
    const appName = "demo-app";
    await execa("mkdir", [appName], { cwd: workdir });
    await execa("touch", [join(appName, "existing-file")], { cwd: workdir });

    await expect(
      execa(CLI, ["init", appName, "--platform", "peek", "--no-sync", "--no-dev"], {
        cwd: workdir,
        env: cliEnv({ PEEK_INIT_TEMPLATE: FIXTURE_TEMPLATE }),
      }),
    ).rejects.toThrow();
  });
});
