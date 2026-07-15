---
name: peek-embed-and-auth
description: >-
  How this starter kit embeds inside the Peek Pro iframe and authenticates every request.
  Use when adding or changing an authenticated API route, a client-side data fetch, the
  token handshake, the install/embed entry route, CSP/iframe headers, or when debugging 401s,
  a blank iframe, or "token" / postMessage problems. Explains the POST → redirect → SPA →
  postMessage-token → Bearer-API pipeline and the constraints that force it (no cookies, no
  SSR data fetching, library-owned verification). Also covers calling Peek server-side WITHOUT a
  user token — install-scoped from a persisted installId — for public pages, webhooks, cron, and
  background reconciliation. Triggers on "add an API route", "authenticate a request", "peek-auth
  token", "iframe won't load", "401 in the embed", "postMessage token", "call Peek from a public
  page", "call Peek without a user token", "createPeekServiceForInstall", "cron/background Peek".
---

# Peek Pro embed & auth pipeline

This starter kit runs as a **client-side SPA embedded in a Peek Pro iframe**. It has no
sessions, no cookies, and no server-rendered data. Every authenticated request rides a
short-lived **peek-auth JWT** that the browser fetches from the parent frame. This skill is
the map of that pipeline and the recipe for extending it.

> Read this before touching anything under `app/peek-pro/`, `lib/with-peek.ts`,
> `lib/api-auth.ts`, `lib/peek-service.ts`, or `app/peek-pro/client/`. The architecture is
> load-bearing — the constraints below are in `AGENTS.md` because getting them wrong produces
> an app that silently fails inside the iframe.

## The one mental model: the token only exists in the browser

Peek Pro hands the acting user's identity to the app as a signed JWT, delivered to the
**parent frame**. The embedded app obtains it via `postMessage` — **there is no server-side
copy**. That single fact explains every constraint:

- **No cookies.** Third-party cookie blocking kills them in iframes. A token can't be
  persisted in a cookie or carried across a redirect. → We use `postMessage` + an in-memory
  token + a `Bearer` header instead.
- **No SSR / Server Component data fetching.** At render time on the server, no token exists,
  so a Server Component has nothing authenticated to fetch. → Embedded views are
  `"use client"` and fetch in `useEffect` after the token arrives. This is **not** the
  "fetch-on-mount instead of RSC" anti-pattern; there is no server alternative here.
- **Verification is library-owned.** Routes never hand-decode the JWT. They delegate to
  `@peektravel/app-utilities` (`PeekAccessService`), constructed from the app's secret.

