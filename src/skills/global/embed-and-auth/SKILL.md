---
name: embed-and-auth
description: >-
  The host-owned-identity auth model for an app embedded in a platform's back-office surface, and
  how to authenticate every request. Use when adding or changing an authenticated API route, a
  client-side data fetch, the token handshake, the embed entry route, iframe/CSP headers, or when
  debugging 401s, a blank embed, or "token" problems. Explains why the app is a token-gated client
  SPA (no cookies, no SSR data fetching, library-owned verification) and how to reach the platform
  server-side WITHOUT a user token — install/tenant-scoped from a persisted install id — for public
  pages, webhooks, and cron. Triggers on "add an API route", "authenticate a request",
  "iframe won't load", "401 in the embed", "call the platform from a public page",
  "call the platform without a user token", "background/cron access".
---

# Embed & auth — the host owns identity

An app built on this kit runs as a **client-side SPA embedded in the platform's back-office
surface** (typically an iframe). It has no sessions, no cookies, and no server-rendered
authenticated data. Every authenticated request rides a **short-lived, signed identity token** that
the platform hands to the app in the browser. This skill is the map of that model and the recipe
for extending it. **Peek Pro is the canonical example** — its concrete pipeline lives in
`peek-embed-and-auth`.

## The one mental model: the identity token only exists in the browser

The **host** (the platform surface embedding your app) hands the acting user's identity to the app
as a **short-lived signed token, delivered to the browser** — there is **no server-side copy**.
That single fact explains every constraint:

- **No cookies, no redirect-carry.** Third-party cookie blocking kills them in an embedded frame.
  The token can't be persisted in a cookie or carried across a redirect. → The app receives the
  token in the client, holds it **in memory**, and sends it as a `Bearer` header instead.
- **No SSR / server-component data fetching of authed data.** At render time on the server, no
  token exists, so a server component has nothing authenticated to fetch. → Embedded views render
  client-side and fetch **after a token gate**. This is **not** the "fetch-on-mount instead of
  server components" anti-pattern; there is no server alternative here — the token gate, not
  preference, forces client rendering.
- **Verification is library-owned.** Routes never hand-decode the token. They **delegate to the
  platform SDK**, constructed from the app's secret. Never hand-decode or hand-verify.

