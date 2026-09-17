import { beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

const CLI = join(import.meta.dirname, "..", "bin", "run.js");

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
      ["init", appName, "--platform", "peek", "--stack", "javascript", "--no-sync", "--no-dev"],
      { cwd: workdir, env: cliEnv() },
    );

    const targetDir = join(workdir, appName);

    const pkg = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
    expect(pkg.name).toBe(appName);

    const readme = await readFile(join(targetDir, "README.md"), "utf8");
    expect(readme).toContain(appName);
    expect(readme).not.toContain("{{APP_NAME}}");

    // app.json is the manifest and only the manifest: extendables keyed by who consumes
    // them, no app slug and no listing copy.
    const manifest = JSON.parse(await readFile(join(targetDir, "app.json"), "utf8"));
    expect(Object.keys(manifest).sort()).toEqual(["acme", "cng", "peek", "registry"]);
    expect(manifest.registry.map((e: { slug: string }) => e.slug)).toContain(
      "app_registry_settings_url@v1",
    );
    // The selected platform is the one with a list; the rest are explicitly null.
    expect(manifest.peek).toHaveLength(1);
    expect(manifest.acme).toBeNull();
    expect(manifest.cng).toBeNull();

    // The slug the registry knows the app by lives in the project file instead.
    const kit = JSON.parse(await readFile(join(targetDir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe(appName);

    // The kit's example manifests are consumed, not left lying around: a scaffolded app has
    // exactly one manifest, so there's nothing to edit by mistake.
    const scaffolded = await readdir(targetDir);
    expect(scaffolded.filter((f) => f.startsWith("app.example."))).toEqual([]);

    const nodeModules = await stat(join(targetDir, "node_modules"));
    expect(nodeModules.isDirectory()).toBe(true);

    const nextBin = await stat(join(targetDir, "node_modules", "next"));
    expect(nextBin.isDirectory()).toBe(true);

    const gitDir = await stat(join(targetDir, ".git"));
    expect(gitDir.isDirectory()).toBe(true);

    // Skills are composed into .claude/skills/ from global + platform/peek + stack/javascript,
    // each folder named after the skill's frontmatter `name`.
    for (const skill of ["app-builder", "peek-embed-and-auth", "javascript-nextjs"]) {
      const skillFile = await stat(join(targetDir, ".claude", "skills", skill, "SKILL.md"));
      expect(skillFile.isFile()).toBe(true);
    }
  }, 120_000);

  it("coerces a messy app name into a valid slug directory", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "peek-init-"));

    await execa(
      CLI,
      ["init", "My Cool App!", "--platform", "peek", "--stack", "javascript", "--no-install", "--no-sync", "--no-dev"],
      { cwd: workdir, env: cliEnv() },
    );

    const slugDir = await stat(join(workdir, "my-cool-app"));
    expect(slugDir.isDirectory()).toBe(true);

    // .peek-kit.json records the app's slug, the starter kit, and the CLI version.
    const kit = JSON.parse(await readFile(join(workdir, "my-cool-app", ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-cool-app");
    expect(kit.starterKit).toBe("nextjs-starter-kit");
    expect(kit.platform).toBe("peek");
    expect(kit.stack).toBe("javascript");
    expect(kit.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("refuses to scaffold into a non-empty directory", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "peek-init-"));
    const appName = "demo-app";
    await execa("mkdir", [appName], { cwd: workdir });
    await execa("touch", [join(appName, "existing-file")], { cwd: workdir });

    await expect(
      execa(CLI, ["init", appName, "--platform", "peek", "--stack", "javascript", "--no-sync", "--no-dev"], {
        cwd: workdir,
        env: cliEnv(),
      }),
    ).rejects.toThrow();
  });
});
