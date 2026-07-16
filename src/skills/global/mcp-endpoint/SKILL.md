---
name: mcp-endpoint
description: >-
  How to expose an app's key functionality as an MCP endpoint so the app store's AI orchestrator
  can drive the app without opening its UI. Use when adding or changing the app's MCP endpoint,
  deciding which tools to expose, defining a tool's input schema, or wiring the endpoint's auth.
  Every app built on this kit ships an MCP endpoint by default; it reuses the SAME auth as the UI
  and returns a list of tools. Triggers on "MCP", "MCP endpoint", "expose tools", "tools/list",
  "tools/call", "App Store AI", "headless access", "programmatic access", "what to expose".
---

# The app's MCP endpoint — exposing functionality to the store's AI

Every app in the platform's app store is expected to expose its **key functionality through an MCP
endpoint**. An **AI orchestrator** (the store's assistant) connects to the MCP endpoints of *all*
the apps a user has installed, so the user can act across many apps **by chatting with one AI
instead of opening each app's UI**. Your job when building an app is to make sure the things a human
can do in the UI, the AI can do through the MCP endpoint — for the operations that make sense to
expose. **Peek Pro is the canonical example** — its concrete wiring lives in `peek-mcp-endpoint`.

> **This is a runtime surface the app *serves*, not a build-time tool you *call*.** Build it
> alongside the UI (see "Build it by default" below).

## Reuse the SAME auth as the UI — don't invent a second scheme

The MCP endpoint authenticates **exactly like every UI API route**: the same short-lived identity
token, verified library-side, yielding the same **install/tenant-scoped platform client**. The only
difference from the UI is *who holds the token* — the browser SPA gets it from the host frame; the
AI orchestrator obtains its own token for the install and sends it on the same header. **Acquiring
the token is the caller's problem — your endpoint just verifies it**, the same way UI routes do.

So **reuse the app's existing auth wrapper** (see `embed-and-auth`). Do **not** build a second auth
scheme, an API key, or a bearer of your own. The concrete route and wrapper are stack/platform
specific — see `peek-mcp-endpoint` and `javascript-nextjs`.

> **The exact MCP wire protocol / transport is volatile.** The stable mental model is a discovery
> call that returns the tool list plus an invocation call that dispatches to a tool. Pin the
> concrete JSON-RPC methods, the initialize handshake, and the transport from the installed package
> (types + `docs/`) or the live doc before shipping; `TODO(verify)` anything unpinned.

## A tool = name + description + input schema + a handler that reuses your UI logic

Each exposed tool has:

- a **clear name**;
- a **description the AI reads to decide when to use it** — write it for a reader who has *only* the
  name + description + schema; make it unambiguous, state units/formats, and normalize IDs on input;
- a **typed input schema** (JSON Schema — the contract the orchestrator fills in);
- a **handler** that calls the **same service-layer logic your UI API routes already use.**

**Keep UI and MCP in sync by sharing code, not duplicating it.** If both a UI route and an MCP tool
"search bookings," they call **one shared function**. A capability that drifts between the two
surfaces is a bug. See `peek-mcp-endpoint` for the concrete tool-module shape.

## Curate the surface — expose deliberately

Exposing every internal operation is wrong; so is handing the user a blank slate. The MCP surface is
a deliberate, curated API for an AI to act on the user's behalf.

- **Come with a recommendation, then confirm.** Derive the candidate tools from the app's key jobs
  and the UI actions you're building (e.g. a waitlist app → `list_waitlist`, `add_guest_to_waitlist`,
  `notify_next_in_line`). Present that concrete list — names, a one-line description each, read-vs-
  write flagged — as your recommendation, one question at a time; get sign-off. Don't just ask "what
  should the tools be?"
- **Reads are the safe default; gate writes explicitly.** Query/list/get tools are low-risk and
  usually worth exposing. For anything that **mutates platform data or messages guests**, confirm
  the user wants the AI to do it unattended, and describe the blast radius plainly in the tool
  description.
- **Never expose destructive or irreversible actions without an explicit "yes."** Cancelling
  bookings, issuing refunds, deleting data — call these out individually; default to *not* exposing
  them unless the user asks.
- **PII discipline on tool I/O.** Tool inputs/outputs can carry guest PII — return the **minimum**
  needed, prefer platform IDs over copying PII, never put PII or tokens in logs (see
  `backoffice-data`).
