---
name: peek-embed-and-auth
description: >-
  The concrete Peek Pro embed + auth wiring — how a starter-kit app embeds inside the Peek Pro
  iframe and authenticates every request with a peek-auth JWT. Use when adding or changing an
  authenticated API route, a client-side data fetch, the token handshake, the install/embed entry
  route, CSP/iframe headers, or when debugging 401s, a blank iframe, or "token"/postMessage
  problems. Covers the POST → redirect → SPA → postMessage-token → Bearer-API pipeline, the exact
  PeekAuthTokenClaims shape, createPeekService vs createPeekServiceForInstall for server-to-Peek
  without a user token, and the file map that owns each piece. Triggers on "add an API route",
  "authenticate a request", "peek-auth token", "iframe won't load", "401 in the embed",
  "postMessage token", "call Peek without a user token", "createPeekServiceForInstall",
  "cron/background Peek", "withAppAuthentication", "withPeekAuthentication".
---

# Peek Pro embed & auth pipeline

This is the **concrete Peek mechanism** for host-owned identity. The generic model — the host
owns identity, verify server-side, never build your own login, scope to an install — lives in
`embed-and-auth`; read that for the *why*. This skill is the authoritative map of *how Peek does
it*, and the recipe for extending it.

> Read this before touching anything under `app/examples/peek-pro/`, `lib/with-app.ts`,
> `lib/with-peek.ts`, `lib/api-auth.ts`, `lib/peek-service.ts`, or `lib/app-client/`. The Next.js route-handler /
> `"use client"` SPA mechanics (why there's no SSR data fetch, no `react-dom/server`) are a
> **stack** concern — see `javascript-nextjs`. Here we cover the peek-auth token, the handshake,
> and the install scoping.

## The one Peek fact: the token only exists in the browser

Peek Pro hands the acting user's identity to the app as a signed **peek-auth JWT**, delivered to
the **parent frame**. The embedded app obtains it via `postMessage` — **there is no server-side
copy.** That single fact is why this pipeline looks the way it does (no cookies, no SSR data
fetch, library-owned verification — all derived in `embed-and-auth` and `javascript-nextjs`).

This is only about the acting **user's identity**. It does **not** mean you can't call Peek
without a user token — you can, install-scoped, from any server context that has a persisted
`installId` (see [Server-to-Peek without a user token](#server-to-peek-without-a-user-token)).

## The request lifecycle (end to end)

```
1. Peek Pro POSTs the signed peek-auth JWT to  /examples/peek-pro/main   (app/examples/peek-pro/main/route.ts)
2. That route IGNORES the token and 302-redirects to the GET view
       → the token can't survive a redirect (no cookies); it isn't needed here
3. The SPA boots at /examples/peek-pro/main/view  ("use client")         (view/layout.tsx, view/page.tsx)
4. The SPA asks the parent for a token:  window.parent.postMessage({type:"peek-iframe-token-refresh"})
       → parent replies  {type:"peek-token-response", token}             (lib/app-client/api.ts)
5. Token cached in memory; the view renders only AFTER it arrives (the "ready" gate)
6. Each data call goes to an API route with header  x-peek-auth: Bearer <token>   (apiFetch)
7. The route verifies the token and builds an install-scoped Peek client:
       withAppAuthentication → requirePeekAuth → verifyPeekAuthToken → createAppService → createPeekService
8. On 401, apiFetch requests a fresh token via the SAME channel and retries once
```

The two message types are Peek-specific: **`peek-iframe-token-refresh`** (SPA → parent, "give me
a token") and **`peek-token-response`** (parent → SPA, `{ token }`). The 401-refresh path in step
8 reuses that *same* channel — it's a refresh, not a second bootstrap.

### The auth wrapper — `withAppAuthentication`, verify once then branch on platform

Because one deployment can be embedded into multiple platforms (Peek, cng, acme), the current
wrapper is the **brand-agnostic `withAppAuthentication`** (`lib/with-app.ts`): it verifies the
peek-auth JWT once (via `requirePeekAuth`), then `createAppService` (`lib/app-service.ts`) factories
the accessor matching the token's `user.platform` claim — for Peek that's the `case "peek"` branch
→ `createPeekService`. A route lives under exactly one platform's tree, so name the concrete
accessor at the call site and skip runtime narrowing:

```ts
export const GET = withAppAuthentication<PeekAccessService>(
  async (_request, peek) => { /* peek is a PeekAccessService */ },
);
```

A **peek-only** wrapper, `withPeekAuthentication` (`lib/with-peek.ts`), also still ships — it skips
the platform branch and always builds a `PeekAccessService` (the `dashboard` example uses it). For a
single-platform Peek app the two are equivalent; **new code should prefer `withAppAuthentication`**
so the same app can be embedded into cng/acme without rewiring auth. Everything below applies to
both — only the wrapper name and the (skipped vs. taken) platform branch differ.

### Why the POST route throws the token away
`app/examples/peek-pro/main/route.ts` does **not** authenticate. `page.tsx` can't receive POST,
so the route exists only to convert Peek's POST into a redirect to the GET view. Verifying here
would be pointless: the token can't be forwarded (no cookies) and the GET view is openly
reachable anyway. Real auth happens per-API-request in step 7. Don't add verification to this
route. (The route-handler-can't-be-a-page mechanic is a `javascript-nextjs` detail.)

## What's actually in the token — and what isn't (`installDataId`)

The verified claims are **smaller than people assume**. `PeekAuthTokenClaims` is only:

```ts
type PeekAuthTokenClaims = {
  installId: string;        // which install is acting — the ONLY field you build the service from
  displayVersion: string;   // the app version Peek loaded
  user: { /* acting user identity — PII; don't log */ };
};
```

**`installDataId` is NOT in the token.** This trips people up because this skill and
`peek-backoffice-api` both tell you to *scope persisted data by `installDataId`* — which reads
like a claim you can pluck off `auth`. It isn't. There is no `auth.installDataId`.

`installDataId` is a **data-scoping key you derive yourself** (get-or-create lazily on the first
authenticated request, keyed off `auth.installId`), not an identity Peek hands you. So:

- To build a Peek client, you need **`installId`** (in the token, or persisted).
- To scope rows in *your own* database, you use **`installDataId`**, which you derived from
  `auth.installId` and stored. See `peek-backoffice-api` for exactly how it's derived (and why
  the reinstall-wipe half is a `TODO(verify)` until an uninstall webhook exists).

## Server-to-Peek without a user token

The peek-auth pipeline is one of two ways to reach Peek — the one that carries the *acting
user's* identity. But **you do not need a user token to call Peek at all.** Look at what
`createPeekService` consumes:

```ts
// lib/peek-service.ts — the ONLY thing it reads off the claims is installId
export function createPeekService(auth: PeekAuthTokenClaims): PeekAccessService {
  const env = parseEnv();
  return new PeekAccessService({
    installId: auth.installId,      // ← the entire user-token contribution
    jwtSecret: env.PEEK_APP_SECRET, // ← everything else is your app's own secret/config
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    gatewayKey: env.PEEK_APP_ID,
    baseUrl: env.PEEK_API_URL,
    mode: "v2",
  });
}
```

`PeekAccessService` **mints its own API tokens** from `installId` + `PEEK_APP_SECRET`. The
peek-auth JWT is not a Peek API credential — it's just how the browser tells the server *which
install* is acting. So **any `installId` you have persisted lets you build a fully functional,
install-scoped Peek client server-side**, with no user token and no browser in the loop. That is
the load-bearing fact behind every non-embedded server path: **public (non-embedded) pages**,
**webhooks** (the delivery carries the `installId` — see `peek-webhooks`), and **cron /
background / reconciliation** jobs.

**Recipe: an install-scoped client with no user token.** Add a sibling to `createPeekService`
that takes the `installId` directly. Both construct the exact same service:

```ts
// lib/peek-service.ts
export function createPeekServiceForInstall(installId: string): PeekAccessService {
  const env = parseEnv();
  return new PeekAccessService({
    installId,
    jwtSecret: env.PEEK_APP_SECRET,
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    gatewayKey: env.PEEK_APP_ID,
    baseUrl: env.PEEK_API_URL,
    mode: "v2",
  });
}

// createPeekService(auth) can then just delegate:
//   export const createPeekService = (auth: PeekAuthTokenClaims) =>
//     createPeekServiceForInstall(auth.installId);
```

```ts
// e.g. a public route / cron job — no x-peek-auth header, no token gate
import { createPeekServiceForInstall } from "@/lib/peek-service";

const peek = createPeekServiceForInstall(installId); // installId from YOUR store
const activities = await peek.getAllActivities();    // full install-scoped API access
```

**Guardrails.** This bypasses user-identity checks by design, so the `installId` must come from a
trusted server-side source (your DB, a verified webhook), **never** from a query param or request
body a caller can forge. The browser-token pipeline is still correct for *embedded* API routes:
it proves *which* install the live user belongs to. Use `createPeekServiceForInstall` for the
paths where there is no live user. `PeekAccessService` and `verifyPeekAuthToken` come from the
JS SDK — see `javascript-app-utilities` for the package/paths.

## The files that own each piece

| Concern | File | What it does |
| --- | --- | --- |
| Embed entry (POST→redirect) | `app/examples/peek-pro/main/route.ts` | Converts Peek's POST into a 302 to the view. Ignores the token by design. |
| Token handshake + fetch helper | `lib/app-client/api.ts` | `requestToken()` (the single `peek-iframe-token-refresh` channel) and `apiFetch()` (Bearer + 401-refresh-retry). |
| The SPA bootstrap gate | `app/examples/peek-pro/main/view/layout.tsx` + `page.tsx` | Loads Odyssey, calls `requestToken()`, renders children only once `ready`. |
| Unified server-side auth wrapper | `lib/with-app.ts` | `withAppAuthentication<T>(handler)` — verify once, branch on `platform`, hand the route its accessor (`PeekAccessService` for Peek). The current default. |
| Platform branch | `lib/app-service.ts` | `createAppService(auth)` — maps `auth.user.platform` → the right accessor (`createPeekService` for Peek). |
| Peek-only auth wrapper | `lib/with-peek.ts` | `withPeekAuthentication(handler)` — skips the platform branch, always builds a `PeekAccessService`. Still shipped; used by the `dashboard` example. |
| Token verification | `lib/api-auth.ts` | `requirePeekAuth(request)` — pulls `x-peek-auth`, verifies, returns claims or a 401. |
| Peek client construction | `lib/peek-service.ts` | `createPeekService(auth)` / `createPeekServiceForInstall(installId)` and `verifyPeekAuthToken(token)`. |
| Env contract | `lib/env.ts` | Zod-validated `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_API_URL`, `PEEK_APP_URL` (see `peek-manifest-and-deploy`). |
| CSP / iframe headers | `next.config.ts` | `Content-Security-Policy: frame-ancestors 'self' *` on `/examples/peek-pro/:path*`. |

## Recipe: add a new authenticated API route + client call

The most common task. Follow the existing pattern exactly (see
`app/examples/peek-pro/main/api/me/route.ts` and `.../activities/route.ts`).

**1. Server — the route.** Wrap the handler in `withAppAuthentication<PeekAccessService>`. It hands
you a verified, install-scoped `PeekAccessService` (`peek`) and the token `auth` claims. Never read
or decode the token yourself. (Naming the type argument is what lets a route under the Peek tree
receive a concrete `PeekAccessService` with no narrowing.)

```ts
// app/examples/peek-pro/main/api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

export const GET = withAppAuthentication<PeekAccessService>(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const data = await peek.getAllActivities(); // SDK surface → peek-backoffice-api
    return NextResponse.json({ data });
  },
);
```

**2. Client — the fetch.** Call it through `apiFetch` so the `Bearer` header and 401-refresh are
handled for you. Only do this **after** the token gate (inside a `"use client"` component under a
layout that already called `requestToken()`).

```ts
import { apiFetch } from "@/lib/app-client/api";
const { data } = await apiFetch<{ data: Thing[] }>("/examples/peek-pro/main/api/<thing>");
```

**3. If it's a whole new view (its own bootstrap):** give it a layout that calls `requestToken()`
once and gates on `ready`. **Exactly one requester per mounted subtree** — descendants read the
cached token via `apiFetch`, they don't post their own request. (The Next.js App-Router
route/layout mechanics are in `javascript-nextjs`.)

## Make auth failures diagnosable: 500 for misconfig, 401 for a bad token

As written, `requirePeekAuth` wraps verification in a **bare `catch` that returns a naked 401**
and logs nothing. That has bitten a real deploy: when the `PEEK_APP_*` env vars were
misconfigured, `parseEnv()` threw *inside* `verifyPeekAuthToken`, the `catch` swallowed it, and
**every route returned 401 with zero signal** — indistinguishable from a genuine bad token.

Split the two failure modes:

- **Config error** (`parseEnv` threw — a missing/invalid `PEEK_APP_SECRET`, `PEEK_APP_ID`, …):
  the *deploy* is broken, not the caller. Return **500** and log loudly.
- **Token verification failure** (expired, wrong signature, wrong issuer): the caller's token is
  bad. Return **401**, and log the *reason* so it's greppable.

```ts
// lib/api-auth.ts — recommended
export function requirePeekAuth(request: NextRequest): AuthSuccess | AuthFailure {
  // Fail LOUD on misconfig, OUTSIDE the verify try/catch so it can't be laundered into a 401.
  try {
    parseEnv();
  } catch (err) {
    // parseEnv's message names the offending vars ("PEEK_APP_SECRET is required") — no secret
    // VALUES, safe to log. This is the line that turns a silent deploy into a 5-second fix.
    console.error("peek-auth: server misconfigured", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 }),
    };
  }

  const header = request.headers.get("x-peek-auth");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : header ?? null;
  if (!token) return { error: unauthorized() };

  try {
    return { auth: verifyPeekAuthToken(token) };
  } catch (err) {
    // Genuine auth failure. Log the REASON (e.g. "jwt expired") so a bad-token 401 is
    // distinguishable in logs from the misconfig 500 above. NEVER log the token itself, and
    // don't log the decoded claims — they carry user PII.
    console.warn("peek-auth: token verification failed", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return { error: unauthorized() };
  }
}
```

Log the **reason string only**. Never log the raw token (a live credential) or the decoded claims
(user PII). The `parseEnv` message and the library's verify error (`"jwt expired"`, `"invalid
signature"`) are both reason-only and safe. The same split applies anywhere you construct a
service from env, including the `createPeekServiceForInstall` server paths above.

## Hard rules (violating these breaks the embed silently)

- **Never suggest cookies** for the token, or any redirect-based token carry. Blocked in
  third-party iframes. (Generic rationale: `embed-and-auth`.)
- **Never verify the peek-auth JWT by hand.** Delegate to `PeekAccessService` via
  `verifyPeekAuthToken` / `withAppAuthentication` (or the peek-only `withPeekAuthentication`). Build
  the service from the *verified token's* claims (install-scoped), not from static values.
- **One token requester per mount.** Multiple `postMessage` listeners race and double-request the
  parent. Reuse `requestToken()` / `apiFetch`; the 401-refresh path is the same single channel.
- **Keep the `/examples/peek-pro/*` CSP header** — `frame-ancestors 'self' *`; without it Peek
  can't embed the app (and drop any `X-Frame-Options: DENY` Next might add).
- **Never let a config error surface as a 401.** A `parseEnv` throw is a misconfigured deploy —
  return 500 and log it; only a failed token verification is a 401.
- **No SSR data fetch, no `react-dom/server` in route handlers** — architectural, not stylistic;
  see `javascript-nextjs` for the framework rule.

## Related skills

- **`embed-and-auth`** (global) — the generic host-owned-identity model and the *why* behind
  every constraint here.
- **`javascript-nextjs`** (stack) — the route-handler / `"use client"` SPA mechanics (no SSR data
  fetch, no `react-dom/server`, CSP in `next.config.ts`, App-Router layout gating).
- **`javascript-app-utilities`** (stack) — where `PeekAccessService` / `verifyPeekAuthToken` come
  from, and how to introspect the installed package.
- **`peek-backoffice-api`** — what `PeekAccessService` (`peek`) can do once authenticated, plus ID
  normalization and `installDataId` scoping.
- **`peek-webhooks`** — the *other* inbound path (Peek → your endpoint); you verify the delivery
  signature, not a peek-auth token.
- **`peek-manifest-and-deploy`** — where the POST embed URL is declared (`app.json`) and how
  `PEEK_APP_SECRET` / `PEEK_APP_URL` are provisioned.
