---
name: peek-webhooks
description: >-
  How to receive and handle Peek Pro webhooks (booking, waiver, and install/uninstall lifecycle
  events) in a starter-kit app — the concrete Peek delivery, registration/config split, and parsers.
  Use when adding an endpoint that reacts to something happening in Peek — a booking
  created/changed/cancelled, a waiver signed — or handling the install-status webhook that tells the
  app who an install belongs to. Covers the registry/config split, parsing with parseBookingWebhook /
  parseWaiverWebhook, verifying-and-merging the install delivery with parseInstallWebhook (signed JWT
  + JSON body), verifying the delivery yourself, install-identity persistence, and Peek's
  "booking events carry state, not change" specifics. Always pull the live webhook doc first — the
  config/query/parser signatures change. Triggers on "Peek webhook", "booking event", "waiver event",
  "install webhook", "install-status", "parseBookingWebhook", "parseWaiverWebhook", "parseInstallWebhook",
  "handle a booking", "react to a booking", "waiver signed", "who is this install".
---

# Peek Pro webhooks — receiving events

This is the **concrete Peek inbound path**. The generic model — verify the delivery yourself, be
idempotent, and the critical "events carry state, not change" discipline — lives in `webhooks`.
Read that for the *why*; **don't re-derive idempotency / state-not-change philosophy here**. This
skill is the authoritative *how Peek delivers events*.

Webhooks are Peek → your endpoint, "something happened." This is a **different auth model** from
the peek-auth API pipeline — here *you* verify the delivery came from Peek; there is no peek-auth
token (contrast `peek-embed-and-auth`).

> **What's scaffolded vs. not.** The kit **does** ship one webhook endpoint — the **install-status**
> handler at `app/examples/webhooks/install-status/route.ts` (declared in `app.peek.json`), which
> verifies + logs install/uninstall deliveries. The **booking and waiver** endpoints are **not**
> scaffolded — this skill is how you add them, as Next.js Route Handlers under
> `app/examples/peek-pro/` (JSON/string responses only, no `react-dom/server` — see
> `javascript-nextjs`).

## Always pull the live webhook doc first

The exact config (the booking GraphQL query string, app-config field names, the precise parser
signatures) **changes over time — do not rely on memory or hard-code it.** Before configuring or
implementing, fetch and read:

```
https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/docs/webhooks.md
```

That doc (and the package's types — see `javascript-app-utilities`) is the source of truth for
concrete config + parser APIs. Use this skill for the stable shape and the Peek caveats. If the
package doc/types don't pin something (e.g. the signature scheme), `TODO(verify)` it and check the
live web doc — don't guess.

## What's available today

Three webhook helpers in the package: **booking events** (`parseBookingWebhook`), **waiver events**
(`parseWaiverWebhook`), and the **install/uninstall lifecycle** (`parseInstallWebhook`, which verifies
the signed `app_registry_v2` JWT and merges it with the JSON body into one flat `InstallWebhook`).
Booking/waiver are covered below; the install lifecycle has its own section further down.

## The wiring has two halves that must agree

1. **Registration (external, one-time — app config / the registry).** You declare the webhook,
   its target endpoint URL, and its **payload spec** in the app's configuration (see
   `peek-manifest-and-deploy`). For **bookings** the spec is a **GraphQL field selection** that
   shapes the payload; for **waivers** it's a **fixed format** (no query). The exact config keys
   and the canonical booking query string live in the **live doc** — pull them, don't bake.
   (`TODO(verify)` full registry docs.)
2. **Endpoint (you implement it).** Peek POSTs the event to a route your app exposes.
3. **Parsing (in your handler, via the npm package).** Transform the delivery with the package's
   **pure parser functions** rather than reading raw JSON. Confirm exact names in the live doc;
   conceptually `parseBookingWebhook(body) → Booking` and `parseWaiverWebhook(body) → Waiver`.
   They're pure transforms — **no auth, no network.**

### Endpoint rules (every webhook)

- **Authenticating the delivery is YOUR responsibility.** The parsers do **not** verify the
  request came from Peek — verify the delivery signature yourself before trusting the payload.
  Check the package `docs/webhooks.md` + types for the scheme + header name; `TODO(verify)` the
  algorithm (and confirm against the live doc) if the package doesn't pin it.
- **Parsers never throw on malformed input** — they yield **empty fields** instead of errors. A
  bad delivery won't crash you, but you **must validate the fields you depend on.**
- **Parsers accept multiple envelope shapes** — the `{ booking: … }` / `{ waiver: … }` envelope,
  a bare node, or a JSON-string body. Pass the body through; don't pre-shape it.
- **Acknowledge fast, process safely, be idempotent** — assume at-least-once delivery (the
  generic discipline is in `webhooks`).
- **Scope any stored data to `installDataId`**, keyed on the stable IDs below. To *act* on an
  event, build an install-scoped client with `createPeekServiceForInstall(installId)` — see
  `peek-backoffice-api` and `peek-embed-and-auth`.

## Booking events

### The payload is shaped by a registered GraphQL query
When you register the booking webhook you provide a GraphQL field selection Peek runs to build the
payload. Because it's complex and the shape isn't fixed, registration and parsing must agree:
**use the canonical/standard booking query the npm package supplies** (don't hand-write it — the
exact string is volatile, get it from the live doc) and **parse with `parseBookingWebhook`**,
which auto-detects guests and the price breakdown.

