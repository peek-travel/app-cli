import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import open from "open";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { confirmRegistryOverride, getRegistryUrl } from "./registry.js";
import { getAccessToken, isLoggedIn, saveTokens } from "./session.js";

// Public client — no secret. PKCE (RFC 7636) is the whole security model.
const CLIENT_ID = "peek-cli";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

interface CallbackServer {
  port: Promise<number>;
  code: Promise<string>;
  close: () => void;
}

function createCallbackServer(state: string): CallbackServer {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }

    const receivedCode = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error || !receivedCode || returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(
        "<html><body>Sign-in failed or was cancelled. You can close this tab.</body></html>",
      );
      rejectCode(new CLIError(`Login failed: ${error ?? "invalid callback"}`));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<html><body>Signed in. You can close this tab and return to the terminal.</body></html>",
    );
    resolveCode(receivedCode);
  });

  const port = new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });

  const timeout = setTimeout(() => {
    rejectCode(new CLIError("Login timed out waiting for browser sign-in.", "Run `peek login` again."));
  }, CALLBACK_TIMEOUT_MS);
  timeout.unref();

  return {
    port,
    code,
    close: () => {
      clearTimeout(timeout);
      server.close();
    },
  };
}

async function exchangeCodeForToken(
  registryUrl: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<void> {
  const response = await fetch(`${registryUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new CLIError(
      `Token exchange failed (${response.status}): ${await response.text()}`,
      "Check that the registry's OAuth endpoints are reachable and configured for this client.",
    );
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token) {
    throw new CLIError(
      "Token exchange succeeded but the response had no access_token.",
      "This is a registry-side problem — check its OAuth token endpoint.",
    );
  }

  saveTokens({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
    registryUrl,
  });
}

async function printIdentity(registryUrl: string, accessToken: string): Promise<void> {
  try {
    const response = await fetch(`${registryUrl}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return;
    const { email } = (await response.json()) as { email?: string };
    if (email) p.log.success(`Signed in as ${email}`);
  } catch {
    // best-effort only — login already succeeded without this
  }
}

export async function login(): Promise<void> {
  await confirmRegistryOverride();

  const registryUrl = getRegistryUrl();
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("hex");

  const callback = createCallbackServer(state);
  const port = await callback.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizeUrl = new URL("/oauth/authorize", registryUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);

  p.log.step("Opening browser to sign in...");
  p.log.info(authorizeUrl.toString());
  await open(authorizeUrl.toString());

  let code: string;
  try {
    code = await callback.code;
  } finally {
    callback.close();
  }

  const spinner = p.spinner();
  spinner.start("Exchanging code for token");
  await exchangeCodeForToken(registryUrl, code, verifier, redirectUri);
  spinner.stop("Signed in");

  const accessToken = getAccessToken();
  if (accessToken) await printIdentity(registryUrl, accessToken);
}

export async function ensureLoggedIn(): Promise<void> {
  if (isLoggedIn()) return;

  p.log.info("Not signed in — starting login flow.");
  await login();
}
