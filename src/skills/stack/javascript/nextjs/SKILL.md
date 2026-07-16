---
name: javascript-nextjs
description: >-
  The Next.js / App-Router stack facts for apps built on this kit — treat it as "not the Next.js you
  know," read the installed docs, and follow the kit's route-handler, client-SPA, CSP, runtime, and
  env-validation patterns. Use when adding or changing a route handler (route.ts), a client-side
  view, iframe/CSP headers in next.config.ts, choosing the Node vs Edge runtime, or the env schema.
  Triggers on "route.ts", "route handler", "use client", "App Router", "next.config.ts", "CSP",
  "frame-ancestors", "X-Frame-Options", "react-dom/server", "Node vs Edge runtime", "runtime edge",
  "lib/env.ts", "Zod env", "next build", "Server Component in the embed", "SSR".
---

# Next.js on this starter kit

The app is a **Next.js App-Router** project. This skill is the framework layer — the Next-specific
patterns every JS-stack app on this kit follows. It's platform-neutral: the *auth pipeline* it hosts
is your platform's concern (peek is the canonical example — `peek-embed-and-auth`), but the framework
mechanics below hold on any platform on the JS stack.

## This is NOT the Next.js you know

This version has **breaking changes** — APIs, conventions, and file structure may differ from your
training data. **Before writing any code, read the relevant guide in the installed docs:**

```
node_modules/next/dist/docs/
```

**Heed deprecation notices** you see there and in build output. Don't "modernize" from memory — the
installed version is the source of truth, not what you recall about Next.

## Route handlers: no `react-dom/server`, JSON or string-template HTML

**Never use `react-dom/server` in a route handler.** Next **blocks it at the bundler level** — the
build fails. So in `route.ts`:

- **JSON** → `NextResponse.json(...)`. This is the norm (every API route, the MCP endpoint).
- **Raw HTML** (rare) → return a **string template**, not JSX/`renderToString`. String templates
  are the correct pattern here.

```ts
// app/.../api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";

export const GET = async (_request: NextRequest) => {
  return NextResponse.json({ ok: true });
};
```

