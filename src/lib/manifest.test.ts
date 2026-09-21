import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyManifest,
  loadManifest,
  manifestPlatforms,
  solePlatform,
  writeManifest,
} from "./manifest.js";
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
      global: [{ slug: "app_registry_webhook@v1", configuration: { url: "/hook" } }],
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
    const file = manifestFile({ global: [], peeek: [] });

    expect(() => loadManifest(file)).toThrow(CLIError);
    expect(() => loadManifest(file)).toThrow(/unknown top-level key\(s\): peeek/);
  });

  it("rejects a platform value that is neither null nor a list", () => {
    const file = manifestFile({ global: [], peek: { slug: "nope" } });

    expect(() => loadManifest(file)).toThrow(/"peek" must be null or a list/);
  });

  it("rejects a null global key", () => {
    expect(() => loadManifest(manifestFile({ global: null }))).toThrow(/"global" must be a list/);
  });

  it("rejects an entry with no slug", () => {
    const file = manifestFile({ global: [{ configuration: {} }] });

    expect(() => loadManifest(file)).toThrow(/needs a "slug"/);
  });

  it("rejects invalid JSON", () => {
    expect(() => loadManifest(manifestFile("{nope"))).toThrow(/is not valid JSON/);
  });
});

describe("loadManifest, on a manifest still keyed on \"registry\"", () => {
  it("renames the key to \"global\", in place, and reports the conversion", () => {
    const file = manifestFile({
      registry: [{ slug: "app_registry_webhook@v1", configuration: { url: "/hook" } }],
      peek: [],
      acme: null,
      cng: null,
    });

    const { manifest, converted } = loadManifest(file);

    expect(converted).toBe(true);
    expect(Object.keys(manifest)).toEqual(["global", "peek", "acme", "cng"]);
    expect(manifest.global).toEqual([
      { slug: "app_registry_webhook@v1", configuration: { url: "/hook" } },
    ]);
  });

  it("refuses to guess when both keys are present", () => {
    const file = manifestFile({ global: [], registry: [] });

    expect(() => loadManifest(file)).toThrow(/both "global" and the old "registry" key/);
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
    expect(manifest.global).toEqual([
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
    const file = manifestFile({ global: [] });
    const manifest = { global: [], peek: [], acme: null, cng: null };

    writeManifest(file, manifest);

    expect(loadManifest(file).manifest).toEqual(manifest);
  });
});

describe("deriving a platform", () => {
  it("names the platform when a manifest targets exactly one", () => {
    expect(solePlatform({ global: [], peek: [], acme: null, cng: null })).toBe("peek");
  });

  it("won't guess for a manifest that targets several, or none", () => {
    expect(solePlatform({ global: [], peek: [], acme: [], cng: null })).toBeUndefined();
    expect(solePlatform({ global: [], peek: null, acme: null, cng: null })).toBeUndefined();
  });
});

describe("emptyManifest", () => {
  it("targets one platform and switches the rest off", () => {
    // Every platform key is present: an absent key means "leave it as it is", which is not
    // what a fresh manifest wants to say.
    expect(emptyManifest("acme")).toEqual({ global: [], peek: null, acme: [], cng: null });
    expect(manifestPlatforms(emptyManifest("acme"))).toEqual(["acme"]);
  });
});
