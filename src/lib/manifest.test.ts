import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, manifestPlatforms, writeManifest } from "./manifest.js";
import { CLIError } from "../errors.js";

function manifestFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "peek-manifest-"));
  const file = join(dir, "app.json");
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents), "utf8");
  return file;
}

describe("loadManifest", () => {
  it("reads a flat manifest as-is", () => {
    const file = manifestFile({
      registry: [{ slug: "app_registry_webhook@v1", configuration: { url: "/hook" } }],
      peek: [],
      acme: null,
      cng: null,
    });

    const { manifest, converted, legacyAppId } = loadManifest(file);

    expect(converted).toBe(false);
    expect(legacyAppId).toBeUndefined();
    expect(manifest.peek).toEqual([]);
    expect(manifest.acme).toBeNull();
    expect(manifestPlatforms(manifest)).toEqual(["peek"]);
  });

  it("rejects a key the registry would 400 on", () => {
    const file = manifestFile({ registry: [], peeek: [] });

    expect(() => loadManifest(file)).toThrow(CLIError);
    expect(() => loadManifest(file)).toThrow(/unknown top-level key\(s\): peeek/);
  });

  it("rejects a platform value that is neither null nor a list", () => {
    const file = manifestFile({ registry: [], peek: { slug: "nope" } });

    expect(() => loadManifest(file)).toThrow(/"peek" must be null or a list/);
  });

  it("rejects a null registry key", () => {
    expect(() => loadManifest(manifestFile({ registry: null }))).toThrow(
      /"registry" must be a list/,
    );
  });

  it("rejects an entry with no slug", () => {
    const file = manifestFile({ registry: [{ configuration: {} }] });

    expect(() => loadManifest(file)).toThrow(/needs a "slug"/);
  });

  it("rejects invalid JSON", () => {
    expect(() => loadManifest(manifestFile("{nope"))).toThrow(/is not valid JSON/);
  });
});

describe("loadManifest, on a legacy envelope", () => {
  const legacy = {
    data: {
      app: {
        id: "waiver-wizard",
        name: { en: "Waiver Wizard" },
        app_version: {
          base_url: "https://example.com",
          platforms: ["peek"],
          registry_extendables: [
            { slug: "app_registry_webhook@v1", configuration: { url: "/hook" } },
            {
              extendable_slug: "app_registry_settings_url@v1",
              configuration: { url: "/main", url_mode: "prepend_base_url" },
            },
          ],
          platform_extendables: {
            peek: [{ slug: "peek_backoffice_api@v1", configuration: {} }],
            // Configuration for a platform the app didn't target is dropped with it.
            cng: [{ slug: "cng_backoffice_api@v1", configuration: {} }],
          },
        },
      },
    },
  };

  it("flattens it, keyed by platform", () => {
    const { manifest, converted } = loadManifest(manifestFile(legacy));

    expect(converted).toBe(true);
    expect(manifest.registry).toEqual([
      { slug: "app_registry_settings_url@v1", configuration: { url: "/main", url_mode: "prepend_base_url" } },
      { slug: "app_registry_webhook@v1", configuration: { url: "/hook" } },
    ]);
    expect(manifest.peek).toEqual([{ slug: "peek_backoffice_api@v1", configuration: {} }]);
    // Explicitly null, not absent: absent would mean "leave the registry's copy alone".
    expect(manifest.cng).toBeNull();
    expect(manifest.acme).toBeNull();
  });

  it("hands back the slug and origin that no longer live in the file", () => {
    const { legacyAppId, legacyBaseUrl } = loadManifest(manifestFile(legacy));

    expect(legacyAppId).toBe("waiver-wizard");
    expect(legacyBaseUrl).toBe("https://example.com");
  });
});

describe("writeManifest", () => {
  it("round-trips through the file", () => {
    const file = manifestFile({ registry: [] });
    const manifest = { registry: [], peek: [], acme: null, cng: null };

    writeManifest(file, manifest);

    expect(loadManifest(file).manifest).toEqual(manifest);
  });
});
