---
name: peek-mcp-endpoint
description: >-
  How to expose an app's key functionality as an MCP endpoint so the Peek Pro App Store's AI
  orchestrator can drive the app without opening its UI. Use when adding or changing the app's
  MCP endpoint, deciding which tools to expose, defining a tool's input schema, or wiring the
  endpoint's auth. Every app built on this kit ships an MCP endpoint by default; it reuses the
  same peek-auth token verification as the UI and returns an MCP definition (a list of tools).
  Triggers on "MCP", "MCP endpoint", "expose tools", "tools/list", "tools/call", "App Store AI",
  "headless access", "programmatic access", "expose functionality", "what to expose".
---

# The app's MCP endpoint — exposing functionality to the App Store AI

Every app in the Peek Pro App Store exposes its **key functionality through an MCP endpoint**.
An **AI orchestrator** (the App Store's assistant) connects to the
MCP endpoints of *all* the apps a user has installed, so the user can act across many apps
**by chatting with one AI instead of opening each app's iframe UI**. Your job when building an
app is to make sure the same things a human can do in the UI, the AI can do through the MCP
endpoint — for the operations that make sense to expose.

> **This is a runtime surface the app *serves*, not a build-time tool you *call*.** Build it
> alongside the UI (see "Build it by default" below).

## What this endpoint is — and where Peek facts come from

The MCP endpoint is **a runtime surface your app serves** so the App Store AI orchestrator can
operate it (App Store AI → your app; a route declared in `app.json`; authed with the **same
peek-auth token as the UI**).

When you need a concrete Peek fact while building it — the wire protocol, a registry key, an SDK
method — get it from the **installed `@peektravel/app-utilities` package** (types in
`dist/index.d.ts` + `docs/`) or the live web doc, and `TODO(verify)` what isn't pinned.

## Same authentication as the UI — reuse the pipeline, don't reinvent it

The MCP endpoint authenticates **exactly like every UI API route**: a short-lived peek-auth
JWT in the `x-peek-auth: Bearer <token>` header, verified library-side, yielding an
**install-scoped `PeekAccessService`**. The only difference from the UI is *who holds the
token*: the browser SPA gets it from the parent frame via `postMessage`; the AI orchestrator
obtains its own peek-auth token for the install and sends it on the same header. **Acquiring
the token is the caller's problem — your endpoint just verifies it**, the same way UI routes do.

So you **reuse `withPeekAuthentication`** (see `peek-embed-and-auth`). Do not build a second
auth scheme, an API key, or a bearer of your own.

```ts
// app/peek-pro/mcp/route.ts
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
> JSON-RPC methods, the initialize handshake, the transport
> (Streamable HTTP vs. SSE), and how the orchestrator discovers and authenticates to your
> endpoint.** The shape above (a `tools/list` that returns the definition + a `tools/call` that
> dispatches) is the stable mental model; pin the concrete contract before shipping and mark any
> unknowns `TODO(verify)`. Return HTML never — JSON only (per AGENTS.md, no `react-dom/server`
> in route handlers).

## A tool is: name + description + input schema + a handler that reuses your existing logic

Each exposed tool has a **clear name**, a **description the AI reads to decide when to use it**,
a **typed input schema** (JSON Schema — this is the contract the orchestrator fills in), and a
**handler**. The handler must call the **same service-layer logic your UI API routes already
use** — don't fork a parallel implementation.

```ts
// app/peek-pro/mcp/tools.ts
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

**Keep UI and MCP in sync by sharing code, not duplicating it.** If both the UI route and an
MCP tool "search bookings," they should call one shared function. A capability that drifts
between the two surfaces is a bug.

## What to expose — come with a recommendation, then confirm with the user

Exposing every internal operation is wrong; so is handing the user a blank slate. The MCP surface
is a deliberate, curated API for an AI to act on the user's behalf. **Analyze the specific app
you're building, draft a concrete recommended tool list, and present *that* for the user to
adjust** — don't just ask "what should the tools be?" Work it one question at a time (per the
orchestrator's interaction rules) and confirm the final list:

- **Derive the candidates from the app's key jobs and the UI actions you're building.** What are
  the handful of things this app *exists* to do? Each meaningful UI action is a candidate tool
  (e.g. a waitlist app → `list_waitlist`, `add_guest_to_waitlist`, `notify_next_in_line`). Come to
  the user with that concrete list — names, a one-line description each, and read-vs-write flagged
  — as your **recommendation**, not an open question.
- **Reads are the safe default; gate writes explicitly.** Query/list/get tools are low-risk and
  usually worth exposing. For anything that **mutates Peek data or messages guests**, confirm
  the user wants the AI to do it unattended — and describe the effect plainly in the tool
  description so the orchestrator (and the user approving it) understands the blast radius.
- **Never expose destructive or irreversible actions without an explicit "yes."** Cancelling
  bookings, issuing refunds, deleting data — call these out individually; default to *not*
  exposing them unless the user asks.
- **PII discipline carries over.** Tool inputs/outputs can carry guest PII — return the
  **minimum** needed, prefer Peek IDs over copying PII, and never put PII or tokens in logs
  (see `peek-backoffice-api`). The install scope from the verified token is the security
  boundary; a tool must never widen it.
- **Write descriptions for a reader that only has the description.** The AI picks tools from the
  name + description + schema alone — make them unambiguous, state units/formats, and normalize
  IDs on input (`B-123ABC` → `b_123abc`; see `peek-backoffice-api`).

Present the proposed tool list back to the user and get sign-off before implementing — the MCP
surface is part of the plan, not an afterthought.

## Build it by default — but raise it explicitly at first build

The MCP endpoint is **part of the default build** — most App Store apps are expected to ship one,
and an app without it can't be driven from the App Store assistant. But **don't build it silently
and don't skip it silently: at the first build of an app, explicitly raise it with the user and
recommend including it.**

- **Ask, with a recommendation.** During discovery, tell the user the app will expose an MCP
  endpoint by default, explain the benefit (the App Store AI can operate it without the UI), and
  present your **recommended tool list** (derived from the app's jobs — see "What to expose"). Let
  them confirm, trim, or opt out. This is a required conversation, not an assumption.
- **Default is yes.** Unless the user explicitly says the app shouldn't be AI-addressable, build
  it. If they opt out, note that it won't appear to the App Store assistant, and record the
  decision in the plan.

Concretely, once confirmed:

1. **In discovery/planning**, agree the tool list with the user (above) and record it in the plan
   alongside the UI and data flow.
2. **In the build**, add the `app/peek-pro/mcp` route + tools module, reusing
   `withPeekAuthentication` and the same service-layer functions as the UI.
3. **Declare the endpoint in `app.json`** so Peek/the orchestrator can find it. The exact
   registry extendable/key for an MCP endpoint URL is volatile — check the installed package
   (types + `docs/`) / pull the live registry doc for the correct slug, and update the manifest to match (see
   `peek-app-manifest-and-deploy`). `TODO(verify)` the key if the doc doesn't pin it.
4. **Test it** like any route — auth (401 without a valid token), `tools/list` returns the
   definition, each tool dispatches and stays install-scoped (see `testing-peek-apps`).

## Flag stack issues that can silently break the endpoint

Unlike the UI (which the user exercises visually), the MCP endpoint is driven **server-to-server
by the orchestrator** — so a stack/deployment mismatch can leave it broken with no visible
symptom until the assistant tries to call it. **Check these against the chosen host/runtime and
flag any risk to the user before shipping:**

- **Must run on the Node.js runtime, not Edge.** `PeekAccessService` is **Node-only** (it verifies
  the JWT and mints API tokens with Node `crypto`). If the route is put on the Edge runtime
  (`export const runtime = 'edge'`, or a host that defaults routes to Edge), token verification and
  the SDK break. Keep the `app/peek-pro/mcp` route on Node.
- **Streaming transport vs. serverless limits.** If the MCP transport the orchestrator requires is
  **SSE / long-lived Streamable HTTP**, serverless hosts (Vercel by default) cap function duration
  and may buffer responses — a long-lived stream can be cut off or never flush. A plain
  request/response `tools/list` + `tools/call` over POST is the safe shape. Verify the required
  transport (`TODO(verify)` from the package/live doc) against the host's streaming support + max
  duration, and flag a mismatch.
- **Statelessness — no in-memory sessions.** Serverless invocations don't share memory and
  cold-start independently. If the protocol has a stateful `initialize`/session handshake, you
  **cannot** hold session state in a module variable (the next request may hit a different
  instance). Keep the endpoint stateless, or externalize session state (e.g. your DB). Flag if the
  required protocol is session-based.
- **Public, un-iframed reachability.** The orchestrator calls the endpoint directly — none of the
  SPA/`postMessage`/token-from-parent machinery applies, and CSP `frame-ancestors` is irrelevant to
  a non-framed POST. The route just has to be publicly reachable and verify the caller's peek-auth
  token like any API route. Don't gate it behind iframe-only assumptions.
- **JSON only.** No `react-dom/server` in the handler (AGENTS.md) — return JSON.

## Hard rules

- **Same auth as the UI — reuse `withPeekAuthentication`.** No second auth scheme, no API keys.
  The endpoint verifies the peek-auth token; the caller (the orchestrator) supplies it.
- **Install-scoped only.** Build tools from the *verified token's* claims (the `peek` client you
  were handed). A tool must never read or act outside its install scope.
- **Share logic with the UI; never fork it.** Tools call the same functions the UI routes call.
- **Keep the tools in sync as the app grows.** When you add a feature/UI action that's meaningful
  to expose, add or update the matching MCP tool in the same change — a UI capability with no tool
  (or a stale tool) is drift. (This is also enforced in `AGENTS.md`.)
- **Curate the surface — expose deliberately.** Default to reads; gate writes; never expose
  destructive actions without an explicit user yes. Confirm the tool list with the user.
- **Treat tool I/O as PII.** Minimum data out, IDs over PII, nothing sensitive in logs.
- **Don't invent the wire protocol / registry key.** Get the concrete MCP contract and the
  manifest slug from the installed package (types + `docs/`) / live doc; `TODO(verify)` gaps —
  never guess and ship.
- **JSON responses only.** No `react-dom/server` in the route handler (AGENTS.md).

## Related skills

- **peek-embed-and-auth** — the auth pipeline (`withPeekAuthentication`, `requirePeekAuth`,
  `verifyPeekAuthToken`) the endpoint reuses verbatim.
- **peek-backoffice-api** — what `PeekAccessService` (`peek`) can do inside a tool handler, plus
  ID normalization, `installDataId` scoping, and PII rules that apply to tool I/O.
- **peek-app-manifest-and-deploy** — declaring the MCP endpoint URL in `app.json` / the registry.
- **testing-peek-apps** — testing the endpoint's auth and each tool.
- **peek-app-builder** — the orchestrator; it schedules the MCP endpoint into the build by default.
