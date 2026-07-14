import { createRequire } from "node:module";
import * as p from "@clack/prompts";
import { CLIError } from "../errors.js";
import { getRegistryApiUrl } from "./registry.js";
import { getAccessToken } from "./session.js";

// Extensions (the registry calls them "extendables") are the capabilities an app can plug
// into — webhooks, platform embeds, registry hooks. They're platform-specific, so both calls
// take an optional platform filter that maps straight to the registry's ?platform= param.
// ../../package.json resolves from both src/lib (tsx) and dist/lib (compiled).
const { version: CLI_VERSION } = createRequire(import.meta.url)("../../package.json") as { version: string };
const USER_AGENT = `peek-cli/${CLI_VERSION}`;

// A single configurable field an extension exposes on an app's manifest.
export interface ExtendableField {
  key: string;
  label: string | null;
  description: string | null;
  field_type: string;
  required: boolean;
  default: unknown;
  position: number;
  // The registry currently returns parent_field_id but NOT a field's own id, so children
  // can't be linked to a specific parent (see buildFieldTree). id is optional here so the
  // exact nesting lights up automatically if/when the serializer starts including it.
  id?: string;
  enum_values: string[] | null;
  parent_field_id: string | null;
  rules: unknown[];
}

// A field arranged in the parent/child tree. `label` (with no `field`) is a synthetic
// grouping node used only by the id-less fallback.
export interface FieldNode {
  field?: ExtendableField;
  label?: string;
  children: FieldNode[];
}

// Field types that hold nested sub-fields.
const CONTAINER_TYPES = new Set(["object", "object_list", "map"]);

const byPosition = (a: ExtendableField, b: ExtendableField): number => a.position - b.position;

function sortNodes(nodes: FieldNode[]): void {
  nodes.sort((a, b) => (a.field?.position ?? 0) - (b.field?.position ?? 0));
  for (const n of nodes) sortNodes(n.children);
}

// Arrange a flat field list into a parent/child tree.
//
// Preferred path: every field carries an `id`, so `parent_field_id` resolves exactly and we
// build the true (arbitrarily deep) tree.
//
// Fallback path (today's registry): fields have `parent_field_id` but no `id`, so a child
// can't be tied to its specific parent. We group siblings by their shared parent and attach
// each group to a container-typed root ONLY when the counts line up 1:1 (the common
// single-container case). When it's ambiguous (more groups than containers) we surface the
// groups as labelled nodes rather than guess a wrong hierarchy.
export function buildFieldTree(fields: ExtendableField[]): FieldNode[] {
  const haveIds = fields.length > 0 && fields.every((f) => typeof f.id === "string");

  if (haveIds) {
    const nodes = new Map<string, FieldNode>();
    for (const f of fields) nodes.set(f.id as string, { field: f, children: [] });

    const roots: FieldNode[] = [];
    for (const f of fields) {
      const node = nodes.get(f.id as string) as FieldNode;
      const parent = f.parent_field_id ? nodes.get(f.parent_field_id) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    sortNodes(roots);
    return roots;
  }

  const rootFields = fields.filter((f) => !f.parent_field_id).sort(byPosition);

  // Group children by shared parent id, preserving first-appearance order.
  const groups: ExtendableField[][] = [];
  const byParent = new Map<string, ExtendableField[]>();
  for (const f of fields) {
    if (!f.parent_field_id) continue;
    let g = byParent.get(f.parent_field_id);
    if (!g) {
      g = [];
      byParent.set(f.parent_field_id, g);
      groups.push(g);
    }
    g.push(f);
  }
  for (const g of groups) g.sort(byPosition);

  const rootNodes: FieldNode[] = rootFields.map((f) => ({ field: f, children: [] }));

  if (groups.length === 0) return rootNodes;

  const containers = rootNodes.filter((n) => CONTAINER_TYPES.has(n.field?.field_type ?? ""));
  if (containers.length === groups.length) {
    containers.forEach((node, i) => {
      node.children = groups[i].map((f) => ({ field: f, children: [] }));
    });
    return rootNodes;
  }

  // Ambiguous — can't safely match groups to parents.
  const extra: FieldNode[] = groups.map((g, i) => ({
    label: `nested field group ${i + 1}`,
    children: g.map((f) => ({ field: f, children: [] })),
  }));
  return [...rootNodes, ...extra];
}

// The shape shared by list rows and the detail response. `platforms: null` means the
// extension is global (available on every platform).
export interface Extendable {
  slug: string;
  id: string;
  type: string;
  description: string | null;
  platforms: string[] | null;
  global: boolean;
}

// The detail response adds the field definitions on top of the summary.
export interface ExtendableDetail extends Extendable {
  fields: ExtendableField[];
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (!token) {
    throw new CLIError("Not signed in.", "Run `peek auth login` first.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
  };
}

// Mirror sync.ts: fold the full response body into .message so oclif's default handler
// (which prints only .message) still surfaces the registry's detail. JSON is pretty-printed.
function requestError(status: number, body: string): CLIError {
  let readable = body.trim();
  try {
    readable = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // not JSON — keep the raw text
  }
  return new CLIError(
    `Request failed with status ${status}${readable ? `\n${readable}` : " (empty response body)"}`,
  );
}

async function getJson(path: string, debug: boolean): Promise<unknown> {
  const url = `${getRegistryApiUrl()}${path}`;
  if (debug) p.log.info(`GET ${url}`);

  const response = await fetch(url, { headers: authHeaders() });
  const body = await response.text();

  if (debug) p.log.info(`HTTP ${response.status}\n${body}`);
  if (!response.ok) {
    throw requestError(response.status, body);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new CLIError("Registry returned a non-JSON response.", body.slice(0, 500));
  }
}

// List every extension, optionally scoped to a platform. The registry filters server-side;
// an unknown/empty platform simply returns the unfiltered set.
export async function listExtensions(platform?: string, debug = false): Promise<Extendable[]> {
  const query = platform ? `?platform=${encodeURIComponent(platform)}` : "";
  const parsed = (await getJson(`/extendables${query}`, debug)) as { data?: Extendable[] };
  return parsed.data ?? [];
}

// Fetch one extension by slug (e.g. "booking_portal@v1"). The registry 404s on an unknown
// slug; we turn that into an actionable CLIError rather than a raw request dump.
export async function showExtension(slug: string, debug = false): Promise<ExtendableDetail> {
  const url = `${getRegistryApiUrl()}/extendables/${encodeURIComponent(slug)}`;
  if (debug) p.log.info(`GET ${url}`);

  const response = await fetch(url, { headers: authHeaders() });
  const body = await response.text();

  if (debug) p.log.info(`HTTP ${response.status}\n${body}`);

  if (response.status === 404) {
    throw new CLIError(
      `No extension found with slug "${slug}".`,
      "Run `peek extensions list` to see available slugs.",
    );
  }
  if (!response.ok) {
    throw requestError(response.status, body);
  }

  let parsed: { data?: ExtendableDetail };
  try {
    parsed = JSON.parse(body) as { data?: ExtendableDetail };
  } catch {
    throw new CLIError("Registry returned a non-JSON response.", body.slice(0, 500));
  }

  if (!parsed.data) {
    throw new CLIError(`Extension response had no data for "${slug}".`);
  }
  return parsed.data;
}

// "peek" (or null → every platform) for display.
export function platformsSummary(platforms: string[] | null): string {
  if (!platforms || platforms.length === 0) return "all platforms";
  return platforms.join(", ");
}