### The critical caveat: events carry state, not change
**The booking webhook fires on both create *and* update, delivering the *same* payload shape, and
the parser handles them identically — it does not tell you which event fired.** The event carries
only the booking's **current state**, no diff, no event type. So from one event you can't tell if
the booking was created, cancelled, rescheduled, or edited. Derive meaning by tracking state
yourself (the general technique is in `webhooks`; the Peek specifics):

- **Act only on *new* bookings:** keep a store of booking IDs you've already seen; if seen,
  ignore; if not, it's new.
- **Detect a *specific* change (e.g. a reschedule):** store the old value of the field(s) you care
  about and compare the incoming value each event. (Check the package types / `docs/` for exact
  field paths.)

### Stable keys
The **booking ID and order ID never change** — use them as keys for stores/caches/lookups,
combined with `installDataId` scoping. **Normalize every ID first** to the internal `b_123abc` /
`o_123abc` form (lowercase, `-`→`_`) so keys match. See `peek-backoffice-api`.

## Waiver events

Fires when a **waiver agreement signature is created** (`agreement_signature_created`).

- **Fixed payload — no GraphQL query to register.** The shape is predefined by Peek.
- **Parse with `parseWaiverWebhook`** — pure transform, never throws on bad input.
- Apply the same endpoint rules (you verify the delivery, ack fast, idempotent, scope to
  `installDataId`). For new-vs-seen logic use the same seen-before pattern on a stable identifier
  (check the package types / `docs/` for the waiver's ID field; a referenced booking's
  booking/order IDs stay stable).

## Install / uninstall lifecycle webhook

Separate from booking/waiver, Peek's app registry fires an **install lifecycle webhook** on
install / uninstall / update. **This kit scaffolds it** — `app/examples/webhooks/install-status/route.ts`
(declared in `app.peek.json`), today verifying + logging the delivery. It is the **only** place the
app learns **who an install belongs to** (the account behind it); no back-office read and no
peek-auth token returns the account id, so what you persist here is all you get. The generic model,
the wire format, and the identity-persistence rules live in `webhooks` — read them; don't re-derive
here.

**The delivery carries two payloads at once** — a signed `app_registry_v2` JWT and a plain JSON body.
One helper handles both:

- **`parseInstallWebhook(token, body, secret)` → `InstallWebhook`** — verifies the token
  (signature / `app_registry_v2` issuer / `Joken` audience / expiry — pass the app's `jwtSecret`) and
  reads the event from the body, **falling back to the token** for the fields it also carries. It
  **throws on verification failure**, so a bad delivery is a single `try/catch` → `401`; you no longer
  hand-roll JWT verification. **Trust model:** a valid token authenticates the *whole* delivery, so the
  **body is the source of event data** and is trusted within a verified request; the token backs up
  `installId` / `accountId` / `status` / `displayVersion` / `user` when the body omits them. The
  scaffolded endpoint reads the JWT from the `x-peek-auth` header and passes it + the raw body to
  `parseInstallWebhook`.

> **0.7.x helper.** `parseInstallEvent` was **removed** and `verifyInstallWebhook` is **deprecated**
> (token-only); the return is flat (`event.accountId`, not `event.identity.accountId`). Use
> `parseInstallWebhook`.

**Fail loud on an unknown `status` or `platform`.** Both come back `null` when this SDK version
doesn't recognize the wire value (kept on `rawStatus`); give each a `default:` branch that returns a
`500` so Peek redelivers. A 2xx is treated as delivered and **not** redelivered, so coercing an
unknown `status` silently drops a lifecycle transition and defaulting an unknown `platform` points
the install at the wrong gateway.

**What to persist** (full model in `webhooks`): key **account-permanent data on `accountId`/partnerId**
(consistent across installs, never changes); treat **`installId`** as the handle for a specific install
that **may change**; mint an **`installDataId`** to scope working data so a fresh reinstall wipes
cleanly; **persist `platform`** (selects the access service), **`timezone`** (the account's own zone),
**`accountName`** (debugging), and — critically — **`apiUrl`: the per-install back-office endpoint
(`api.url`). Persist it and build this install's `PeekAccessService` against it (as given), never a
hardcoded URL.** **Every event is a full snapshot: upsert by `installId` and overwrite** — an
`update_installed` can deliver a new `apiUrl`, and a stale one calls the wrong endpoint.
`installId`/`accountId`/`accountName`/`platform`/`isTest` always arrive → non-nullable columns;
`apiUrl`/`timezone` may be `""` on a delivery, so keep the last stored value. To build the client from a
stored install, `createAccessServiceForInstall({ platform, apiUrl, installId }, { jwtSecret, issuer })`
wires the URL for you — see `peek-backoffice-api`.

## Related skills

- **`webhooks`** (global) — the generic delivery-verification, idempotency, and "events carry
  state, not change" model behind this skill (don't re-explain it here).
- **`peek-backoffice-api`** — ID normalization + `installDataId` scoping (shared with webhooks),
  and the SDK client (`createPeekServiceForInstall`) to *act* on what an event tells you.
- **`javascript-nextjs`** (stack) — the route-handler rules (JSON only, no `react-dom/server`) for
  the endpoint you build.
- **`peek-embed-and-auth`** — the *other* inbound path (peek-auth token API); contrast the auth
  models so you don't confuse them.
- **`peek-manifest-and-deploy`** — where the webhook endpoint URL + registration is declared.
