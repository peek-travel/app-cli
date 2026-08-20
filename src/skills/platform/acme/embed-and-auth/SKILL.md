---
name: acme-embed-and-auth
description: >-
  The concrete ACME embed + auth wiring — how a starter-kit app embeds inside the ACME iframe and
  authenticates every request with the brand-agnostic peek-auth JWT. Use when adding or changing an
  authenticated ACME API route, the token handshake, the embed entry route, or when debugging 401s
  / a blank iframe. Covers the shared POST → redirect → SPA → postMessage-token → Bearer-API
  pipeline, withAppAuthentication and the platform-claim branch that picks the ACME accessor,
  createAcmeService (no gatewayKey/mode), and calling ACME server-side with no user token. Triggers
  on "acme auth", "acme embed", "authenticate an acme request", "withAppAuthentication",
  "createAcmeService", "auth.user.platform", "401 in the acme embed", "call acme without a user token".
---

# ACME embed & auth pipeline

This is the **concrete ACME mechanism** for host-owned identity. The generic model — the host owns
identity, verify server-side, never build your own login, scope to an install — lives in
`embed-and-auth`; read that for the *why*. This skill is the authoritative map of *how ACME does it*.

## The one fact: the token is brand-agnostic; the `platform` claim picks the gateway

ACME hands the acting user's identity to the app as the **same signed peek-auth JWT** used on every
platform — there is **one token format for peek, cng, and acme**. It's delivered to the parent
frame and obtained via `postMessage`; **there is no server-side copy.** Verification is identical
across platforms; the single thing that tells you the request came from ACME is the token's
**`user.platform` claim** (`"peek" | "cng" | "acme"`).

That is why the auth pipeline is **unified**, not per-brand: you verify once, then build the
accessor that matches the claim. For ACME that accessor is an `AcmeAccessService`.

## The request lifecycle (end to end)

Structurally identical to every platform's embed — only the route prefix differs:

```
1. ACME POSTs the signed peek-auth JWT to  /examples/acme/main       (app/examples/acme/main/route.ts)
2. That route IGNORES the token and 302-redirects to the GET view
       → the token can't survive a redirect (no cookies); it isn't needed here
3. The SPA boots at /examples/acme/main/view  ("use client")         (view/layout.tsx, view/page.tsx)
4. The SPA asks the parent for a token:  postMessage({type:"peek-iframe-token-refresh"})
       → parent replies  {type:"peek-token-response", token}         (lib/app-client/api.ts)
5. Token cached in memory; the view renders only AFTER it arrives (the "ready" gate)
6. Each data call goes to an ACME API route with header  x-peek-auth: Bearer <token>   (apiFetch)
7. The route verifies the token and builds an install-scoped ACME client:
       withAppAuthentication → requirePeekAuth → verifyPeekAuthToken → createAppService → createAcmeService
8. On 401, apiFetch requests a fresh token via the SAME channel and retries once
```

The two message types are **not** renamed per brand — they are `peek-iframe-token-refresh` (SPA →
parent) and `peek-token-response` (parent → SPA) on ACME too. The POST route throws the token away
for the same reason it does on Peek (can't forward it through a redirect; the GET view is openly
reachable; real auth is per-API-request in step 7). Don't add verification to the POST route.

## `withAppAuthentication` — verify once, branch on the platform claim

The unified wrapper lives in `lib/with-app.ts`. It verifies the brand-agnostic token, then
`createAppService` (`lib/app-service.ts`) factories the accessor matching `auth.user.platform`:

```ts
// lib/app-service.ts (excerpt) — the branch that picks the gateway
switch (auth.user?.platform) {          // user — and platform — can be null; see below
  case "peek": return createPeekService(auth);
  case "cng":  return createCngService(auth);
  case "acme": return createAcmeService(auth);   // ← acme lands here
  default:     throw new Error(`No app service for platform: ${auth.user?.platform ?? "none"}`);
}
```