A route handler can export `GET`, `POST`, etc. The auth wrapper the platform provides typically
wraps these (e.g. peek's `withPeekAuthentication(handler)` — see `peek-embed-and-auth`).

### The POST → redirect embed-entry route

`page.tsx` can't receive a `POST`. When the host posts into the app (e.g. the embed entry), a
**`route.ts` at the same path handles the POST and 302-redirects to the GET view** — it does *not*
authenticate there. (On peek the host POSTs the signed JWT, and the route deliberately ignores it
because the token can't survive a redirect and auth happens per-API-request instead — see
`peek-embed-and-auth`.) The framework fact: **use a sibling `route.ts` for POST, redirect to the
`"use client"` GET view.**

## Embedded views are client-side SPAs — Server Components do not apply

Any view rendered inside the host iframe is a **client-side SPA**. For those routes, do **not** reach
for Server Components, SSR data fetching, or "remove the `"use client"` directives to modernize" —
that advice is right for a normal Next app and **wrong here**, and the reason is architectural, not
stylistic.

**Why SSR can't participate:** the app can do nothing until it receives an auth token **from the
parent frame** (via `postMessage`). That token exists **only in the browser** — there is no
server-side copy, and it isn't available at SSR/RSC render time. Without it no API call can be
authenticated, so a Server Component has nothing to fetch. The **token gate**, not preference, forces
client rendering. This is **not** the "fetch-on-mount instead of RSC" anti-pattern — there is no
server-side alternative to opt into.

**How to build an embedded view (framework shape — the platform owns the message/helper names):**

1. **One token bootstrap, at the top.** Pick a single mount point for the subtree (a layout, or a
   root client component) and let it own the handshake: post the token request to the parent
   (`window.parent.postMessage(...)`), listen for the response, hand the token to a shared holder
   (module-level setter, context, or store), and render children **only once it has arrived**.
2. **Exactly one requester per mount.** Don't scatter `postMessage` token requests across layouts and
   pages — multiple listeners race and double-request the parent. Descendants read the token from the
   shared holder. A token **refresh** path (after a 401) is fine, but it's the *same* single channel,
   not a second bootstrap.
3. **Fetch in the client, after the gate.** Page components fetch in `useEffect` (or your client data
   layer) through a **helper that attaches the token as a `Bearer` header and does the 401→refresh→
   retry**. Centralize fetch + auth-header + 401-refresh in **one** helper, not per page.
4. **Keep server-side verification library-owned.** Route handlers that verify the token delegate to
   the platform's auth library rather than decoding JWTs by hand, and construct the install/tenant-
   scoped service from the **verified token's claims**, not static env values.

The concrete message types, helper names, and file layout differ per app and per platform; the
pipeline itself is `peek-embed-and-auth` (canonical) and the generic `embed-and-auth`.

## CSP / iframe headers in `next.config.ts`

The host embeds the app in an iframe, so the embed routes must **allow framing**. Set headers in
`next.config.ts`:

- **`Content-Security-Policy: frame-ancestors 'self' *`** on the embed path (e.g.
  `/examples/peek-pro/:path*`). Without it the host can't embed the app — blank iframe.
- **Drop any `X-Frame-Options: DENY`** Next might add — it conflicts with framing and blocks the
  embed.

(The MCP endpoint is called server-to-server, un-iframed, so `frame-ancestors` is irrelevant to it —
see below.)

## Runtime: Node vs Edge

Keep any route that uses the platform SDK on the **Node runtime**, not Edge. The SDK
(`@peektravel/app-utilities`) is **Node-only** — it verifies the auth JWT and mints API tokens with
Node `crypto`, which a limited Edge runtime lacks (see `javascript-app-utilities`). A route pinned to
Edge (`export const runtime = 'edge'`, or a host that defaults routes to Edge) **breaks token
verification and the SDK**.

For **long-lived / streaming endpoints** on serverless hosts (Vercel by default), also watch:

- **Function duration / streaming caps.** SSE or long-lived Streamable HTTP can be cut off or never
  flush under serverless duration limits. A plain request/response POST is the safe shape. Verify the
  required transport against the host's limits and flag a mismatch (see `peek-mcp-endpoint`).
- **Statelessness — no in-memory sessions.** Serverless invocations don't share memory and cold-start
  independently. Don't hold session/handshake state in a module variable; keep endpoints stateless or
  externalize state (e.g. your DB).

## `lib/env.ts` — Zod-validated env, fail loud on boot

Environment variables are validated with **Zod** in `lib/env.ts` (`parseEnv()`), so a missing/invalid
required var **throws loudly** rather than failing mysteriously later. Two consequences:

- **Every new runtime var must be added to the schema** so it's validated on boot — if it's read from
  `process.env` but not in the schema, add it. This also makes it show up on the deploy checklist
  (see `app-builder`).
- A `parseEnv()` throw is a **misconfigured deploy**, not a caller error — surface it as a **500 and
  log it**, never launder it into a 401 (see the misconfig-vs-bad-token split in
  `peek-embed-and-auth`).

## Validate with a real `next build`

`next build` regenerates `.next/types` and type-checks in its **own** pass, catching errors a bare
`tsc --noEmit` misses (notably custom-element `ref` typings — see `javascript-typings`). Run the full
gate (`pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`) before pushing — see
`javascript-testing`.

> **Running the embed** needs the host frame + parent-frame token + app-store registration — a plain
> `next dev` on `localhost` loads the app *outside* the host, so the token gate never resolves and
> every authenticated route 401s. A green dev-server boot proves nothing. Use the CLI's dev command
> (local tunnel registered with the app store) or deploy — see `app-builder`.

## Related skills

- **embed-and-auth** / **peek-embed-and-auth** — the auth pipeline these routes and client views
  host (the `postMessage` handshake, token verification, install scoping). This skill is the
  framework shell around it.
- **javascript-app-utilities** — the Node-only SDK that forces the Node runtime.
- **mcp-endpoint** / **peek-mcp-endpoint** — the server-to-server endpoint whose Node-runtime and
  serverless caveats live above.
- **javascript-typings** — why `next build` type-checks differently than `tsc`.
- **javascript-testing** — the lint/typecheck/test/build gate to run before pushing.
