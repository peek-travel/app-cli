import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

const CLI = join(import.meta.dirname, "..", "bin", "run.js");

// `peek link` is all registry reads, so these drive the real binary against a stub publisher
// API rather than mocking the client: what's asserted is the whole path from argv through the
// HTTP shape the registry actually serves to the files left on disk.
const MANIFEST = {
  global: [{ slug: "app_registry_settings_url@v1", configuration: { url: "/main" } }],
  peek: [{ slug: "peek_backoffice_api@v1", configuration: {} }],
  acme: null,
  cng: null,
};

let server: Server;
let registryUrl: string;
let configHome: string;
// Slugs the stub registry knows about, so a test can make a lookup 404.
let known: string[];
// Test apps, as the registry reports them: slug → the source app it clones.
let testApps: Record<string, string>;
// Apps whose export returns 422 — a real state: a slug with no version yet.
let versionless: string[];
// Every request the stub served, so a test can assert what the CLI actually pushed.
let requests: string[];
// Set to drop is_test_app / test_app_for from responses, the way a registry older than
// the change that added them does.
let legacyRegistry: boolean;

function start(): Promise<Server> {
  const http = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);

    const path = (req.url ?? "").split("?")[0];
    const match = /^\/publisher-api\/apps(?:\/([^/]+)(\/export|\/upsert)?)?$/.exec(path);

    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (!match) return json(404, { errors: { detail: "not found" } });

    const [, slug, sub] = match;

    // The registry describes each app: a slug, whether it's a test app, and the app it
    // clones if so. A legacy registry sends neither of the last two.
    const describe = (id: string): Record<string, unknown> =>
      legacyRegistry
        ? { id }
        : { id, is_test_app: Boolean(testApps[id]), test_app_for: testApps[id] ?? null };

    if (!slug) {
      const excluded = (req.url ?? "").includes("exclude-test-apps=true");
      const listed = legacyRegistry || !excluded ? known : known.filter((id) => !testApps[id]);
      return json(200, { data: listed.map(describe) });
    }

    // An upsert creates the app if nothing has the slug — the whole point of registering.
    if (sub === "/upsert") {
      const created = !known.includes(slug);
      if (created) known.push(slug);
      return json(created ? 201 : 200, {
        data: {
          action: created ? "created" : "updated",
          app: { id: slug, ...(created ? { shared_secret_key: "s3cret" } : {}) },
          manifest: MANIFEST,
        },
      });
    }

    if (!known.includes(slug)) return json(404, { errors: { detail: "not found" } });
    if (!sub) return json(200, { data: describe(slug) });
    if (versionless.includes(slug)) {
      return json(422, { errors: { detail: "No app version available for export" } });
    }
    return json(200, MANIFEST);
  });

  return new Promise((resolve) => http.listen(0, "127.0.0.1", () => resolve(http)));
}

function cliEnv(): Record<string, string | undefined> {
  const { PEEK_TOKEN: _drop, XDG_CONFIG_HOME: _dropXdg, ...rest } = process.env;
  return { ...rest, XDG_CONFIG_HOME: configHome, PEEK_TOKEN: "test-token" };
}

// --skip-env-confirm on every call: the registry is overridden to the stub, and without it
// each command stops to ask "continue against this registry?" on a stdin nobody is watching.
function peek(args: string[], cwd: string) {
  return execa(CLI, [...args, "--skip-env-confirm"], { cwd, env: cliEnv() });
}

