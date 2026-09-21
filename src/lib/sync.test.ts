import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIError } from "../errors.js";
import { checkTestIdentifier, createTestApp, findApp, listApps } from "./sync.js";

// These assert the WIRE: the path, query and body the CLI sends, and what it makes of the
// response. The dev loop's test app can't be exercised end to end in a test (it needs a
// real tunnel), so the identifier's journey from flag to request body is pinned here.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.PEEK_TOKEN = "test-token";
  // Isolated so getRegistryApiUrl resolves the default registry rather than the dev's
  // local override.
  process.env.XDG_CONFIG_HOME = "/tmp/peek-cli-test-config-does-not-exist";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PEEK_TOKEN;
});

function lastRequest(): { url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, { body?: string }];
  return { url, body: init.body ? JSON.parse(init.body) : undefined };
}

describe("createTestApp", () => {
  const created = {
    data: {
      action: "created",
      app: { id: "waiver-wizard-test-dev", shared_secret_key: "s3cret" },
      manifest: {},
    },
  };

  it("asks for the shared `dev` test app by default", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, created));

    const result = await createTestApp("waiver-wizard", { baseUrl: "https://x.example" });

    expect(lastRequest().url).toContain("/apps/waiver-wizard/test-apps");
    expect(lastRequest().body).toEqual({ identifier: "dev", base_url: "https://x.example" });
    // The secret is minted once, in this response only — the caller has to persist it.
    expect(result).toEqual({
      testAppId: "waiver-wizard-test-dev",
      created: true,
      sharedSecret: "s3cret",
    });
  });

  it("asks for the developer's own when given an identifier", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { action: "updated", app: { id: "waiver-wizard-test-greg" }, manifest: {} },
      }),
    );

    const result = await createTestApp("waiver-wizard", { identifier: "greg" });

    expect(lastRequest().body).toEqual({ identifier: "greg", base_url: undefined });
    // The registry derives the slug, so what comes back is what we report — never a guess.
    expect(result.testAppId).toBe("waiver-wizard-test-greg");
    expect(result.created).toBe(false);
  });
});

describe("checkTestIdentifier", () => {
  it("passes an identifier the registry can slugify", () => {
    expect(checkTestIdentifier("greg")).toBe("greg");
    expect(checkTestIdentifier(" pr-421 ")).toBe("pr-421");
  });

  it("refuses one that would slugify to nothing", () => {
    // The registry falls back to "dev" for an empty identifier, which would silently hand
    // the developer the shared test app they were trying to avoid.
    expect(() => checkTestIdentifier("  ")).toThrow(CLIError);
    expect(() => checkTestIdentifier("---")).toThrow(CLIError);
  });
});

describe("reading apps", () => {
  it("asks the registry to leave test apps out when told to", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await listApps({ search: "waiver", excludeTestApps: true });

    expect(lastRequest().url).toContain("search=waiver");
    expect(lastRequest().url).toContain("exclude-test-apps=true");
  });

  it("reports a test app and the app it clones", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { id: "waiver-wizard-test-dev", is_test_app: true, test_app_for: "waiver-wizard" },
      }),
    );

    expect(await findApp("waiver-wizard-test-dev")).toMatchObject({
      appId: "waiver-wizard-test-dev",
      isTestApp: true,
      testAppFor: "waiver-wizard",
    });
  });

  it("treats an app from a registry that reports neither as an ordinary app", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: "waiver-wizard" } }));

    expect(await findApp("waiver-wizard")).toMatchObject({
      appId: "waiver-wizard",
      isTestApp: false,
      testAppFor: undefined,
    });
  });

  it("returns null for a slug nothing holds", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { errors: { detail: "not found" } }));

    expect(await findApp("nope")).toBeNull();
  });
});
