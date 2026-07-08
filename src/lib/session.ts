import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, getRegistryUrl } from "./registry.js";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  // Registry the token was issued by. A stored token is only valid against that same
  // registry — this stops a token minted by production from being sent to a registry
  // the developer later points the CLI at with `peek set-env`.
  registryUrl?: string;
}

// Treat tokens as expired slightly early so one that lapses mid-request doesn't 401.
const EXPIRY_SKEW_MS = 30_000;

function sessionPath(): string {
  return join(configDir(), "session.json");
}

// Storage precedence: PEEK_TOKEN env (CI/scripting, never persisted) > file fallback.
// An OS keychain tier is planned — deferred until this first cut is proven out.
export function getToken(): TokenSet | undefined {
  if (process.env.PEEK_TOKEN) {
    return { accessToken: process.env.PEEK_TOKEN };
  }

  const path = sessionPath();
  if (!existsSync(path)) return undefined;

  let parsed: TokenSet;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed.accessToken) return undefined;

  // Token is scoped to the registry that issued it.
  if (parsed.registryUrl && parsed.registryUrl !== getRegistryUrl()) return undefined;

  // Expired means "not signed in", so callers route back through login instead of
  // surfacing a raw 401 from the registry. Refresh-token flow is a follow-up.
  if (parsed.expiresAt && Date.now() >= parsed.expiresAt - EXPIRY_SKEW_MS) return undefined;

  return parsed;
}

export function saveTokens(tokens: TokenSet): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = sessionPath();
  // mode applies atomically on create; the chmod covers a file left by older versions.
  writeFileSync(path, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clear(): void {
  rmSync(sessionPath(), { force: true });
}

export function isLoggedIn(): boolean {
  return getToken() !== undefined;
}

export function getAccessToken(): string | undefined {
  return getToken()?.accessToken;
}
