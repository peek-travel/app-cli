import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIError } from "../errors.js";
import {
  buildFieldTree,
  type ExtendableField,
  listExtensions,
  platformsSummary,
  showExtension,
} from "./extensions.js";

// Minimal field factory — only the props buildFieldTree cares about.
function field(over: Partial<ExtendableField>): ExtendableField {
  return {
    key: "k",
    label: null,
    description: null,
    field_type: "string",
    required: false,
    default: null,
    position: 0,
    enum_values: null,
    parent_field_id: null,
    rules: [],
    ...over,
  };
}

// getAccessToken reads PEEK_TOKEN first, so setting it here avoids touching the real
// session file; XDG_CONFIG_HOME is isolated so getRegistryApiUrl resolves the default
// registry rather than the dev's local override.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("extensions lib", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.PEEK_TOKEN = "test-token";
    process.env.XDG_CONFIG_HOME = "/tmp/peek-cli-test-config-does-not-exist";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.PEEK_TOKEN;
    delete process.env.XDG_CONFIG_HOME;
    vi.unstubAllGlobals();
  });

  describe("listExtensions", () => {
    it("returns the data array and hits the unfiltered endpoint by default", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ slug: "a@v1" }, { slug: "b@v1" }] }));

      const result = await listExtensions();

      expect(result).toHaveLength(2);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toMatch(/\/publisher-api\/extendables$/);
    });

    it("passes the platform as a query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

      await listExtensions("peek");

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/extendables?platform=peek");
    });

    it("sends a bearer token", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

      await listExtensions();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    });

    it("throws a CLIError carrying the status on a non-ok response", async () => {
      // A fresh Response per call — a Response body can only be read once.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, { errors: "boom" })));

      const error = await listExtensions().catch((e) => e);
      expect(error).toBeInstanceOf(CLIError);
      expect(error.message).toContain("status 500");
    });
  });

  describe("showExtension", () => {
    it("URL-encodes the slug", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: { slug: "booking_portal@v1", fields: [] } }));

      await showExtension("booking_portal@v1");

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/extendables/booking_portal%40v1");
    });

    it("turns a 404 into an actionable CLIError", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { errors: { detail: "Not Found" } }));

      const error = await showExtension("nope@v9").catch((e) => e);
      expect(error).toBeInstanceOf(CLIError);
      expect(error.message).toContain('No extension found with slug "nope@v9"');
      expect(error.suggestion).toContain("peek extensions list");
    });
  });

  describe("buildFieldTree", () => {
    it("builds a true tree from ids when present, sorted by position", () => {
      const fields = [
        field({ key: "child_b", id: "c2", parent_field_id: "p1", position: 1 }),
        field({ key: "parent", id: "p1", field_type: "object", position: 0 }),
        field({ key: "child_a", id: "c1", parent_field_id: "p1", position: 0 }),
        field({ key: "root2", id: "r2", position: 1 }),
      ];

      const tree = buildFieldTree(fields);

      expect(tree.map((n) => n.field?.key)).toEqual(["parent", "root2"]);
      expect(tree[0].children.map((n) => n.field?.key)).toEqual(["child_a", "child_b"]);
    });

    it("nests the single child group under the lone container root (id-less fallback)", () => {
      // Shape of new_extendable@v1: a string root, an object root, two id-less children.
      const fields = [
        field({ key: "foo", field_type: "string", position: 0 }),
        field({ key: "sub_fields", field_type: "object", position: 1 }),
        field({ key: "Data", parent_field_id: "grp", position: 0 }),
        field({ key: "Foo", parent_field_id: "grp", field_type: "integer", position: 1 }),
      ];

      const tree = buildFieldTree(fields);

      expect(tree.map((n) => n.field?.key)).toEqual(["foo", "sub_fields"]);
      const container = tree.find((n) => n.field?.key === "sub_fields");
      expect(container?.children.map((n) => n.field?.key)).toEqual(["Data", "Foo"]);
    });

    it("surfaces labelled groups when containers and groups don't line up 1:1", () => {
      // Two object roots but three child groups → ambiguous, so don't guess.
      const fields = [
        field({ key: "a", field_type: "object", position: 0 }),
        field({ key: "b", field_type: "object", position: 1 }),
        field({ key: "c1", parent_field_id: "g1" }),
        field({ key: "c2", parent_field_id: "g2" }),
        field({ key: "c3", parent_field_id: "g3" }),
      ];

      const tree = buildFieldTree(fields);

      // Roots stay childless; the three groups appear as synthetic labelled nodes.
      expect(tree.filter((n) => n.field).every((n) => n.children.length === 0)).toBe(true);
      const labelled = tree.filter((n) => !n.field);
      expect(labelled).toHaveLength(3);
      expect(labelled[0].children.map((n) => n.field?.key)).toEqual(["c1"]);
    });

    it("returns a flat list when there are no children", () => {
      const tree = buildFieldTree([field({ key: "only" })]);
      expect(tree).toHaveLength(1);
      expect(tree[0].children).toHaveLength(0);
    });
  });

  describe("platformsSummary", () => {
    it("labels a null/empty platform list as global", () => {
      expect(platformsSummary(null)).toBe("all platforms");
      expect(platformsSummary([])).toBe("all platforms");
    });

    it("joins concrete platforms", () => {
      expect(platformsSummary(["peek", "acme"])).toBe("peek, acme");
    });
  });
});
