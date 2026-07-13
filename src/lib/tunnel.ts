import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bin, install, Tunnel as CfTunnel } from "cloudflared";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";

const URL_TIMEOUT_MS = 30_000;

// Where cloudflared keeps its account cert, tunnel credentials, and per-app config files.
const CF_DIR = join(homedir(), ".cloudflared");

// Tunnel UUID as printed by `cloudflared tunnel create` / named in the credentials filename.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export interface Tunnel {
  url: string;
  stop: () => void;
}

// The `cloudflared` package vendors the binary and downloads it in a postinstall step — but
// that step is unreliable: pnpm blocks build scripts by default, `--ignore-scripts` skips it
// in CI, and it can fail offline. So we never assume the binary is present: if it's missing,
// fetch it on demand (once) into the package's own cache path. `CLOUDFLARED_BIN` already feeds
// the library's `bin`, so a dev pointing at a system binary short-circuits the download.
async function ensureBinary(): Promise<void> {
  if (existsSync(bin)) return;

  const spinner = p.spinner();
  spinner.start("Downloading cloudflared (first run only)");
  try {
    await install(bin);
    spinner.stop("cloudflared ready");
  } catch (error) {
    spinner.stop("cloudflared download failed");
    throw new CLIError(
      `Could not download cloudflared: ${(error as Error).message}`,
      "Install cloudflared yourself, then set CLOUDFLARED_BIN to its path. See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
  }
}

// Start a Cloudflare "quick tunnel" (no account needed) pointing at localhost:<port> and
// resolve once cloudflared reports the public *.trycloudflare.com URL. The child keeps
// running until stop() is called.
export async function startTunnel(port: number): Promise<Tunnel> {
  await ensureBinary();

  const cf = CfTunnel.quick(`http://localhost:${port}`);
  const stop = () => {
    cf.stop();
  };

  return new Promise<Tunnel>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        stop();
        reject(new CLIError("Timed out waiting for the cloudflared tunnel URL."));
      });
    }, URL_TIMEOUT_MS);

    cf.once("url", (url: string) => settle(() => resolve({ url, stop })));

    cf.once("error", (error: Error) =>
      settle(() => reject(new CLIError(`Failed to start cloudflared: ${error.message}`))),
    );

    // If cloudflared dies before printing a URL, surface it; once resolved, settled=true
    // makes this a no-op so a later clean shutdown (stop → exit) doesn't reject.
    cf.once("exit", (code: number | null) =>
      settle(() => reject(new CLIError(`cloudflared exited early (code ${code ?? "unknown"}).`))),
    );
  });
}

// Run a cloudflared subcommand with the vendored binary, turning a non-zero exit into a
// CLIError that carries cloudflared's own stderr so the developer sees the real cause.
async function runCf(args: string[], failure: string): Promise<string> {
  try {
    const { stdout } = await execa(bin, args);
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new CLIError(`${failure}${stderr ? `: ${stderr}` : ""}`);
  }
}

// A named tunnel needs an account cert (`cert.pem`), minted by `cloudflared tunnel login`.
// That opens a browser and waits for the developer to pick a zone, so it runs interactively.
async function ensureCfAuth(): Promise<void> {
  if (existsSync(join(CF_DIR, "cert.pem"))) return;

  p.log.step("Logging in to Cloudflare — a browser window will open to authorize a zone.");
  try {
    await execa(bin, ["tunnel", "login"], { stdio: "inherit" });
  } catch {
    throw new CLIError(
      "Cloudflare login did not complete.",
      "Run `cloudflared tunnel login` and pick the zone for your domain, then retry.",
    );
  }
  if (!existsSync(join(CF_DIR, "cert.pem"))) {
    throw new CLIError("Cloudflare login finished but no cert.pem was written.");
  }
}

// cloudflared reports a LIVE tunnel's deleted_at as the Go zero time, not null — so an
// emptiness check ("!deleted_at") wrongly treats every live tunnel as deleted. A tunnel is
// deleted only when deleted_at is a real timestamp, i.e. present and not the zero value.
const ZERO_TIME = "0001-01-01T00:00:00Z";
function isDeleted(deletedAt?: string | null): boolean {
  return deletedAt != null && deletedAt !== ZERO_TIME;
}

// Find a live (non-deleted) tunnel by name, returning its UUID, or null if none exists.
async function findTunnel(name: string): Promise<string | null> {
  const stdout = await runCf(["tunnel", "list", "--output", "json"], "Could not list Cloudflare tunnels");
  const tunnels = JSON.parse(stdout) as Array<{ id: string; name: string; deleted_at?: string | null }>;
  const match = tunnels.find((t) => t.name === name && !isDeleted(t.deleted_at));
  return match ? match.id : null;
}