This is about the acting **user's identity** — that, and only that, is browser-only. It does
**not** mean you can't call the platform without a user token. You can, install/tenant-scoped, from
any server context that has a persisted install id — see
[Server-to-host without a user token](#server-to-host-without-a-user-token) below.

## The request lifecycle (end to end)

```
1. The host delivers the signed identity token to the browser (not to your server).
2. The embedded app boots as a client SPA and OBTAINS the token from the host
       (e.g. the parent frame hands it over on request).
3. The app CACHES the token in memory and renders the view only AFTER it arrives (the "ready" gate).
4. Each data call goes to an API route with the token as a Bearer header.
5. The route VERIFIES the token (library-owned) and builds an install/tenant-scoped platform client.
6. On a 401, the client requests a FRESH token via the SAME channel and RETRIES once.
```

The concrete delivery mechanism (how the host posts the token, the message names, the header name,
the entry route that converts the host's POST into the client view) is platform + stack specific —
see `peek-embed-and-auth` for the canonical `postMessage`/JWT pipeline and `javascript-nextjs` for
the route-handler / client-SPA mechanics.

> **Why the embed entry route often throws the token away.** The host may deliver the token to a
> POST entry route, but that route typically can't render the SPA and the token can't survive a
> redirect (no cookies) — so the entry route just converts the host's POST into the client view and
> does **not** authenticate. Real auth happens per-API-request (step 5). Don't add verification to
> the entry route.

## Server-to-host without a user token

The pipeline above is one of two ways to reach the platform — the one that carries the *acting
user's* identity. But **you do not need a user token to call the platform at all.**

The platform SDK client mints its own API credentials from **an install/tenant identifier + the
app secret**. The user identity token is *not* a platform API credential — it's just how the
browser tells the server *which install is acting*. So **any install/tenant id you have persisted
lets you build a fully functional, scoped platform client server-side**, with no user token and no
browser in the loop.

That is the load-bearing fact behind every non-embedded server path:

- **Public (non-embedded) pages** — a customer-facing page with no embed and no user token that
  still needs to read/write platform data (e.g. a public waitlist page reconciling into the
  platform).
- **Webhooks** — a platform → your-endpoint delivery carries the install id; act on it immediately
  (see `webhooks`).
- **Cron / background jobs / reconciliation** — iterate persisted installs and sync each on a
  schedule, with no request in flight at all.

**Where the install id comes from:** you persist it during the app's lifecycle — from an
install/webhook registration, or captured from a verified user token during an embedded session —
and store it against your own records. It is not secret and not a credential on its own; it's only
useful combined with the app secret, which never leaves the server.

**Guardrail.** This bypasses user-identity checks by design, so the install/tenant id must come
from a **trusted server-side source** (your DB, a verified webhook) — **never** from a query param
or request body a caller can forge, which would let anyone act on any install. The browser-token
pipeline is still correct for *embedded* API routes: it proves *which* install the live user
belongs to. Use the install-scoped path only where there is no live user. See `peek-backoffice-api`
for the canonical `createPeekServiceForInstall` recipe.

## Two IDs, two jobs — don't conflate them

There are two distinct identifiers, and mixing them causes real bugs:

- **An install/tenant identifier** — identifies the install for **API auth**. It comes from the
  verified token (or from your persistence, for the server-to-host paths above). This is the *only*
  thing you build the platform client from.
- **A data-scoping key** — the stable key you scope **your own stored data** by. On most platforms
  this is **not** something the token hands you: you **derive it (get-or-create) from the install
  identifier** and persist it, so that a reinstall doesn't inherit stale data. Don't reach for it as
  if it were a token claim.

Different values, different sources. Build the platform client from the install identifier; scope
your storage by the derived data-scoping key. See `backoffice-data` for how the data-scoping key is
derived and why keying storage on a raw install id is a trap.

## Make auth failures diagnosable: 500 for misconfig, 401 for a bad token

The most dangerous auth bug is collapsing **two different failure modes into one response**. It has
bitten a real deploy: when the app's secret/config env vars were misconfigured, config parsing threw
*inside* token verification, a bare `catch` swallowed it, and **every route returned a naked 401 with
zero signal** — indistinguishable from a genuine bad token. The "app isn't working" hunt was slow
purely because a server misconfig masqueraded as an auth failure. Split them:

- **Config / secret error** (env parsing threw — a missing/invalid app secret, app id, …): the
  *deploy* is broken, not the caller. Return **500** and log loudly. A 500 tells you instantly "fix
  the environment," not "the token is bad." Do this **outside** the verify try/catch so a config
  throw can't be laundered into a 401.
- **Token verification failure** (expired, wrong signature, wrong issuer): the caller's token is
  bad. Return **401**, and log the *reason* so it's greppable — distinct from the 500 above.

The same split applies **anywhere** you construct a client from env, including the server-to-host
paths (a config throw there is a 500/alerting condition, not a client error).

**Logging discipline:** log the **reason string only**. Never log the raw token (it's a live
credential) and never log the decoded claims (they carry user PII). The config-parse message
(naming the offending var, not its value) and the library's verify error (`"jwt expired"`,
`"invalid signature"`) are both reason-only and safe. See `peek-embed-and-auth` for the concrete
implementation.

## Hard rules (violating these breaks the embed silently)

- **Never suggest cookies** for the token, or any redirect-based token carry. They're blocked in
  third-party embedded frames.
- **Never verify the token by hand.** Delegate to the platform SDK. Build the client from the
  *verified token's* claims (install-scoped), not from static values.
- **Never add SSR/server-component data fetching to an embedded view.** No token exists at server
  render time. Keep embed views client-rendered and fetch after the gate.
- **One token requester per mounted subtree.** Multiple listeners race and double-request the host.
  Reuse one shared channel; the 401-refresh path is the *same* single channel, not a second
  bootstrap.
- **Keep the embed's frame-ancestors/CSP headers** so the platform can embed the app (and drop any
  `X-Frame-Options: DENY` the framework might add). The concrete header is stack-specific — see
  `javascript-nextjs`.
- **Never let a config error surface as a 401.** A config/secret parse throw is a misconfigured
  deploy — return 500 and log it; only a failed token verification is a 401. Log the failure
  *reason*, never the token or the decoded claims (PII).
- **The install/tenant id for server-side calls must come from a trusted server source** — never a
  forgeable request param.

## Related skills

- `peek-embed-and-auth` — the canonical concrete pipeline: the peek-auth JWT, the `postMessage`
  handshake, the POST→redirect→SPA entry route, `PeekAccessService`, and the exact token claims.
- `javascript-nextjs` — the stack mechanics: the route handler, the client SPA and token gate, and
  the iframe/CSP config.
- `backoffice-data` — what the authenticated client can do once you have it, plus ID normalization,
  the derived per-install data-scoping key, and PII rules.
- `webhooks` — the *other* inbound path (platform → your endpoint); different auth model (you verify
  the delivery signature, not a user token).
- `manifest-and-deploy` — where the embed URL is declared and how the app secret is provisioned.
