import { createServer as createNetServer } from "node:net";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { type Manifest, manifestPlatforms } from "./manifest.js";
import { openProject, packageSlug, readProject, updateProject } from "./project.js";
import { getInstallationsApiUrl, getRegistryUrl, isRegistryOverridden } from "./registry.js";
import { writeEnvLocal } from "./scaffold.js";
import {
  type AppVersion,
  createTestApp,
  publishDraft,
  setBaseUrl,
  upsertManifest,
} from "./sync.js";
import { startNamedTunnel, startTunnel, warmTunnel } from "./tunnel.js";

// Is a port bindable right now? Bind with no host so it covers every interface the dev
// server might use — a partial match (e.g. something on 127.0.0.1 only) still counts as taken.
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createNetServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

// Walk up from the requested port until one is free. We must pick the port OURSELVES rather
// than letting the dev server auto-increment: the tunnel and the PORT env have to agree, and a
// server that quietly moves to 3001 while the tunnel points at 3000 is exactly the hard-to-
// recover-from failure this avoids.
async function findAvailablePort(start: number, attempts = 20): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new CLIError(
    `No free port found in ${start}–${start + attempts - 1}.`,
    "Free up a port or pass --port with a different starting value.",
  );
}

export interface ServeOptions {
  cwd: string;
  appFile: string;
  pm: string;
  port: number;
  // When true: register app.json as a draft on the source app, create/reuse a test app,
  // push the same manifest at it, point it at the tunnel, and publish it. When false: just
  // run the dev server.
  sync: boolean;
  // When set, use a PERSISTENT named tunnel at <app>-dev.<domain> (requires a Cloudflare login)
  // instead of an ephemeral quick tunnel. Keeps base_url stable across restarts.
  domain?: string;
  // Overrides the app slug recorded in .peek-kit.json (`peek dev --app <slug>`).
  appId?: string;
}

// The single source of truth for "run the app behind a public tunnel". Used by both
// `peek dev` and the tail of `peek init` — the latter needs the tunnel up BEFORE its first
// publish, because the registry rejects a publish whose base_url is null (relative
// extendable URLs require one). Callers must have already ensured login + confirmed the
// registry.
export async function serveWithTunnel(opts: ServeOptions): Promise<void> {
  // Read the project (migrating an old-format one) BEFORE the tunnel goes up, so a broken
  // manifest fails fast instead of orphaning cloudflared.
  const project = opts.sync
    ? openProject(opts.cwd, opts.appFile, { appIdFlag: opts.appId })
    : undefined;

  // Pin a free port before anything downstream (tunnel, PORT env, base_url) is derived from it.
  const port = await findAvailablePort(opts.port);
  if (port !== opts.port) {
    p.log.warn(`Port ${opts.port} is in use — using :${port} instead.`);
  }

  const spinner = p.spinner();
  spinner.start(opts.domain ? "Starting persistent Cloudflare tunnel" : "Starting Cloudflare tunnel");
  const tunnel = opts.domain
    ? await startNamedTunnel({ port, appName: tunnelName(opts.cwd), domain: opts.domain })
    : await startTunnel(port);
  spinner.stop(`Tunnel up: ${tunnel.url}`);

  try {
    let published: AppVersion | undefined;
    let appId: string | undefined;

    if (project) {
      const result = await publishTestApp({
        cwd: opts.cwd,
        appId: project.appId,
        testAppId: project.testAppId,
        manifest: project.manifest,
        baseUrl: tunnel.url,
      });
      published = result.version;
      appId = result.testAppId;
    } else {
      // --no-sync still runs against whatever test app this project last used, so the app
      // boots with the right identity even though we touch nothing in the registry.
      appId = readProject(opts.cwd).app?.testId;
    }

    // The tunnel URL is ephemeral (a new one each restart), so refresh env every run.
    const env: Record<string, string> = { PEEK_APP_URL: tunnel.url };
    if (appId) env.PEEK_APP_ID = appId;
    // Only when the registry is overridden: point the running app's installation API calls at
    // that same override. In prod (no override) the app uses its own default, so leave it unset.
    if (isRegistryOverridden()) env.PEEK_API_URL = getInstallationsApiUrl();
    await writeEnvLocal(opts.cwd, env);
    p.log.step("Updated PEEK_APP_URL in .env.local");

    // Tunnel URL is plumbing — demote it to a step so the install link can be the last,
    // loudest thing before we hand off to the (noisy) dev server banner.
    p.log.step(`Public URL: ${tunnel.url}`);
    p.log.step(`Starting dev server on :${port} (ctrl-c to stop)`);

    // A fresh quick tunnel is cold — the first request pays edge routing + TLS + the
    // edge→origin connection, which reads as a ~5s "nothing's happening" stall on the
    // developer's first navigation. Prime that path in the background: warmTunnel waits for
    // the dev server (started below) to bind the port, then pulls real requests through so
    // both edge and origin are warm before anyone navigates.
    warmTunnel(tunnel.url, port);

    // Print the install links LAST — the final Peek output before the app boots — so this
    // call to action isn't buried under the dev server's own output.
    if (published) printNextSteps(published);

    await execa(opts.pm, ["run", "dev"], {
      cwd: opts.cwd,
      stdio: "inherit",
      env: { ...process.env, PORT: String(port) },
    });
  } finally {
    tunnel.stop();
  }
}