- **Install/tenant-scoped only.** Build tools from the *verified token's* claims (the scoped client
  you were handed). A tool must **never** read or act outside its install scope.

## Build it by default — but raise it explicitly at first build

The MCP endpoint is **part of the default build** — an app without it can't be driven from the
store's assistant. But **don't build it silently and don't skip it silently: at the first build of
an app, explicitly raise it with the user and recommend including it.**

- **Ask, with a recommendation.** During discovery, tell the user the app will expose an MCP
  endpoint by default, explain the benefit (the store's AI can operate it without the UI), and
  present your recommended tool list. Let them confirm, trim, or opt out. This is a required
  conversation, not an assumption.
- **Default is yes.** Unless the user explicitly says the app shouldn't be AI-addressable, build it.
  If they opt out, note that it won't appear to the store assistant, and record the decision in the
  plan.
- **Keep it in sync as the app grows.** When you add a feature/UI action that's meaningful to
  expose, add or update the matching MCP tool **in the same change** — a UI capability with no tool
  (or a stale tool) is drift the assistant will act on incorrectly.

Once confirmed: agree the tool list in the plan, add the endpoint route + tools module reusing the
UI's auth wrapper and service-layer functions, **declare the endpoint URL in the manifest** so the
orchestrator can find it (the exact registry key is platform-specific — see `manifest-and-deploy`),
and test it like any route (see `testing`).

## Flag stack/runtime risks that can silently break the endpoint

Unlike the UI (which the user exercises visually), the MCP endpoint is driven **server-to-server by
the orchestrator** — so a stack/deployment mismatch can leave it broken with **no visible symptom**
until the assistant tries to call it. Check these against the chosen host/runtime and flag any risk
to the user before shipping; the concrete flags are stack-specific (see `javascript-nextjs`):

- **It must run where the SDK can run.** If the platform SDK needs a full server runtime (e.g.
  Node's `crypto` to verify tokens and mint API credentials), the endpoint **cannot** be placed on a
  limited edge runtime, or auth and the SDK break.
- **Streaming transport vs. serverless duration limits.** If the required MCP transport is a
  long-lived stream (SSE / streamable HTTP), serverless hosts cap function duration and may buffer —
  a stream can be cut off or never flush. A plain request/response shape is the safe default. Verify
  the required transport against the host's limits.
- **Statelessness — no in-memory sessions.** Serverless invocations don't share memory and
  cold-start independently. If the protocol has a stateful session handshake, you **cannot** hold
  session state in a module variable — keep the endpoint stateless or externalize session state.
- **Public, un-iframed reachability.** The orchestrator calls the endpoint directly — none of the
  SPA / token-from-host machinery applies, and iframe CSP is irrelevant. The route just has to be
  publicly reachable and verify the caller's token like any API route. Don't gate it behind
  iframe-only assumptions.

## Hard rules

- **Same auth as the UI — reuse the app's auth wrapper.** No second auth scheme, no API keys.
- **Install/tenant-scoped only.** Tools act only within the verified token's scope.
- **Share logic with the UI; never fork it.** Tools call the same functions the UI routes call.
- **Keep the tools in sync as the app grows.** A UI capability with no tool, or a stale tool, is
  drift.
- **Curate the surface.** Default to reads; gate writes; never expose destructive actions without an
  explicit user yes. Confirm the tool list with the user.
- **Treat tool I/O as PII.** Minimum data out, IDs over PII, nothing sensitive in logs.
- **Don't invent the wire protocol / registry key.** Get the concrete contract and the manifest slug
  from the installed package (types + `docs/`) / live doc; `TODO(verify)` gaps — never guess and
  ship.

## Related skills

- `peek-mcp-endpoint` — the canonical concrete endpoint: the auth wrapper it reuses, the tool module
  shape, and the manifest registry key.
- `javascript-nextjs` — the stack mechanics: the route handler, the server (not edge) runtime, and
  the streaming/statelessness flags.
- `embed-and-auth` — the auth pipeline the endpoint reuses verbatim.
- `backoffice-data` — what the scoped client can do inside a tool handler, plus ID normalization and
  PII rules.
- `manifest-and-deploy` — declaring the MCP endpoint URL in the manifest/registry.
- `testing` — testing the endpoint's auth and each tool.
- `app-builder` — the orchestrator; it schedules the MCP endpoint into the build by default.