As of 0.7.x the token's **`user` block — and every field on it, including `platform` — is
nullable** (a valid session token needn't name a user, and unknown values normalize to `null`). So
guard `auth.user?.platform` and **fail loud in `default`** rather than assuming a platform.

A route lives under exactly one platform's tree, so it already **knows** which accessor it gets —
name the concrete type at the call site and skip runtime narrowing:

```ts
export const GET = withAppAuthentication<AcmeAccessService>(
  async (_request, acme) => { /* acme is an AcmeAccessService */ },
);
```

(Omit the type argument to receive the `AppAccessService` union and inspect it yourself.)

## `createAcmeService` — no `gatewayKey`, no `mode`

Building the ACME client is **simpler than Peek's**. `AcmeAccessService`'s config is the shared base
only — it authenticates on the app JWT alone (`X-Peek-Auth: Bearer`), with **no `pk-api-key`
header**, so there is **no `gatewayKey` and no `mode`**:

```ts
// lib/acme-service.ts
export function createAcmeService(auth: PeekAuthTokenClaims): AcmeAccessService {
  const env = parseEnv();
  return new AcmeAccessService({
    installId: auth.installId,      // ← the entire user-token contribution
    jwtSecret: env.PEEK_APP_SECRET, // ← everything else is your app's own secret/config
    issuer: env.PEEK_APP_ID,
    appId: env.PEEK_APP_ID,
    baseUrl: env.PEEK_API_URL,
  });
}
```

## What's in the token — and what isn't (`installDataId`)

The verified claims are exactly `PeekAuthTokenClaims` (shared across platforms):

```ts
type PeekAuthTokenClaims = {
  installId: string;        // which install is acting — the ONLY field you build the service from
  displayVersion: string;
  user: {                   // ← nullable as a whole, and every field is nullable
    platform: "peek" | "cng" | "acme" | null;   // may be null — branch with a fail-loud default
    // + email / id / isAdmin / locale / name — all `| null`; PII, don't log
  } | null;
};
```

**`user.id` is the signed-in person's own user id — NOT the account/partner id.** Never key
account-scoped data on it; the account id (`accountId` / partnerId) has only one source, the install
webhook (see `webhooks` / `acme-backoffice-api`).

**`installDataId` is NOT in the token.** It's a data-scoping key you derive yourself (get-or-create
lazily on the first authenticated request, keyed off `auth.installId`) — see `acme-backoffice-api`.
To build an ACME client you need **`installId`**; to scope rows in your own DB you use the derived
**`installDataId`**.

## Server-to-ACME without a user token

`createAcmeService` reads only `installId` off the claims — everything else is your app's own
secret/config, and `AcmeAccessService` **mints its own API tokens** from `installId` +
`PEEK_APP_SECRET`. So **a persisted install (its `installId` + `apiUrl`) lets you build a fully
functional, install-scoped ACME client server-side**, with no user token and no browser in the loop.
Add a sibling that takes the `installId` **and the install's persisted `apiUrl`** (the per-install
endpoint from the install webhook — `api.url`):

```ts
export function createAcmeServiceForInstall(installId: string, apiUrl: string): AcmeAccessService {
  const env = parseEnv();
  return new AcmeAccessService({
    installId, apiUrl, jwtSecret: env.PEEK_APP_SECRET, issuer: env.PEEK_APP_ID,
  });
}
```

Or use the SDK factory: `createAccessServiceForInstall({ platform, apiUrl, installId }, { jwtSecret,
issuer })`. **Use the install's own `apiUrl`, not a hardcoded endpoint** — the config's
`baseUrl`/`appId`/`mode` are **deprecated** and the hardcoded fallback will be removed (see
`acme-backoffice-api`). *(Until this starter has a DB it falls back to the app-level `PEEK_API_URL`;
wire the per-install `apiUrl` in once you persist installs.)*

**Guardrail:** `installId`/`apiUrl` must come from a trusted server-side source (your DB, a verified
webhook — see `acme-webhooks`), **never** from a query param or request body a caller can forge.
Use this for webhooks, cron/background jobs, and non-embedded pages.

## The files that own each piece

