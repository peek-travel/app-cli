---
name: acme-mcp-endpoint
description: >-
  The concrete ACME MCP endpoint — how a starter-kit app exposes its functionality as MCP tools for
  the App Store AI orchestrator, on ACME. Use when adding or changing the app's ACME MCP endpoint,
  wiring its auth, or declaring it in app.acme.json. Covers reusing withAppAuthentication (the same
  brand-agnostic peek-auth token as the UI), the tools/list + tools/call route shape, sharing
  service-layer logic with the UI, the Node-runtime requirement, and the fact that ACME's small
  typed SDK surface is the hard ceiling on what you can expose. Triggers on "acme MCP", "MCP
  endpoint", "expose acme tools", "tools/list", "tools/call", "App Store AI", "headless acme access".
---

# The app's ACME MCP endpoint

This is the **concrete ACME MCP mechanism**. The generic model — expose your app to the store AI,
reuse the UI's auth, curate the tool surface (reads by default, gate writes, share logic with the
UI) — lives in `mcp-endpoint`. Read that for the *why* and the curation discipline; don't re-derive
it here. This skill is the authoritative *how ACME wires it*.

> **Not scaffolded today.** This starter ships no MCP route for any platform. This skill is how you
> add one for ACME. When you need a concrete fact (wire protocol, registry key), get it from the
> installed `@peektravel/app-utilities` package / the live doc (`javascript-app-utilities`) and
> `TODO(verify)` what isn't pinned. Build it as a Node-runtime Next.js Route Handler.

## Same authentication as the UI — reuse `withAppAuthentication`

The MCP endpoint authenticates **exactly like every ACME UI API route**: the brand-agnostic
peek-auth JWT in `x-peek-auth: Bearer <token>`, verified library-side, yielding an install-scoped
`AcmeAccessService`. The only difference from the UI is *who holds the token*: the browser SPA gets
it from the parent frame; the **AI orchestrator obtains its own token for the install** and sends
it on the same header. So **reuse `withAppAuthentication<AcmeAccessService>`** (see
`acme-embed-and-auth`) — do not build a second auth scheme, an API key, or a bearer of your own.

```ts
// app/examples/acme/mcp/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type AcmeAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";
import { MCP_TOOLS, callTool } from "./tools";

export const POST = withAppAuthentication<AcmeAccessService>(
  async (request: NextRequest, acme: AcmeAccessService) => {
    const req = await request.json();

    if (req.method === "tools/list") {
      return NextResponse.json({
        tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    }
    if (req.method === "tools/call") {
      const result = await callTool(req.params.name, req.params.arguments, acme);
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: "unsupported method" }, { status: 400 });
  },
);
```

> **The exact MCP wire protocol / transport is volatile** — check the installed package (types +
> `docs/`) or the live doc for the precise JSON-RPC methods, the initialize handshake, and the
> transport. The shape above (a `tools/list` returning the definition + a `tools/call` that
> dispatches) is the stable mental model; pin the concrete contract and `TODO(verify)` gaps.

## The tools module — reuse your existing service-layer logic

Each tool is **name + description + input schema (JSON Schema) + a handler**, and the handler must
call the **same service-layer function your ACME UI routes already use** — don't fork a parallel
implementation.

```ts
// app/examples/acme/mcp/tools.ts
export const MCP_TOOLS = [
  {
    name: "list_activities",
    description: "List the bookable activities (published event templates) in this ACME account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args: unknown, acme: AcmeAccessService) => acme.getAllActivities(),
  },
] as const;

export async function callTool(name: string, args: unknown, acme: AcmeAccessService) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, acme);
}
```

## What to expose — capped by ACME's SDK surface

The curation discipline (reads-by-default, gate writes, never expose destructive actions without an
explicit yes, treat tool I/O as PII, write descriptions for a reader that only has the description)
is generic — it lives in `mcp-endpoint`; follow it there.

The ACME-specific reality: **ACME's typed SDK is small today and is a hard ceiling** — the typed
client is the only supported way in, so you can expose **only** what it actually offers (there is no
direct-API escape hatch — see `acme-backoffice-api`). Right now that's essentially `list_activities`
→ `acme.getAllActivities()` (a read, the safe default). As the ACME SDK grows, add one tool per new
capability, mirroring the UI actions you build. Present the proposed list to the user and get
sign-off before implementing.

## ACME-specific stack flag: Node runtime, not Edge

`AcmeAccessService` is **Node-only** (it verifies the JWT and mints API tokens with Node `crypto`).
If the route runs on the Edge runtime (`export const runtime = "edge"`, or a host that defaults to
Edge), token verification and the SDK break. **Keep the ACME MCP route on the Node runtime.**

## Testing the endpoint

Test it like any authenticated route (see `javascript-testing`), covering the MCP-specific
assertions: no/invalid token → **401**; `tools/list` returns the definition; `tools/call`
dispatches to the right handler; each tool **stays install-scoped** (never reads/acts outside the
verified token's install).

## Hard rules

- **Same auth as the UI — reuse `withAppAuthentication`.** No second auth scheme, no API keys.
- **Install-scoped only.** Build tools from the verified token's `acme` client; never act outside
  its install scope.
- **Share logic with the UI; never fork it.** Tools call the same service-layer functions the UI
  routes call; keep them in sync as the app grows (also in `AGENTS.md`).
- **`AcmeAccessService` is Node-only — keep the route on the Node runtime, not Edge.**
- **Don't invent the wire protocol / registry key or a capability the SDK lacks** — the typed SDK
  is the ceiling on ACME. Get facts from the installed package / live doc; `TODO(verify)` gaps.

## Related skills

- **`mcp-endpoint`** (global) — the generic expose-to-the-store-AI / reuse-UI-auth / curate-the-
  surface philosophy (don't re-derive it here).
- **`acme-embed-and-auth`** — the `withAppAuthentication` pipeline the endpoint reuses verbatim.
- **`acme-backoffice-api`** — what `AcmeAccessService` can do inside a tool handler, the typed-SDK
  capability ceiling, and PII rules for tool I/O.
- **`javascript-nextjs`** (stack) — the route-handler/runtime flags for a server-to-server endpoint.
- **`acme-manifest-and-deploy`** — declaring the MCP endpoint URL in `app.acme.json` / the registry.