beforeEach(async () => {
  known = ["my-existing-app", "other-app", "my-existing-app-test-dev"];
  testApps = { "my-existing-app-test-dev": "my-existing-app" };
  versionless = [];
  requests = [];
  legacyRegistry = false;

  server = await start();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  registryUrl = `http://127.0.0.1:${port}`;

  configHome = await mkdtemp(join(tmpdir(), "peek-config-"));
  const peekDir = join(configHome, "peek");
  await mkdir(peekDir, { recursive: true });
  await writeFile(join(peekDir, "settings.json"), JSON.stringify({ registryUrl }));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function codebase(name = "legacy-thing"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "peek-link-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  return dir;
}

describe("peek apps link", () => {
  it("points an existing codebase at an existing app", async () => {
    const dir = await codebase();

    await peek(["apps", "link", "my-existing-app"], dir);

    // The app's own manifest lands beside the code — nothing is derived from the directory.
    const manifest = JSON.parse(await readFile(join(dir, "app.json"), "utf8"));
    expect(manifest).toEqual(MANIFEST);

    // The project file records the app this directory publishes to, and that it was linked
    // (not scaffolded) — so there's no starter kit claimed.
    const kit = JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-existing-app");
    expect(kit.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(kit.starterKit).toBeUndefined();
    // The platform came from the manifest: "peek" holds a list, the others are null.
    expect(kit.platform).toBe("peek");
    expect(kit.stack).toBe("javascript");

    // Skills are what let an agent build here, so linking composes them too.
    for (const skill of ["app-builder", "cli", "peek-embed-and-auth"]) {
      const skillFile = await stat(join(dir, ".claude", "skills", skill, "SKILL.md"));
      expect(skillFile.isFile()).toBe(true);
    }
  }, 30_000);

  it("refuses a slug the registry doesn't have, writing nothing", async () => {
    const dir = await codebase();

    await expect(peek(["apps", "link", "not-a-real-app"], dir)).rejects.toThrow();

    await expect(stat(join(dir, ".peek-kit.json"))).rejects.toThrow();
    await expect(stat(join(dir, "app.json"))).rejects.toThrow();
  }, 30_000);

  it("keeps a local app.json that differs, rather than clobbering it unasked", async () => {
    const dir = await codebase();
    const mine = { global: [], peek: [], acme: null, cng: null };
    await writeFile(join(dir, "app.json"), JSON.stringify(mine, null, 2));

    await peek(["apps", "link", "my-existing-app"], dir);

    // Not a TTY and no --force: the file is left alone and the developer is told to push or
    // force. The link itself still happened.
    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual(mine);
    const kit = JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-existing-app");
  }, 30_000);

  it("overwrites app.json with --force", async () => {
    const dir = await codebase();
    await writeFile(join(dir, "app.json"), JSON.stringify({ global: [], peek: [], acme: null, cng: null }));

    await peek(["apps", "link", "my-existing-app", "--force"], dir);

    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual(MANIFEST);
  }, 30_000);

  it("writes an empty manifest for an app with no version yet", async () => {
    versionless = ["my-existing-app"];
    const dir = await codebase();

    await peek(["apps", "link", "my-existing-app", "--platform", "acme"], dir);

    // Nothing to pull, so the manifest is valid-and-empty for the chosen platform rather
    // than the starter kit's example (whose extendable URLs only exist in the kit).
    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual({
      global: [],
      peek: null,
      acme: [],
      cng: null,
    });
  }, 30_000);

  it("leaves app.json alone with --no-manifest", async () => {
    const dir = await codebase();

    await peek(["apps", "link", "my-existing-app", "--no-manifest", "--platform", "peek"], dir);

    await expect(stat(join(dir, "app.json"))).rejects.toThrow();
    const kit = JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-existing-app");
  }, 30_000);

  it("creates the app with --create, and refuses without it", async () => {
    const dir = await codebase();

    // A codebase that predates its app: the slug isn't in the registry, so linking stops
    // rather than recording an app that doesn't exist.
    await expect(peek(["apps", "link", "brand-new-app", "--platform", "peek"], dir)).rejects.toThrow();
    await expect(stat(join(dir, ".peek-kit.json"))).rejects.toThrow();

    await peek(["apps", "link", "brand-new-app", "--create", "--platform", "peek"], dir);

    // Created as a draft — publishing needs a base_url, which only `dev` / `use-url` supply.
    expect(requests).toContain("POST /publisher-api/apps/brand-new-app/upsert?auto-publish=false");
    expect(JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8")).app.id).toBe(
      "brand-new-app",
    );
    // An empty-but-valid manifest was written for the chosen platform and pushed as-is.
    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual({
      global: [],
      peek: [],
      acme: null,
      cng: null,
    });
    expect(await readFile(join(dir, ".env.local"), "utf8")).toContain("PEEK_APP_SECRET=s3cret");
  }, 60_000);

  it("won't silently repoint a directory that's already linked", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);

    await expect(peek(["apps", "link", "other-app"], dir)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8")).app.id).toBe(
      "my-existing-app",
    );

    await peek(["apps", "link", "other-app", "--force"], dir);
    expect(JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8")).app.id).toBe("other-app");
  }, 60_000);
});

describe("peek apps push / pull", () => {
  it("pushes the local manifest to the app this directory publishes to", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);

    await peek(["apps", "push", "--yes"], dir);

    expect(requests).toContain("POST /publisher-api/apps/my-existing-app/upsert?auto-publish=true");
  }, 60_000);

  it("pushes without publishing, and at the test app, when asked", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);

    await peek(["apps", "push", "--yes", "--no-publish", "--app", "my-existing-app-dev"], dir);

    expect(requests).toContain(
      "POST /publisher-api/apps/my-existing-app-dev/upsert?auto-publish=false",
    );
  }, 60_000);

  it("pulls the registry's manifest over the local file", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);
    await writeFile(join(dir, "app.json"), JSON.stringify({ global: [], peek: [], acme: null, cng: null }));

    await peek(["apps", "pull", "--yes"], dir);

    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual(MANIFEST);
    // A pull is a read: nothing was written to the registry.
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([]);
  }, 60_000);

  it("has no --pull on push, and no --no-publish on pull", async () => {
    const dir = await codebase();

    // The split is the point: each direction's flags describe only what it does.
    await expect(peek(["apps", "push", "--pull"], dir)).rejects.toThrow();
    await expect(peek(["apps", "pull", "--no-publish"], dir)).rejects.toThrow();
  }, 30_000);
});