interface PublishOptions {
  cwd: string;
  appId: string;
  testAppId?: string;
  manifest: Manifest;
  baseUrl: string;
}

// The dev loop's registry half. Four writes, in this order, because each depends on the
// last:
//
//   1. push the manifest at the SOURCE app as a draft — this is what creates the app the
//      first time. It's left unpublished: no base_url, and a draft doesn't need one.
//   2. ask for its test app (idempotent — the same `<app>-dev` every run).
//   3. push the SAME manifest at the test app, so manifest edits take effect on restart.
//   4. point the test app at the tunnel, then publish it. base_url and the manifest write
//      the same draft, so publishing is its own step that picks that draft up — which also
//      means it happens exactly once, after both writes are in.
//
// Everything the developer installs and runs is the TEST app. The source app.json is never
// given the ephemeral tunnel URL, and is never published from here.
async function publishTestApp(
  opts: PublishOptions,
): Promise<{ testAppId: string; version: AppVersion }> {
  p.log.step("Registering your app (draft)");
  const source = await upsertManifest({
    appId: opts.appId,
    manifest: opts.manifest,
    autoPublish: false,
  });
  if (source.action === "created") {
    p.log.step(`Created ${opts.appId} in the registry`);
  }

  const test = await createTestApp(opts.appId, { baseUrl: opts.baseUrl });
  if (test.created) {
    p.log.step(`Created a test app for local development: ${test.testAppId}`);
  }
  // Remember the test app even when it already existed — an app cloned from a repo has the
  // source slug but has never seen its own test app.
  if (test.testAppId !== opts.testAppId) {
    updateProject(opts.cwd, { app: { testId: test.testAppId } });
  }

  // The registry mints the test app's secret once, at creation — that response is the only
  // one that carries it. Persist it now; nothing below will ever return it again.
  if (test.sharedSecret) {
    await writeEnvLocal(opts.cwd, { PEEK_APP_SECRET: test.sharedSecret });
    p.log.step(
      "Saved the test app secret to .env.local as PEEK_APP_SECRET.\nFor production deploys, set that env var yourself.",
    );
  }

  await upsertManifest({
    appId: test.testAppId,
    manifest: opts.manifest,
    autoPublish: false,
  });

  // A test app is born published at the URL we just asked for, so only move an existing
  // one — otherwise the first run would cut a second version that says the same thing.
  if (!test.created) {
    await setBaseUrl(test.testAppId, opts.baseUrl);
  }
  p.log.step(`Pointed ${test.testAppId} at ${opts.baseUrl}`);

  p.log.step("Publishing your test app");
  const version = await publishDraft(test.testAppId);

  const platforms = manifestPlatforms(opts.manifest);
  if (platforms.length === 0) {
    p.log.warn(
      "This manifest targets no platform — every platform key is null, so there's nothing to install.",
    );
  }

  return { testAppId: test.testAppId, version };
}

function printNextSteps(version: AppVersion): void {
  if (Object.keys(version.appUrls).length === 0) return;

  // Keep the MCP url on the SAME registry base the developer is using — default or an
  // override — so an override'd session doesn't paste a prod MCP endpoint into their config.
  const mcpUrl = `${getRegistryUrl().replace(/\/+$/, "")}/mcp`;

  const lines = [
    "▸ Open your app",
    "",
    ...Object.entries(version.appUrls).map(([label, url]) => `  ${label}  ${url}`),
    "",
    "  Open a link above to install the app — it loads live from this dev server.",
    "",
    "▸ Build it with AI",
    "",
    "  This project ships with Claude skills ready to go. Open it in your AI",
    "  assistant and just describe what you want — it knows how to build here.",
    "",
    "  Wire up the Peek app MCP so your assistant can talk to the registry —",
    "  add this to your MCP config:",
    "",
    '    "peek-app-mcp": {',
    `      "url": "${mcpUrl}",`,
    '      "oauth": { "client_id": "peek-mcp" }',
    "    }",
  ];
  p.note(lines.join("\n"), "Next steps");
}

// Derive the named tunnel's hostname from package.json "name". Matches the reference
// dev.tmp so a tunnel keeps the same name across tools.
function tunnelName(cwd: string): string {
  const slug = packageSlug(cwd);
  if (!slug) {
    throw new CLIError(
      'package.json "name" is missing or empty — cannot derive a tunnel name.',
      "Set a name in package.json, then retry.",
    );
  }
  return slug;
}
