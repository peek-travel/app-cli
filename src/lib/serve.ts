import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { runArgs, type PackageManager } from "./pm.js";
import { getInstallationsApiUrl, getRegistryUrl, isRegistryOverridden } from "./registry.js";
import { writeEnvLocal } from "./scaffold.js";
import { createTestApp, syncApp } from "./sync.js";
import { startTunnel, warmTunnel } from "./tunnel.js";

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

// The dev loop targets a TEST app (app-dev.json), never the source app.json. The source is
// synced only as an unpublished draft; the test app is what gets a base_url, gets published,
// and is what the developer installs. app-dev.json lives beside app.json in the project.
export function devFileFor(appFile: string): string {
  return join(dirname(appFile), "app-dev.json");
}

interface AppJson {
  data?: {
    app?: {
      id?: string;
      app_version?: { base_url?: string | null; app_urls?: Record<string, string> };
    };
  };
}

function readAppJson(appFile: string): AppJson {
  try {
    return JSON.parse(readFileSync(appFile, "utf8")) as AppJson;
  } catch {
    throw new CLIError(`${appFile} is not valid JSON`);
  }
}

export function setBaseUrl(appFile: string, url: string): void {
  const parsed = readAppJson(appFile);
  const version = parsed.data?.app?.app_version;
  if (!version) {
    throw new CLIError(
      "Could not find data.app.app_version in app.json to set base_url.",
      "Make sure app.json has the expected structure.",
    );
  }
  version.base_url = url;
  writeFileSync(appFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export interface ServeOptions {
  cwd: string;
  appFile: string;
  pm: string;
  port: number;
  // When true: register app.json as a draft, create/reuse a test app (app-dev.json), and
  // publish that test app carrying the tunnel base_url. When false: just run the dev server.
  sync: boolean;
}

// The single source of truth for "run the app behind a public tunnel". Used by both
// `peek dev` and the tail of `peek init` — the latter needs the tunnel up BEFORE its first
// sync, because the registry rejects a publish whose base_url is null (relative extendable
// URLs require it). Callers must have already ensured login + confirmed the registry.
export async function serveWithTunnel(opts: ServeOptions): Promise<void> {
  // Pin a free port before anything downstream (tunnel, PORT env, base_url) is derived from it.
  const port = await findAvailablePort(opts.port);
  if (port !== opts.port) {
    p.log.warn(`Port ${opts.port} is in use — using :${port} instead.`);
  }

  const spinner = p.spinner();
  spinner.start("Starting Cloudflare tunnel");
  const tunnel = await startTunnel(port);
  spinner.stop(`Tunnel up: ${tunnel.url}`);

  const devFile = devFileFor(opts.appFile);

  try {
    if (opts.sync) {
      // 1. Register the source app.json as an UNPUBLISHED DRAFT. No base_url needed — a draft
      //    upsert doesn't publish, so the registry won't reject a null base_url. The source
      //    app.json stays clean (never carries the ephemeral tunnel URL).
      p.log.step("Registering your app (draft)");
      const { appId } = await syncApp({
        file: opts.appFile,
        autoPublish: false,
        pull: false,
        debug: false,
        assumeYes: true,
      });

      // 2. Create the test app for this source and export it to app-dev.json. Only on first
      //    run — once app-dev.json exists we reuse that test app across dev restarts.
      if (!existsSync(devFile)) {
        p.log.step("Creating a test app for local development");
        const created = await createTestApp(appId, devFile);
        p.log.step("Wrote app-dev.json");

        // The registry mints the test app's secret once, at creation — this is the only
        // response that carries it. Persist it now; the publish step below never returns it.
        if (created.sharedSecret) {
          await writeEnvLocal(opts.cwd, { PEEK_APP_SECRET: created.sharedSecret });
          p.log.step(
            "Saved the test app secret to .env.local as PEEK_APP_SECRET.\nFor production deploys, set that env var yourself.",
          );
        }
      }
    }

    // Everything from here targets the TEST app (app-dev.json): base_url, publish, secret,
    // install links. Falls back to app.json only for a --no-sync run before any test app exists.
    const workFile = existsSync(devFile) ? devFile : opts.appFile;

    // The tunnel URL is ephemeral (new one each restart), so refresh env + the work file every run.
    const env: Record<string, string> = { PEEK_APP_URL: tunnel.url };
    const appId = readAppJson(workFile).data?.app?.id;
    if (appId) env.PEEK_APP_ID = appId;
    // Only when the registry is overridden: point the running app's installation API calls at
    // that same override. In prod (no override) the app uses its own default, so leave it unset.
    if (isRegistryOverridden()) env.PEEK_API_URL = getInstallationsApiUrl();
    await writeEnvLocal(opts.cwd, env);
    p.log.step("Updated PEEK_APP_URL in .env.local");

    setBaseUrl(workFile, tunnel.url);
    p.log.step(`Updated base_url in ${basename(workFile)}`);

    if (opts.sync) {
      // 3. Publish the TEST app against the live tunnel URL.
      p.log.step("Publishing your test app");
      const result = await syncApp({
        file: workFile,
        autoPublish: true,
        pull: false,
        debug: false,
        assumeYes: true,
      });
      // The shared secret is minted once and never returned again — persist it now. Because
      // we save it for them, syncApp (assumeYes) skips its scary "save this now" warning;
      // this concise note replaces it without the mixed message.
      if (result.sharedSecret) {
        await writeEnvLocal(opts.cwd, { PEEK_APP_SECRET: result.sharedSecret });
        p.log.step(
          "Saved a new app secret to .env.local as PEEK_APP_SECRET.\nFor production deploys, set that env var yourself.",
        );
      }
    }

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

    // The registry writes install URLs back into app-dev.json under data.app.app_version.app_urls
    // during sync. Print them LAST — the final Peek output before the app boots — so this
    // call to action isn't buried under the dev server's own output.
    const appUrls = readAppJson(workFile).data?.app?.app_version?.app_urls;
    if (appUrls && Object.keys(appUrls).length > 0) {
      // Keep the MCP url on the SAME registry base the developer is using — default or an
      // override — so an override'd session doesn't paste a prod MCP endpoint into their config.
      const mcpUrl = `${getRegistryUrl().replace(/\/+$/, "")}/mcp`;

      const lines = [
        "▸ Open your app",
        "",
        ...Object.entries(appUrls).map(([label, url]) => `  ${label}  ${url}`),
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
    await execa(opts.pm, runArgs(opts.pm as PackageManager, "dev"), {
      cwd: opts.cwd,
      stdio: "inherit",
      env: { ...process.env, PORT: String(port) },
    });
  } finally {
    tunnel.stop();
  }
}
