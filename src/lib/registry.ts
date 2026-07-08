import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";

export const DEFAULT_REGISTRY_URL = "https://app-registry.peeklabs.com";

interface GlobalSettings {
  registryUrl?: string;
}

export function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "peek")
    : join(homedir(), ".config", "peek");
}

function settingsPath(): string {
  return join(configDir(), "settings.json");
}

function readSettings(): GlobalSettings {
  const path = settingsPath();
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: GlobalSettings): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

export function getRegistryUrl(): string {
  return readSettings().registryUrl ?? DEFAULT_REGISTRY_URL;
}

// The registry serves its app API under a /publisher-api prefix. Callers pass the bare
// base URL (env/override may carry a trailing slash); this trims it and appends the prefix
// so we never emit "//apps/..." or hit an unprefixed route.
export function getRegistryApiUrl(): string {
  return `${getRegistryUrl().replace(/\/+$/, "")}/publisher-api`;
}

// The registry serves the running app's installation API under a /installations-api prefix.
// Same trailing-slash trimming as getRegistryApiUrl so we never emit "//..." routes.
export function getInstallationsApiUrl(): string {
  return `${getRegistryUrl().replace(/\/+$/, "")}/installations-api`;
}

export function isRegistryOverridden(): boolean {
  return readSettings().registryUrl !== undefined;
}

export function setRegistryOverride(url: string): void {
  const settings = readSettings();
  settings.registryUrl = url;
  writeSettings(settings);
}

export function clearRegistryOverride(): void {
  const settings = readSettings();
  delete settings.registryUrl;
  writeSettings(settings);
}

// Once the developer confirms the override in a given CLI invocation, we don't
// ask again for the rest of that process — a single flow (init → serve → sync)
// touches the registry many times and re-prompting each hop is noise.
let overrideConfirmed = false;

// Gate before any registry network call. Registry devs override the URL to point
// at a local/staging backend during auth-flow development — this keeps them from
// forgetting they're not talking to prod mid-session.
export async function confirmRegistryOverride(): Promise<void> {
  if (!isRegistryOverridden()) return;
  if (overrideConfirmed) return;

  const url = getRegistryUrl();
  p.log.warn(
    `Registry overridden: ${url}\nThis is NOT production. Run "peek set-env --clear" to reset.`,
  );

  const proceed = await p.confirm({ message: "Continue against this registry?", initialValue: false });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Cancelled");
    throw new CLIError("Aborted: registry override not confirmed");
  }

  overrideConfirmed = true;
}
