import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, DEFAULT_REGISTRY_URL, getRegistryUrl } from "./registry.js";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  // Registry the token was issued by. Also the key it's stored under — kept in the record
  // for clarity and to migrate older single-token session files.
  registryUrl?: string;
}

// session.json holds one TokenSet PER registry, keyed by registry URL. Credentials are scoped
// to their env: pointing the CLI at another registry (`peek set-env`) never sends this env's
// token there, and switching back doesn't require logging in again.
type SessionStore = Record<string, TokenSet>;

// Treat tokens as expired slightly early so one that lapses mid-request doesn't 401.
const EXPIRY_SKEW_MS = 30_000;

function sessionPath(): string {
  return join(configDir(), "session.json");
}

function readStore(): SessionStore {
  const path = sessionPath();
  if (!existsSync(path)) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};

  // Migrate the legacy shape: a single flat TokenSet with accessToken at top level. Key it by
  // its own registryUrl, falling back to the default (prod) registry, where such tokens came from.
  if (typeof (raw as TokenSet).accessToken === "string") {
    const legacy = raw as TokenSet;
    return { [legacy.registryUrl ?? DEFAULT_REGISTRY_URL]: legacy };
  }

  return raw as SessionStore;
}

function writeStore(store: SessionStore): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = sessionPath();
  // mode applies atomically on create; the chmod covers a file left by older versions.
  writeFileSync(path, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

// Storage precedence: PEEK_TOKEN env (CI/scripting, never persisted) > file fallback.
// An OS keychain tier is planned — deferred until this first cut is proven out.
export function getToken(): TokenSet | undefined {
  if (process.env.PEEK_TOKEN) {
    return { accessToken: process.env.PEEK_TOKEN };
  }

  const parsed = readStore()[getRegistryUrl()];
  if (!parsed?.accessToken) return undefined;

  // Expired means "not signed in", so callers route back through login instead of
  // surfacing a raw 401 from the registry. Refresh-token flow is a follow-up.
  if (parsed.expiresAt && Date.now() >= parsed.expiresAt - EXPIRY_SKEW_MS) return undefined;

  return parsed;
}

export function saveTokens(tokens: TokenSet): void {
  const store = readStore();
  store[tokens.registryUrl ?? getRegistryUrl()] = tokens;
  writeStore(store);
}

// Log out of the CURRENT registry only, leaving other envs' credentials intact. Remove the
// file entirely once nothing's left so a logged-out state leaves no stale artifact.
export function clear(): void {
  const store = readStore();
  delete store[getRegistryUrl()];
  if (Object.keys(store).length === 0) {
    rmSync(sessionPath(), { force: true });
  } else {
    writeStore(store);
  }
}

export function isLoggedIn(): boolean {
  return getToken() !== undefined;
}

export function getAccessToken(): string | undefined {
  return getToken()?.accessToken;
}