// Ensure a tunnel named <name> exists AND its credentials file is present locally, returning
// the UUID. A tunnel created on another machine shows up in the account list but its
// credentials JSON only lives where it was created — without that file we can't run it, so we
// recreate it to mint fresh local credentials (mirrors the reference dev.tmp behavior).
async function ensureNamedTunnel(name: string): Promise<string> {
  const existing = await findTunnel(name);
  if (existing && existsSync(join(CF_DIR, `${existing}.json`))) return existing;

  if (existing) {
    p.log.warn(`Tunnel '${name}' exists in your account but its local credentials are missing — recreating it.`);
    await runCf(["tunnel", "delete", "-f", name], `Could not delete stale tunnel '${name}'`);
  }

  // Read the UUID straight from `create` output (it prints "Created tunnel <name> with id
  // <UUID>" and writes ~/.cloudflared/<UUID>.json) rather than a follow-up `tunnel list` lookup,
  // which can miss on eventual consistency or list shape. cloudflared logs to stderr, so scan both.
  const created = await execa(bin, ["tunnel", "create", name], { all: true }).catch((error: unknown) => {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new CLIError(`Could not create tunnel '${name}'${stderr ? `: ${stderr}` : ""}`);
  });
  const uuid = (created.all ?? `${created.stdout}\n${created.stderr}`).match(UUID_RE)?.[0];
  if (!uuid) throw new CLIError(`Created tunnel '${name}' but could not parse its UUID from cloudflared output.`);
  return uuid;
}

// Write the per-app ingress config so `cloudflared tunnel run` maps the public hostname to the
// local dev server. One file per app (config-<name>.yml) so multiple projects don't collide.
function writeTunnelConfig(opts: { tunnelName: string; uuid: string; hostname: string; port: number }): string {
  const configFile = join(CF_DIR, `config-${opts.tunnelName}.yml`);
  const credentialsFile = join(CF_DIR, `${opts.uuid}.json`);
  const content = `tunnel: ${opts.tunnelName}
credentials-file: ${credentialsFile}

ingress:
  - hostname: ${opts.hostname}
    service: http://localhost:${opts.port}
  - service: http_status:404
`;
  writeFileSync(configFile, content, "utf8");
  return configFile;
}

export interface NamedTunnelOptions {
  port: number;
  // Slugified app name (e.g. "acme-widgets"); the tunnel is "<appName>-dev".
  appName: string;
  // Base domain the developer controls in Cloudflare (e.g. "peeklabs.com").
  domain: string;
}

// Start a PERSISTENT named tunnel at https://<appName>-dev.<domain>. Unlike startTunnel's
// ephemeral quick tunnel, the hostname is stable across restarts, so app-dev.json's base_url
// stays valid and installs don't break on every `peek dev`. Requires a Cloudflare account with
// the domain's zone. Sets up auth, tunnel, ingress config, and DNS, then runs the tunnel.
export async function startNamedTunnel(opts: NamedTunnelOptions): Promise<Tunnel> {
  await ensureBinary();

  const tunnelName = `${opts.appName}-dev`;
  const hostname = `${opts.appName}-dev.${opts.domain}`;

  await ensureCfAuth();
  const uuid = await ensureNamedTunnel(tunnelName);
  const configFile = writeTunnelConfig({ tunnelName, uuid, hostname, port: opts.port });
  // --overwrite-dns repoints an existing record at this tunnel instead of failing, which is
  // exactly what we want when a tunnel was recreated above and the CNAME still points at the old UUID.
  await runCf(
    ["tunnel", "route", "dns", "--overwrite-dns", tunnelName, hostname],
    `Could not create a DNS route for ${hostname}`,
  );

  const cf = new CfTunnel(["tunnel", "--config", configFile, "run", tunnelName]);
  const url = `https://${hostname}`;
  const stop = () => {
    cf.stop();
  };

  // A named tunnel never emits a "url" event (that's a quick-tunnel thing) — the hostname is
  // known up front. Resolve once cloudflared registers a connection to the edge so we don't
  // hand back a URL that isn't routable yet.
  return new Promise<Tunnel>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        stop();
        reject(new CLIError("Timed out waiting for the named tunnel to connect to Cloudflare."));
      });
    }, URL_TIMEOUT_MS);

    cf.once("connected", () => settle(() => resolve({ url, stop })));

    cf.once("error", (error: Error) =>
      settle(() => reject(new CLIError(`Failed to start cloudflared: ${error.message}`))),
    );

    cf.once("exit", (code: number | null) =>
      settle(() => reject(new CLIError(`cloudflared exited early (code ${code ?? "unknown"}).`))),
    );
  });
}

// Warm Cloudflare's edge AND the origin path before the developer navigates. A fresh quick
// tunnel is cold: the first real request pays edge routing + TLS *and* the edge→origin
// connection, which reads as a ~5s stall. Fixed delays don't work — they race the dev server
// boot, so the warm hits land before the origin binds the port, 502, and warm nothing that
// lasts. Instead we poll the local origin until it actually accepts a connection, then pull a
// few real requests through the public URL so the full edge→origin path is hot. Fully
// background: errors are swallowed and every timer is unref'd so it never holds the process.
const ORIGIN_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

export function warmTunnel(url: string, port: number): void {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms).unref();
    });

  // Any response — even 404/500 — means the port is bound and serving; that's all we need.
  const originUp = () =>
    fetch(`http://localhost:${port}`, { method: "GET" }).then(
      () => true,
      () => false,
    );

  const run = async () => {
    const deadline = Date.now() + ORIGIN_WAIT_MS;
    while (Date.now() < deadline) {
      if (await originUp()) break;
      await sleep(POLL_INTERVAL_MS);
    }
    // Origin listening: pull real requests edge→origin to warm the full path.
    for (let i = 0; i < 3; i++) {
      await fetch(url, { method: "GET" }).catch(() => {});
    }
  };

  run().catch(() => {});
}
