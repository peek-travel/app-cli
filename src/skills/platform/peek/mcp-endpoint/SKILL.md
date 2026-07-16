---
name: peek-mcp-endpoint
description: >-
  The concrete Peek MCP endpoint — how a starter-kit app exposes its functionality as MCP tools so
  the Peek Pro App Store's AI orchestrator can drive it without opening the UI. Use when adding or
  changing the app's MCP endpoint, wiring its auth, or declaring it in app.json. Covers reusing
  withPeekAuthentication (the same peek-auth token as the UI), the tools/list + tools/call route
  shape, the tools module pattern, declaring the endpoint in app.json, and the Peek-specific stack
  flags (PeekAccessService is Node-only → Node runtime not Edge). Triggers on "MCP", "MCP
  endpoint", "expose tools", "tools/list", "tools/call", "App Store AI", "headless access",
  "expose functionality", "what to expose".
---

# The app's Peek MCP endpoint

This is the **concrete Peek MCP mechanism**. The generic model — expose your app to the store AI,
reuse the UI's auth, curate the tool surface (reads by default, gate writes, share logic with the
UI), and the "what to expose" philosophy — lives in `mcp-endpoint`. Read that for the *why* and
the curation discipline; **don't fully re-derive it here**. This skill is the authoritative *how
Peek wires it*.

Every app in the Peek Pro App Store exposes its key functionality through an **MCP endpoint** so
the App Store's **AI orchestrator** can operate it across all a user's installed apps by chat,
without opening each app's iframe UI.

> **This is a runtime surface the app *serves*, not a build-time tool you *call*.** Build it by
> default alongside the UI. When you need a concrete Peek fact (wire protocol, registry key, SDK
> method), get it from the installed `@peektravel/app-utilities` package or the live doc
> (`javascript-app-utilities`), and `TODO(verify)` what isn't pinned.

## Same authentication as the UI — reuse `withPeekAuthentication`

The MCP endpoint authenticates **exactly like every UI API route**: a short-lived peek-auth JWT in
the `x-peek-auth: Bearer <token>` header, verified library-side, yielding an install-scoped
`PeekAccessService`. The only difference from the UI is *who holds the token*: the browser SPA
gets it from the parent frame via `postMessage`; the **AI orchestrator obtains its own peek-auth
token for the install and sends it on the same header**. Acquiring the token is the caller's
problem — your endpoint just verifies it. So **reuse `withPeekAuthentication`** (see
`peek-embed-and-auth`); do not build a second auth scheme, an API key, or a bearer of your own.

```ts
// app/examples/peek-pro/mcp/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { type PeekAccessService } from '@peektravel/app-utilities';
import { withPeekAuthentication } from '@/lib/with-peek';
import { MCP_TOOLS, callTool } from './tools';

// The endpoint is just another authenticated route — same verification as the UI.
export const POST = withPeekAuthentication(
  async (request: NextRequest, peek: PeekAccessService) => {
    const req = await request.json();

    // Discovery: return the MCP definition — the list of tools this app exposes.
    if (req.method === 'tools/list') {
      return NextResponse.json({
        tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    }

    // Invocation: dispatch to a tool, passing the install-scoped client.
    if (req.method === 'tools/call') {
      const result = await callTool(req.params.name, req.params.arguments, peek);
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: 'unsupported method' }, { status: 400 });
  },
);
```

> **The exact MCP wire protocol / transport is volatile — check the installed
> `@peektravel/app-utilities` package (types + `docs/`) or pull the live doc** for the precise
> JSON-RPC methods, the initialize handshake, and the transport (Streamable HTTP vs. SSE). The
> shape above (a `tools/list` that returns the definition + a `tools/call` that dispatches) is the
> stable mental model; pin the concrete contract before shipping and mark unknowns `TODO(verify)`.

## The tools module — reuse your existing service-layer logic

Each tool is **name + description + input schema (JSON Schema) + a handler**. The handler must
call the **same service-layer function your UI API routes already use** — don't fork a parallel
implementation.

```ts
// app/examples/peek-pro/mcp/tools.ts
import { type PeekAccessService } from '@peektravel/app-utilities';

export const MCP_TOOLS = [
  {
    name: 'list_activities',
    description: 'List the bookable activities/products in this Peek Pro account.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args: unknown, peek: PeekAccessService) =>
      peek.getAllActivities(), // the SAME call the UI's /api/activities route makes
  },
  // ...one entry per exposed capability
] as const;

export async function callTool(name: string, args: unknown, peek: PeekAccessService) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args, peek);
}
```