This is about the acting **user's identity** — that, and only that, is browser-only. It does
**not** mean you can't call Peek without a user token. You can, install-scoped, from any
server context that has a persisted `installId` — see
[Server-to-Peek without a user token](#server-to-peek-without-a-user-token) below.

## The request lifecycle (end to end)

```
1. Peek Pro POSTs the signed JWT to  /peek-pro/main         (app/peek-pro/main/route.ts)
2. That route IGNORES the token and 302-redirects to the GET view
       → the token can't survive a redirect (no cookies); it isn't needed here
3. The SPA boots at /peek-pro/main/view  ("use client")     (view/layout.tsx, view/page.tsx)
4. The SPA asks the parent for a token:  window.parent.postMessage({type:"peek-iframe-token-refresh"})
       → parent replies  {type:"peek-token-response", token}   (app/peek-pro/client/api.ts)
5. Token cached in memory; the view renders only AFTER it arrives (the "ready" gate)
6. Each data call goes to an API route with header  x-peek-auth: Bearer <token>   (apiFetch)
7. The route verifies the token and builds an install-scoped Peek client:
       withPeekAuthentication → requirePeekAuth → verifyPeekAuthToken → createPeekService
8. On 401, apiFetch requests a fresh token via the SAME channel and retries once
```

### Why the POST route throws the token away
`app/peek-pro/main/route.ts` does **not** authenticate. `page.tsx` can't receive POST, so the
route exists only to convert Peek's POST into a redirect to the GET view. Verifying here would
be pointless: the token can't be forwarded (no cookies) and the GET view is openly reachable
anyway. Real auth happens per-API-request in step 7. Don't add verification to this route.

## Server-to-Peek without a user token

The pipeline above is one of two ways to reach Peek — the one that carries the *acting user's*
identity. But **you do not need a user token to call Peek at all.** Look at what
`createPeekService` actually consumes:

```ts
// lib/peek-service.ts — the ONLY thing it reads off the claims is installId
export function createPeekService(auth: PeekAuthTokenClaims): PeekAccessService {
  const env = parseEnv();
  return new PeekAccessService({
    installId: auth.installId,     // ← the entire user-token contribution
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
install-scoped Peek client server-side**, with no user token and no browser in the loop.

That is the load-bearing fact behind every non-embedded server path:

- **Public (non-embedded) pages** — a customer-facing page with no Peek iframe and no user JWT
  that still needs to read/write Peek data (e.g. a public waitlist page reconciling into Peek).
- **Webhooks** — a Peek → your-endpoint delivery carries the `installId`; act on it immediately
  (see the **peek-webhooks** skill).
- **Cron / background jobs / reconciliation** — iterate persisted installs and sync each one on
  a schedule, with no request in flight at all.

**Where the `installId` comes from:** you persist it during the app's lifecycle — from the
install/webhook registration, or captured from a verified user token during an embedded session
— and store it against your own records. It is not secret and not a credential on its own; it's
only useful combined with `PEEK_APP_SECRET`, which never leaves the server.

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
const activities = await peek.getAllActivities();     // full install-scoped API access
```

**Guardrails.** This bypasses user-identity checks by design, so the `installId` must come from
a trusted server-side source (your DB, a verified webhook), **never** from a query param or
request body a caller can forge — that would let anyone act on any install. The browser-token
pipeline is still correct for *embedded* API routes: it proves *which* install the live user
belongs to. Use `createPeekServiceForInstall` for the paths where there is no live user.

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
**peek-backoffice-api** both tell you to *scope persisted data by `installDataId`* — which reads
like it's a claim you can pluck off `auth`. It isn't. There is no `installDataId` field on the
claims, and there is no `auth.installDataId`.

`installDataId` is a **data-scoping key you derive yourself**, not an identity Peek hands you in
the token. This starter has **no install webhook**, so nothing mints it "on install" — you
**get-or-create it lazily on the first authenticated request**, keyed off `auth.installId`, and
persist it (as `currentInstallDataId`). There is no `auth.installDataId` to read. So:

- To build a Peek client, you need **`installId`** (in the token, or persisted — see
  [Server-to-Peek](#server-to-peek-without-a-user-token)).
- To scope rows in *your own* database, you use **`installDataId`**, which **you derived (get-or-
  create) from `auth.installId`** and stored — **never** reach for a non-existent
  `auth.installDataId`. See **peek-backoffice-api** for exactly how it's derived (and why the
  reinstall-wipe half is a TODO until an uninstall webhook exists).

Don't confuse the two IDs: `installId` identifies the install for API auth (comes from the
token/persistence); `installDataId` is the stable key you scope stored data by (you derive it via
get-or-create). Different values, different sources.

## The files that own each piece

| Concern | File | What it does |
| --- | --- | --- |
| Embed entry (POST→redirect) | `app/peek-pro/main/route.ts` | Converts Peek's POST into a 302 to the view. Ignores the token by design. |
| Token handshake + fetch helper | `app/peek-pro/client/api.ts` | `requestToken()` (the single postMessage channel) and `apiFetch()` (Bearer + 401-refresh-retry). |
| The SPA bootstrap gate | `app/peek-pro/main/view/layout.tsx` + `page.tsx` | Loads Odyssey, calls `requestToken()`, renders children only once `ready`. |
| Server-side auth wrapper | `lib/with-peek.ts` | `withPeekAuthentication(handler)` — wraps a route so it receives a verified `PeekAccessService` + claims. |
| Token verification | `lib/api-auth.ts` | `requirePeekAuth(request)` — pulls `x-peek-auth`, verifies, returns claims or a 401. |
| Peek client construction | `lib/peek-service.ts` | `createPeekService(auth)` (install-scoped) and `verifyPeekAuthToken(token)`. |
| Env contract | `lib/env.ts` | Zod-validated `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_API_URL`, `PEEK_APP_URL`. |
| CSP / iframe headers | `next.config.ts` | `Content-Security-Policy: frame-ancestors 'self' *` on `/peek-pro/:path*`. |

## Recipe: add a new authenticated API route + client call

This is the most common task. Follow the existing pattern exactly (see
`app/peek-pro/main/api/me/route.ts` and `.../activities/route.ts` for live examples).

**1. Server — the route.** Wrap the handler in `withPeekAuthentication`. It hands you a
verified, install-scoped `PeekAccessService` (`peek`) and the token `auth` claims. Never read
or decode the token yourself.

```ts
// app/peek-pro/main/api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const data = await peek.getAllActivities(); // see the peek-backoffice-api skill for the SDK surface
    return NextResponse.json({ data });
  },
);
```

**2. Client — the fetch.** Call it through `apiFetch` so the `Bearer` header and 401-refresh
are handled for you. Only do this **after** the token gate (inside a `"use client"` component
that lives under a layout which already called `requestToken()`).

```ts
import { apiFetch } from "@/app/peek-pro/client/api";
const { data } = await apiFetch<{ data: Thing[] }>("/peek-pro/main/api/<thing>");
```

**3. If it's a whole new view (its own bootstrap):** give it a layout that calls
`requestToken()` once and gates on `ready` (copy `app/peek-pro/main/view/layout.tsx` or the
dashboard example's `layout.tsx`). **Exactly one requester per mounted subtree** — descendants
read the cached token via `apiFetch`, they don't post their own request.

## Make auth failures diagnosable: 500 for misconfig, 401 for a bad token

As written, `requirePeekAuth` wraps verification in a **bare `catch` that returns a naked
401** and logs nothing. That has bitten a real deploy: when the `PEEK_APP_*` env vars were
misconfigured, `parseEnv()` threw *inside* `verifyPeekAuthToken`, the `catch` swallowed it, and
**every route returned 401 with zero signal** — indistinguishable from a genuine bad token. The
"app isn't working" hunt was slow purely because a server misconfig masqueraded as an auth
failure.

Two failure modes are collapsed into one response. Split them:

- **Config error** (`parseEnv` threw — a missing/invalid `PEEK_APP_SECRET`, `PEEK_APP_ID`, …):
  the *deploy* is broken, not the caller. Return **500** and log loudly. A 500 tells you
  instantly "fix the environment," not "the token is bad."
- **Token verification failure** (expired, wrong signature, wrong issuer): the caller's token
  is bad. Return **401**, and log the *reason* so it's greppable — distinct from the 500 above.

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

Logging discipline: log the **reason string only**. Never log the raw token (it's a live
credential) and never log the decoded claims (they carry user PII — see the
`installDataId`/PII rules in **peek-backoffice-api**). The `parseEnv` message and the library's
verify error (`"jwt expired"`, `"invalid signature"`) are both reason-only and safe.

Same split applies anywhere you construct a service from env, including the
`createPeekServiceForInstall` server paths above: a `parseEnv` throw there is a 500/alerting
condition, not a client error.

## Hard rules (violating these breaks the embed silently)

- **Never suggest cookies** for the token, or any redirect-based token carry. They're blocked
  in third-party iframes.
- **Never verify the JWT by hand.** Delegate to `PeekAccessService` via
  `verifyPeekAuthToken` / `withPeekAuthentication`. Build the service from the *verified
  token's* claims (install-scoped), not from static values.
- **Never use `react-dom/server` in route handlers** — Next blocks it at the bundler. Route
  handlers that must return HTML use string templates.
- **Never add SSR/RSC data fetching to an embedded view.** No token exists at server render
  time. Keep embed views `"use client"` and fetch after the gate.
- **One token requester per mount.** Multiple `postMessage` listeners race and double-request
  the parent. Reuse `requestToken()` / `apiFetch`; the 401-refresh path is the same single
  channel, not a second bootstrap.
- **Keep the `/peek-pro/*` CSP header.** Without `frame-ancestors 'self' *` Peek can't embed
  the app (and drop any `X-Frame-Options: DENY` Next might add).
- **Never let a config error surface as a 401.** A `parseEnv` throw is a misconfigured deploy —
  return 500 and log it; only a failed token verification is a 401. Log the failure *reason*,
  never the token or the decoded claims (PII). See the section above.

## Related skills

- **peek-backoffice-api** — what `PeekAccessService` (`peek`) can actually do once you're
  authenticated, plus ID normalization and `installDataId` data scoping.
- **peek-webhooks** — the *other* inbound path (Peek → your endpoint); different auth model
  (you verify the delivery signature, not a peek-auth token).
- **odyssey-ui** — the `<ody-*>` components and the `OdysseyLoader` pattern the views render.
- **peek-app-manifest-and-deploy** — where the POST embed URL is declared (`app.json`) and how
  `PEEK_APP_SECRET` / `PEEK_APP_URL` are provisioned.