| Concern | File | What it does |
| --- | --- | --- |
| Embed entry (POST→redirect) | `app/examples/acme/main/route.ts` | Converts ACME's POST into a 302 to the view. Ignores the token by design. |
| Token handshake + fetch helper | `lib/app-client/api.ts` | `requestToken()` (the single `peek-iframe-token-refresh` channel) and `apiFetch()` (Bearer + 401-refresh-retry). |
| The SPA bootstrap gate | `app/examples/acme/main/view/layout.tsx` + `page.tsx` | Loads Odyssey, calls `requestToken()`, renders children only once `ready`. |
| Unified server-side auth wrapper | `lib/with-app.ts` | `withAppAuthentication<T>(handler)` — verify once, branch on `platform`, hand the route its accessor. |
| Token verification | `lib/api-auth.ts` | `requirePeekAuth(request)` — pulls `x-peek-auth`, verifies, returns claims or 401. |
| ACME client construction | `lib/acme-service.ts` | `createAcmeService(auth)` (add `createAcmeServiceForInstall` for server paths). |
| Platform branch | `lib/app-service.ts` | `createAppService(auth)` — maps `auth.user.platform` → the right accessor. |
| Env contract | `lib/env.ts` | Zod-validated `PEEK_APP_SECRET`, `PEEK_APP_ID`, `PEEK_API_URL`, `PEEK_APP_URL` (see `acme-manifest-and-deploy`). |
| CSP / iframe headers | `next.config.ts` | `frame-ancestors` set so ACME can embed the app. |

## Recipe: add a new authenticated ACME API route + client call

**1. Server — the route.** Wrap the handler in `withAppAuthentication<AcmeAccessService>`; it hands
you the verified, install-scoped `acme` client. Never read or decode the token yourself.

```ts
export const GET = withAppAuthentication<AcmeAccessService>(
  async (_request: NextRequest, acme: AcmeAccessService) => {
    const activities = await acme.getAllActivities(); // SDK surface → acme-backoffice-api
    return NextResponse.json({ activities });
  },
);
```

**2. Client — the fetch.** Call it through `apiFetch` (Bearer header + 401-refresh handled), only
after the token gate (inside a `"use client"` component under a layout that already called
`requestToken()`):

```ts
const { activities } = await apiFetch<{ activities: Activity[] }>("/examples/acme/main/api/<thing>");
```

## Make auth failures diagnosable: 500 for misconfig, 401 for a bad token

As written, `requirePeekAuth` wraps verification in a **bare `catch` that returns a naked 401**. If
the `PEEK_APP_*` env vars are misconfigured, `parseEnv()` throws *inside* verification and gets
laundered into a 401 — indistinguishable from a genuine bad token, with zero signal. Split the two
failure modes: a **config error** (parseEnv threw) is a broken deploy → **500 + loud log**; a
**token verification failure** (expired/wrong signature/wrong issuer) is the caller's → **401 + log
the reason only**. Never log the raw token or the decoded claims (user PII). See
`peek-embed-and-auth` for the full recommended `requirePeekAuth` split — it applies verbatim here.

## Hard rules (violating these breaks the embed silently)

- **Never suggest cookies** for the token, or any redirect-based token carry. Blocked in
  third-party iframes.
- **Never verify the peek-auth JWT by hand.** Delegate to the library
  (`verifyPeekAuthToken` / `withAppAuthentication`). Build the service from the *verified token's*
  claims (install-scoped), not from static values.
- **One token requester per mount.** Multiple `postMessage` listeners race. Reuse
  `requestToken()` / `apiFetch`; the 401-refresh path is the same single channel.
- **Keep the ACME CSP header** so ACME can embed the app.
- **Never let a config error surface as a 401** — misconfig is a 500.
- **No SSR data fetch, no `react-dom/server` in route handlers** — see `javascript-nextjs`.

## Related skills

- **`embed-and-auth`** (global) — the generic host-owned-identity model and the *why*.
- **`javascript-nextjs`** (stack) — the route-handler / `"use client"` SPA mechanics.
- **`javascript-app-utilities`** (stack) — where `AcmeAccessService` / `verifyPeekAuthToken` come
  from, and how to introspect the installed package.
- **`acme-backoffice-api`** — what `AcmeAccessService` (`acme`) can do once authenticated, plus
  `installDataId` scoping and the REST-only capability ceiling.
- **`acme-webhooks`** — the *other* inbound path (ACME → your endpoint); you verify the delivery
  yourself (and it tolerates a `user: null` system event).
- **`acme-manifest-and-deploy`** — where the POST embed URL is declared (`app.acme.json`) and how
  `PEEK_APP_SECRET` / `PEEK_APP_URL` are provisioned.
- **`peek-embed-and-auth`** — the same pipeline on Peek (which adds `gatewayKey`/`mode`); contrast
  to see what ACME drops.