## What to expose — a Peek-specific starting point

The curation discipline (come with a recommendation, reads-by-default, gate writes, never expose
destructive actions without an explicit yes, treat tool I/O as PII, write descriptions for a
reader that only has the description) is generic — **it lives in `mcp-endpoint`; follow it there.**
Derive the candidate tools from *this* app's key jobs and the UI actions you're building. A
concrete Peek example, for a read-oriented app:

- `list_activities` → `peek.getAllActivities()` (read, safe default)
- `search_bookings` → `peek.searchBookingsByTimeRange({ start, end, searchBy })` (read)
- a write like `assign_guide` → `peek.assignTimeslotGuide(...)` (mutates Peek — gate it; confirm
  the user wants the AI to do it unattended)

Normalize IDs on input (`B-123ABC` → `b_123abc`) and state units/formats in the description — see
`peek-backoffice-api`. Present the proposed list to the user and get sign-off before implementing.

## Declaring the endpoint in `app.json`

**Declare the MCP endpoint in `app.json`** so Peek/the orchestrator can find it. The exact
registry extendable/key for an MCP endpoint URL is **volatile** — check the installed package
(types + `docs/`) / pull the live registry doc for the correct slug, and update the manifest to
match (see `peek-manifest-and-deploy`). `TODO(verify)` the key if the doc doesn't pin it.

## Peek-specific stack flag: Node runtime, not Edge

The generic "the MCP endpoint is driven server-to-server, so a stack/deploy mismatch can leave it
silently broken" caveats (streaming vs serverless limits, statelessness, public reachability, JSON
only) are framework concerns — see `javascript-nextjs`. The **Peek-specific instance** of the
generic "must run where the SDK can" flag:

- **`PeekAccessService` is Node-only** (it verifies the JWT and mints API tokens with Node
  `crypto`). If the route is put on the Edge runtime (`export const runtime = 'edge'`, or a host
  that defaults routes to Edge), token verification and the SDK break. **Keep the
  `app/examples/peek-pro/mcp` route on the Node runtime.**

## Testing the endpoint

Test it like any authenticated route (see `javascript-testing` for the runner), but cover the
MCP-specific assertions:

- **Auth** — a request with no / an invalid token returns **401** (same gate as the UI routes).
- **`tools/list`** returns the tool definition (the list of `{ name, description, inputSchema }`).
- **`tools/call`** dispatches to the right handler and each tool **stays install-scoped** — a tool
  must never read or act outside the scope of the verified token's install.

## Hard rules

- **Same auth as the UI — reuse `withPeekAuthentication`.** No second auth scheme, no API keys.
- **Install-scoped only.** Build tools from the *verified token's* claims (the `peek` client you
  were handed). A tool must never read or act outside its install scope.
- **Share logic with the UI; never fork it.** Tools call the same functions the UI routes call.
  Keep the tools in sync as the app grows (also in `AGENTS.md`).
- **`PeekAccessService` is Node-only — keep the route on the Node runtime, not Edge.**
- **Don't invent the wire protocol / registry key.** Get them from the installed package / live
  doc; `TODO(verify)` gaps.
- **Curate + treat tool I/O as PII** — per `mcp-endpoint`.

## Related skills

- **`mcp-endpoint`** (global) — the generic expose-to-the-store-AI / reuse-UI-auth / curate-the-
  surface philosophy (don't re-derive it here).
- **`peek-embed-and-auth`** — the auth pipeline (`withPeekAuthentication`, `requirePeekAuth`,
  `verifyPeekAuthToken`) the endpoint reuses verbatim.
- **`peek-backoffice-api`** — what `PeekAccessService` (`peek`) can do inside a tool handler, plus
  ID normalization, `installDataId` scoping, and PII rules for tool I/O.
- **`javascript-nextjs`** (stack) — the generic route-handler/runtime flags (streaming vs
  serverless, statelessness, JSON only) for a server-to-server endpoint.
- **`peek-manifest-and-deploy`** — declaring the MCP endpoint URL in `app.json` / the registry.
