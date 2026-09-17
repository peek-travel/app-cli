import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CLIError } from "../errors.js";
import { PLATFORM_VALUES } from "./platforms.js";

// An app.json is the MANIFEST and nothing else: a flat object of extendables keyed by who
// consumes them — "registry" plus one key per platform. No envelope, no app slug, no
// base_url, no listing copy.
//
//   {
//     "registry": [{ "slug": "app_registry_settings_url@v1", "configuration": { ... } }],
//     "peek":     [{ "slug": "peek_backoffice_api@v1", "configuration": {} }],
//     "acme": null,
//     "cng":  null
//   }
//
// Key semantics on a push (the registry's contract, worth knowing here because we write
// these files): an ABSENT key leaves that platform exactly as it is, `null` stops the app
// running there, `[]` runs it there with no extendables, and a list is the exact set. The
// platforms an app targets are DERIVED from the keys — there is no `platforms` array to
// keep in sync. Unknown top-level keys are a 400, so we never add our own bookkeeping here
// (the app's slug lives in the project file — see lib/project.ts).

export const REGISTRY_KEY = "registry";

export interface ExtendableEntry {
  slug: string;
  configuration: Record<string, unknown>;
}

export type Manifest = Record<string, ExtendableEntry[] | null>;

// The keys a manifest may carry. Anything else is rejected by the registry with a 400
// rather than ignored, so we validate locally and name the offender before the round trip.
export function manifestKeys(): string[] {
  return [REGISTRY_KEY, ...PLATFORM_VALUES];
}

// ---------------------------------------------------------------------------------------
// The legacy shape, and reading it
// ---------------------------------------------------------------------------------------

// Manifests written before the registry flattened its publisher API carry the old envelope:
// { data: { app: { id, app_version: { platforms, registry_extendables, platform_extendables,
// base_url, ... } } } }. We can convert those losslessly (for everything the new API still
// accepts), which is what lets `peek dev` keep working in an app scaffolded last month.
interface LegacyEntry {
  slug?: string;
  extendable_slug?: string;
  configuration?: Record<string, unknown>;
}

interface LegacyManifest {
  data?: {
    app?: {
      id?: string;
      app_version?: {
        platforms?: string[];
        base_url?: string | null;
        registry_extendables?: LegacyEntry[];
        platform_extendables?: Record<string, LegacyEntry[]>;
      };
    };
  };
}

export interface LoadedManifest {
  manifest: Manifest;
  // Set only when the file was in the legacy envelope: the app slug it carried at
  // .data.app.id. It's the only place an existing project records its own identity, so the
  // migration path depends on it.
  legacyAppId?: string;
  // Set only when the file was in the legacy envelope and carried a base_url. Nothing pushes
  // it any more (base_url is its own endpoint now) — we surface it so a migration can tell
  // the developer where their old origin went.
  legacyBaseUrl?: string;
  converted: boolean;
}

function isLegacyEnvelope(json: unknown): json is LegacyManifest {
  return (
    typeof json === "object" &&
    json !== null &&
    typeof (json as LegacyManifest).data?.app === "object"
  );
}

function entries(list: LegacyEntry[] | undefined): ExtendableEntry[] {
  return (list ?? [])
    .map((entry) => ({
      slug: entry.slug ?? entry.extendable_slug ?? "",
      configuration: entry.configuration ?? {},
    }))
    .filter((entry) => entry.slug.length > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// Convert a legacy envelope into a flat manifest. A platform gets a list when the old
// `platforms` array said the app ran there (mirroring how the registry derived support),
// and `null` otherwise — so the conversion is explicit about every platform rather than
// leaving keys absent, which would mean "leave whatever the registry has alone".
function fromLegacy(json: LegacyManifest): LoadedManifest {
  const version = json.data?.app?.app_version ?? {};
  const supported = new Set(version.platforms ?? []);
  const platformExtendables = version.platform_extendables ?? {};

  const manifest: Manifest = { [REGISTRY_KEY]: entries(version.registry_extendables) };
  for (const platform of PLATFORM_VALUES) {
    manifest[platform] = supported.has(platform)
      ? entries(platformExtendables[platform])
      : null;
  }

  return {
    manifest,
    legacyAppId: json.data?.app?.id,
    legacyBaseUrl: version.base_url ?? undefined,
    converted: true,
  };
}

// Validate a decoded flat manifest, naming the exact key at fault. Same rules the registry
// enforces — catching them here turns a 400 round trip into a local error message.
function validate(json: unknown, file: string): Manifest {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new CLIError(`${file} must be a JSON object.`, manifestHint());
  }

  const allowed = new Set(manifestKeys());
  const unknown = Object.keys(json as Manifest).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CLIError(
      `${file} has unknown top-level key(s): ${unknown.sort().join(", ")}`,
      `A manifest holds only ${manifestKeys().join(", ")}.`,
    );
  }

  for (const [key, value] of Object.entries(json as Manifest)) {
    if (value === null) {
      if (key === REGISTRY_KEY) {
        throw new CLIError(`${file}: "registry" must be a list of extendables, not null.`);
      }
      continue;
    }
    if (!Array.isArray(value)) {
      throw new CLIError(`${file}: "${key}" must be null or a list of extendables.`);
    }
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null || typeof entry.slug !== "string") {
        throw new CLIError(
          `${file}: every entry under "${key}" needs a "slug" and an object "configuration".`,
        );
      }
    }
  }

  return json as Manifest;
}

function manifestHint(): string {
  return 'A manifest looks like { "registry": [ … ], "peek": [ … ], "acme": null, "cng": null }.';
}

// Read an app.json in either shape. A legacy envelope is converted in memory and reported
// via `converted` so the caller can write the flat form back and say so.
export function loadManifest(file: string): LoadedManifest {
  if (!existsSync(file)) {
    throw new CLIError(`${file} not found`);
  }

  const raw = readFileSync(file, "utf8");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CLIError(`${file} is not valid JSON`);
  }

  if (isLegacyEnvelope(json)) return fromLegacy(json);

  return { manifest: validate(json, file), converted: false };
}

export function writeManifest(file: string, manifest: Manifest): void {
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

// The platforms a manifest targets: the keys holding a list. Used for the "targets peek"
// line the CLI prints, never sent to the registry — it derives this itself.
export function manifestPlatforms(manifest: Manifest): string[] {
  return PLATFORM_VALUES.filter((platform) => Array.isArray(manifest[platform]));
}