describe("retired command names", () => {
  it("still work, forwarding to the command that replaced them", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);
    await writeFile(join(dir, "app.json"), JSON.stringify({ global: [], peek: [], acme: null, cng: null }));

    // `peek sync-app` shipped before the surface was organized into topics, and its --pull
    // flag is now its own command. Published docs, scripts and skills still say the old
    // form, so it has to keep working — and say what to use instead.
    const { stderr, stdout } = await peek(["sync-app", "--pull", "--yes"], dir);

    // oclif wraps its warnings to the terminal width, so match on normalized whitespace.
    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain("Deprecated: this is now two commands");
    expect(output).toContain("peek apps pull");
    expect(JSON.parse(await readFile(join(dir, "app.json"), "utf8"))).toEqual(MANIFEST);
  }, 60_000);

  it("keep the retired names out of help", async () => {
    const dir = await codebase();

    const { stdout } = await peek(["--help"], dir);

    for (const retired of ["sync-app", "use-url", "show-env", "set-env"]) {
      expect(stdout).not.toContain(`  ${retired} `);
    }
    // The hidden registry-override commands aren't advertised either.
    expect(stdout).not.toContain("env set");
    expect(stdout).not.toContain("env show");
  }, 30_000);
});

describe("peek apps list", () => {
  it("lists the apps this account can publish to, without the dev loop's clones", async () => {
    const dir = await codebase();

    const { stdout } = await peek(["apps", "list", "--json"], dir);

    // my-existing-app-test-dev exists in the registry but is a test app, so it isn't part
    // of the answer to "which apps do I have?".
    expect(JSON.parse(stdout)).toEqual([
      { id: "my-existing-app", isTestApp: false, testAppFor: null },
      { id: "other-app", isTestApp: false, testAppFor: null },
    ]);
    expect(requests).toContain("GET /publisher-api/apps?exclude-test-apps=true");
  }, 30_000);

  it("shows test apps with --test-apps, naming what each one clones", async () => {
    const dir = await codebase();

    const { stdout } = await peek(["apps", "list", "--test-apps", "--json"], dir);

    expect(JSON.parse(stdout)).toEqual([
      { id: "my-existing-app", isTestApp: false, testAppFor: null },
      {
        id: "my-existing-app-test-dev",
        isTestApp: true,
        testAppFor: "my-existing-app",
      },
      { id: "other-app", isTestApp: false, testAppFor: null },
    ]);
  }, 30_000);

  it("says which line is a test app, and which is this directory's", async () => {
    const dir = await codebase();
    await peek(["apps", "link", "my-existing-app"], dir);

    const { stdout } = await peek(["apps", "list", "--test-apps"], dir);

    expect(stdout).toContain("my-existing-app  (← this directory)");
    expect(stdout).toContain("my-existing-app-test-dev  (test app for my-existing-app)");
  }, 60_000);

  it("still works against a registry that doesn't report test apps", async () => {
    legacyRegistry = true;
    const dir = await codebase();

    const { stdout } = await peek(["apps", "list", "--json"], dir);

    // No is_test_app in the response: everything reads as an ordinary app, which is the
    // flat list this command showed before the registry could tell us apart.
    expect(JSON.parse(stdout)).toEqual([
      { id: "my-existing-app", isTestApp: false, testAppFor: null },
      { id: "my-existing-app-test-dev", isTestApp: false, testAppFor: null },
      { id: "other-app", isTestApp: false, testAppFor: null },
    ]);
  }, 30_000);
});

