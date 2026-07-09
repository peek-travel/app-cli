import { existsSync } from "node:fs";
import { bin, install, Tunnel as CfTunnel } from "cloudflared";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";

const URL_TIMEOUT_MS = 30_000;

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
