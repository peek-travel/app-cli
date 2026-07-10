import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import open from "open";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { confirmRegistryOverride, getRegistryApiUrl, getRegistryUrl } from "./registry.js";
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

function resultPage({
  ok,
  title,
  message,
  status,
}: {
  ok: boolean;
  title: string;
  message: string;
  status: string;
}): string {
  const badgeGradient = ok
    ? "linear-gradient(140deg, var(--violet), var(--magenta))"
    : "linear-gradient(140deg, #c0446a, #d29a80)";
  const badgeShadow = ok ? "rgba(154, 74, 174, 0.35)" : "rgba(192, 68, 106, 0.35)";
  const mark = ok ? "M4.5 12.5 L10 18 L19.5 6.5" : "M6 6 L18 18 M18 6 L6 18";
  const dotColor = ok ? "#16a34a" : "#dc2626";
  const dotHalo = ok ? "rgba(22, 163, 74, 0.14)" : "rgba(220, 38, 38, 0.14)";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} &middot; Peek Pro</title>
<style>
  :root {
    /* peek.gradient.master — sampled from the PP9 login art */
    --purple: #6a2e86;
    --violet: #9a4aae;
    --magenta: #c96ba2;
    --coral:  #d29a80;
    --teal:   #5f8a84;
    --slate:  #7a95a0;

    --indigo: #4f46e5;   /* PP9 action color */
    --ink: #17171f;
    --ink-dim: #6b7280;
    --card: #ffffff;
    --hairline: #ececf1;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    /* Layered mesh recreating the PP9 gradient */
    background:
      radial-gradient(75% 75% at 18% 2%,   var(--purple)  0%, transparent 55%),
      radial-gradient(85% 85% at 92% 14%,  var(--violet)  0%, transparent 55%),
      radial-gradient(80% 70% at 88% 46%,  var(--magenta) 0%, transparent 55%),
      radial-gradient(95% 75% at 55% 72%,  var(--coral)   0%, transparent 58%),
      radial-gradient(100% 85% at 16% 102%, var(--teal)   0%, transparent 60%),
      radial-gradient(95% 95% at 104% 104%, var(--slate)  0%, transparent 60%),
      linear-gradient(158deg, var(--purple), var(--magenta) 44%, var(--coral) 70%, var(--teal));
    background-color: var(--purple);
  }

  /* Very slow ambient breathing so the art feels alive, not busy */
  @media (prefers-reduced-motion: no-preference) {
    body { animation: breathe 22s ease-in-out infinite alternate; }
    @keyframes breathe {
      from { background-size: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%; }
      to   { background-size: 112% 112%, 108% 108%, 110% 110%, 114% 114%, 112% 112%, 108% 108%, 100% 100%; }
    }
  }

  .card {
    width: 100%;
    max-width: 420px;
    padding: 48px 40px 40px;
    text-align: center;
    background: var(--card);
    border-radius: 18px;
    box-shadow:
      0 1px 2px rgba(24, 24, 40, 0.06),
      0 30px 70px rgba(40, 20, 60, 0.28);
    animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(16px) scale(0.99); }
    to   { opacity: 1; transform: none; }
  }

  /* Result mark */
  .badge {
    width: 66px;
    height: 66px;
    margin: 4px auto 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: ${badgeGradient};
    box-shadow: 0 10px 26px ${badgeShadow};
    animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: none; }
  }
  .badge svg { width: 32px; height: 32px; display: block; }
  .badge path {
    fill: none; stroke: #fff; stroke-width: 3.2;
    stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 40; stroke-dashoffset: 40;
    animation: draw 0.45s cubic-bezier(0.65, 0, 0.35, 1) 0.5s forwards;
  }
  @keyframes draw { to { stroke-dashoffset: 0; } }

  h1 { margin: 0 0 10px; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
  .message { margin: 0 0 26px; font-size: 15px; line-height: 1.55; color: var(--ink-dim); }

  /* CLI-context cue — this page is served by the terminal */
  .terminal {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 9px 14px;
    border-radius: 10px;
    background: #f7f7fa;
    border: 1px solid var(--hairline);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12.5px;
    color: var(--ink-dim);
  }
  .terminal .prompt { color: var(--indigo); font-weight: 700; }
  .terminal .status { color: var(--ink); }
  .terminal .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: ${dotColor}; box-shadow: 0 0 0 3px ${dotHalo};
  }

  @media (prefers-reduced-motion: reduce) {
    .card, .badge, .badge path { animation: none; }
    .badge path { stroke-dashoffset: 0; }
  }
</style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="badge" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="${mark}" /></svg>
    </div>

    <h1>${title}</h1>
    <p class="message">${message}</p>

    <div class="terminal" aria-hidden="true">
      <span class="prompt">&rsaquo;</span>
      <span>peek login</span>
      <span class="dot"></span>
      <span class="status">${status}</span>
    </div>
  </main>
</body>
</html>`;
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
        resultPage({
          ok: false,
          title: "Sign-in failed",
          message: "Something went wrong or the request was cancelled. You can close this tab and try again.",
          status: "failed",
        }),
      );
      rejectCode(new CLIError(`Login failed: ${error ?? "invalid callback"}`));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      resultPage({
        ok: true,
        title: "You're signed in",
        message: "You can close this tab and return to your terminal.",
        status: "authenticated",
      }),
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

// OAuth sign-in succeeds for anyone with a Peek login, but creating apps needs a separately
// granted developer permission. Probe a permission-gated endpoint (listing the account's apps)
// so an unapproved user gets a clear message here rather than a raw 403 deep inside init → sync.
// Returns false only on a definitive 403; network/other errors let the flow proceed, since the
// real registry calls will surface any genuine failure and this is meant as a courtesy check.
async function verifyDeveloperAccess(): Promise<boolean> {
  const accessToken = getAccessToken();
  if (!accessToken) return false;

  const spinner = p.spinner();
  spinner.start("Checking your developer access");

  let status: number;
  try {
    const response = await fetch(`${getRegistryApiUrl()}/apps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    status = response.status;
  } catch {
    spinner.stop("Couldn't verify developer access (network error) — continuing");
    return true;
  }

  if (status === 403) {
    spinner.stop("Account not approved for development yet");
    p.note(
      [
        "You're successfully signed in — nice work!",
        "",
        "Your account isn't approved for app development yet. A Peek admin needs to",
        "grant you developer access. Once they have, run `peek init` again and you'll",
        "be ready to build.",
      ].join("\n"),
      "Almost there",
    );
    return false;
  }

  spinner.stop("Developer access confirmed");
  return true;
}

// First-run gate for `peek init`: before scaffolding anything, welcome the user and make it
// explicit that a Peek developer account is required, then have them opt into signing in.
// Returns false when the user declines/cancels or their account isn't approved for development —
// the caller should stop without scaffolding.
export async function requireAccount(): Promise<boolean> {
  if (!isLoggedIn()) {
    p.note(
      [
        "Welcome to the Peek CLI.",
        "",
        "You need a Peek developer account to create and publish apps.",
      ].join("\n"),
      "Sign in required",
    );

    const proceed = await p.confirm({
      message: "Sign in now?",
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("A developer account is required. Run `peek init` again when you're ready to sign in.");
      return false;
    }

    await login();
  }

  return verifyDeveloperAccess();
}