describe("test apps are not something you build on", () => {
  it("refuses to link a directory to one, naming the app it clones", async () => {
    const dir = await codebase();

    const { stdout, stderr } = await peek(
      ["apps", "link", "my-existing-app-test-dev"],
      dir,
    ).catch((error: { stdout: string; stderr: string }) => error);

    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain("my-existing-app-test-dev is a test app");
    expect(output).toContain("peek apps link my-existing-app");
    // Nothing was written: not the project file, not a manifest.
    await expect(stat(join(dir, ".peek-kit.json"))).rejects.toThrow();
    await expect(stat(join(dir, "app.json"))).rejects.toThrow();
  }, 30_000);

  it("refuses to scaffold a kit for one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-test-app-"));

    const { stdout, stderr } = await peek(
      ["init", "my-existing-app-test-dev", "--no-install", "--no-dev"],
      dir,
    ).catch((error: { stdout: string; stderr: string }) => error);

    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain("is a test app");
    expect(output).toContain("peek init my-existing-app");
    await expect(stat(join(dir, "my-existing-app-test-dev"))).rejects.toThrow();
  }, 60_000);

  it("stops the dev loop before the tunnel when --app names one", async () => {
    const dir = await codebase();
    await writeFile(join(dir, "app.json"), JSON.stringify(MANIFEST));

    const { stdout, stderr } = await peek(
      ["tunnel", "--app", "my-existing-app-test-dev", "--test", "greg", "--yes"],
      dir,
    ).catch((error: { stdout: string; stderr: string }) => error);

    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain("my-existing-app-test-dev is a test app");
    expect(output).toContain("peek apps link my-existing-app");
    // Refused before anything was opened or pushed: no tunnel, no upsert, no test app.
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([]);
  }, 30_000);

  it("stops the dev loop when a legacy manifest's slug turns out to be one", async () => {
    const dir = await codebase();
    // An app scaffolded before the manifest was flattened carries its slug at
    // .data.app.id — and that slug can be a test app, which is exactly the case that used
    // to blow up at createTestApp with the tunnel already up.
    await writeFile(
      join(dir, "app.json"),
      JSON.stringify({ data: { app: { id: "my-existing-app-test-dev", app_version: {} } } }),
    );

    const { stdout, stderr } = await peek(["tunnel", "--yes"], dir).catch(
      (error: { stdout: string; stderr: string }) => error,
    );

    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain("is a test app");
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([]);
    // And the refused slug was not recorded: the project file would otherwise claim this
    // directory publishes to an app the dev loop just said it can't use.
    await expect(stat(join(dir, ".peek-kit.json"))).rejects.toThrow();
  }, 30_000);

  it("is never offered in the link picker", async () => {
    const dir = await codebase();

    // No slug and no TTY: the picker can't prompt, but it still fetched the list it would
    // have offered — and that list asks the registry to leave the clones out.
    await expect(peek(["apps", "link"], dir)).rejects.toThrow();

    expect(requests).toContain("GET /publisher-api/apps?exclude-test-apps=true");
  }, 30_000);
});

describe("peek skills", () => {
  it("composes skills into a codebase the CLI never scaffolded", async () => {
    const dir = await codebase();

    await peek(["skills", "--platform", "peek", "--stack", "javascript"], dir);

    const skillFile = await stat(join(dir, ".claude", "skills", "app-builder", "SKILL.md"));
    expect(skillFile.isFile()).toBe(true);

    // The axes are remembered, so a later `peek skills` (or `peek link`) doesn't re-ask.
    const kit = JSON.parse(await readFile(join(dir, ".peek-kit.json"), "utf8"));
    expect(kit.platform).toBe("peek");
    expect(kit.stack).toBe("javascript");
  }, 30_000);
});

