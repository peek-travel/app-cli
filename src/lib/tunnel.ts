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

// Fire a few throwaway requests at the tunnel URL to warm Cloudflare's edge before the
// developer navigates. Early hits (origin not up yet) 502 but still establish edge routing +
// TLS; the later hit lands after the dev server boots and warms the origin path too. Fully
// background — errors are swallowed and the timers are unref'd so they never hold the process.
export function warmTunnel(url: string): void {
  const hit = () => {
    fetch(url, { method: "GET" }).catch(() => {});
  };
  for (const delay of [0, 1500, 4000]) {
    setTimeout(hit, delay).unref();
  }
}