describe("peek init <slug>", () => {
  it("adopts the app when the argument is a slug that already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-adopt-"));

    await peek(["init", "my-existing-app", "--no-install", "--no-dev"], dir);

    const targetDir = join(dir, "my-existing-app");

    // Adopted, not recreated: the app's live manifest is the kit's, and the kit publishes
    // to that slug.
    expect(JSON.parse(await readFile(join(targetDir, "app.json"), "utf8"))).toEqual(MANIFEST);
    const kit = JSON.parse(await readFile(join(targetDir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-existing-app");
    expect(kit.platform).toBe("peek");
  }, 60_000);

  it("creates the app when the argument is a slug nothing has yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-new-"));

    await peek(["init", "brand-new-app", "--platform", "peek", "--no-install", "--no-dev"], dir);

    const manifest = JSON.parse(
      await readFile(join(dir, "brand-new-app", "app.json"), "utf8"),
    );
    // The starter kit's manifest, not a pulled one — there was nothing to pull.
    expect(manifest.global.map((e: { slug: string }) => e.slug)).toContain(
      "app_registry_settings_url@v1",
    );
    expect(requests).toContain("POST /publisher-api/apps/brand-new-app/upsert?auto-publish=false");
  }, 60_000);

  it("says it can't tell whether the slug is taken when --no-sync", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-nosync-"));

    const { stdout, stderr } = await peek(
      ["init", "my-existing-app", "--platform", "peek", "--no-install", "--no-dev", "--no-sync"],
      dir,
    );

    const output = `${stdout}${stderr}`.replace(/\s+/g, " ");
    expect(output).toContain('not checking whether "my-existing-app" already exists');
    // And it didn't: the kit's own manifest is what landed.
    const manifest = JSON.parse(
      await readFile(join(dir, "my-existing-app", "app.json"), "utf8"),
    );
    expect(manifest.global.map((e: { slug: string }) => e.slug)).toContain(
      "app_registry_settings_url@v1",
    );
    // The only call is the developer-access probe every `init` makes before scaffolding:
    // the app itself was never looked up, and nothing was written.
    expect(requests).toEqual(["GET /publisher-api/apps"]);
  }, 60_000);

  it("scaffolds a starter kit for an app that already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-app-"));

    await peek(["init", "--app", "my-existing-app", "--no-install", "--no-dev", "--no-sync"], dir);

    const targetDir = join(dir, "my-existing-app");

    // The app's live manifest is what the kit ships with — not the kit's example, whose
    // extendable URLs point at routes the registry app may not have.
    expect(JSON.parse(await readFile(join(targetDir, "app.json"), "utf8"))).toEqual(MANIFEST);

    // No new slug was invented: the kit publishes to the app we named.
    const kit = JSON.parse(await readFile(join(targetDir, ".peek-kit.json"), "utf8"));
    expect(kit.app.id).toBe("my-existing-app");
    expect(kit.platform).toBe("peek");
    expect(kit.starterKit).toBe("nextjs-starter-kit");

    // Nothing was pushed — --no-sync.
    expect(requests.filter((r) => r.includes("/upsert"))).toEqual([]);
  }, 60_000);

  it("registers a new app as a draft even when the dev server is skipped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-draft-"));

    await peek(["init", "brand-new-app", "--platform", "peek", "--no-install", "--no-dev"], dir);

    // Only publishing needs a base_url (and so a tunnel); a draft doesn't. Skipping the dev
    // server must not mean the app never reaches the registry.
    expect(requests).toContain("POST /publisher-api/apps/brand-new-app/upsert?auto-publish=false");

    // The secret the create response carried is persisted — it is never shown again.
    const env = await readFile(join(dir, "brand-new-app", ".env.local"), "utf8");
    expect(env).toContain("PEEK_APP_SECRET=s3cret");
  }, 60_000);

  it("refuses an --app slug the registry doesn't have, scaffolding nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "peek-init-app-"));

    await expect(
      peek(["init", "--app", "not-a-real-app", "--no-install", "--no-dev", "--no-sync"], dir),
    ).rejects.toThrow();

    await expect(stat(join(dir, "not-a-real-app"))).rejects.toThrow();
  }, 60_000);
});
