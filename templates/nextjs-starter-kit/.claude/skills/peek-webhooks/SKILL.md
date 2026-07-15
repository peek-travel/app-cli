---
name: peek-webhooks
description: >-
  How to receive and handle Peek Pro webhooks (booking events and waiver events) in this
  starter kit. Use when adding an endpoint that reacts to something happening in Peek — a
  booking created/changed/cancelled, a waiver signed — for waitlist, abandoned-booking,
  dynamic-pricing, or sync features. Covers the registry/config split, parsing with
  parseBookingWebhook / parseWaiverWebhook, verifying the delivery yourself, idempotency, and
  the critical "events carry state, not change" caveat. Triggers on "Peek webhook", "booking
  event", "waiver event", "parseBookingWebhook", "handle a booking", "react to a booking".
---

# Peek Pro webhooks — receiving events

Webhooks are the **inbound** path: Peek → your endpoint, "something happened." Reactive
features (waitlist, abandoned bookings, dynamic pricing, sync) depend on them. This is a
**different auth model** from the peek-auth API pipeline — here *you* verify the delivery came
from Peek; there is no peek-auth token.

> **Not yet scaffolded.** Phase 0 of this starter kit ships no webhook endpoint. This skill is
> how you add one. Follow the existing route conventions under `app/peek-pro/`.

## Always pull the live webhook doc first

The exact config (the booking GraphQL query string, app-config field names, the precise parser
signatures) **changes over time — do not rely on memory or hard-code it.** Before configuring
or implementing, fetch and read:

```
https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/docs/webhooks.md
```

That doc (and the package's types, `@peektravel/app-utilities/dist/index.d.ts`) is the source of
truth for concrete config + parser APIs. Use this skill for the stable shape and the caveats. If
the package doc/types don't pin something (e.g. the signature scheme), `TODO(verify)` it and
check the live web doc — don't guess.

## What's available today

Two webhooks: **booking events** and **waiver events**.

## The wiring has two halves that must agree

1. **Registration (external, one-time — app config / the registry).** You declare the webhook,
   its target endpoint URL, and its **payload spec** in the app's configuration. For **bookings**
   the spec is a **GraphQL field selection** that shapes the payload; for **waivers** it's a
   **fixed format** (no query). The exact config keys and the canonical booking query string
   live in the **live doc** — pull them, don't bake. (`TODO(verify)` full registry docs.)
2. **Endpoint (you implement it).** Peek POSTs the event to a route your app exposes — build it
   as a Next.js Route Handler under `app/peek-pro/` (string/JSON responses only; per AGENTS.md,
   never `react-dom/server` in route handlers).
3. **Parsing (in your handler, via the npm package).** Transform the delivery with the
   package's **pure parser functions** rather than reading raw JSON. Confirm exact names in the
   live doc; conceptually `parseBookingWebhook(body) → Booking` and
   `parseWaiverWebhook(body) → Waiver`. They're pure transforms — **no auth, no network.**

### Endpoint rules (every webhook)

- **Authenticating the delivery is YOUR responsibility.** The parsers do **not** verify the
  request came from Peek — verify the signature yourself before trusting the payload.
  Check the package `docs/webhooks.md` + types for the scheme + header name; `TODO(verify)` the
  algorithm (and confirm against the live doc) if the package doesn't pin it.
- **Parsers never throw on malformed input** — they yield **empty fields** instead of errors.
  A bad delivery won't crash you, but you **must validate the fields you depend on**.
- **Parsers accept multiple shapes** — the `{ booking: … }` / `{ waiver: … }` envelope, a bare
  node, or a JSON-string body. Pass the body through; don't pre-shape it.
- **Acknowledge fast, process safely, be idempotent.** Assume at-least-once delivery and
  possible redelivery.
- **Scope any stored data to `installDataId`**, keyed on the stable IDs below. See
  `peek-backoffice-api`.

## Booking events

### The payload is shaped by a registered GraphQL query
When you register the booking webhook you provide a GraphQL field selection Peek runs to build
the payload. Because it's complex and the shape isn't fixed, registration and parsing must
agree: **use the canonical/standard booking query the npm package supplies** (don't hand-write
it — the exact string is volatile, get it from the live doc) and **parse with
`parseBookingWebhook`**, which auto-detects guests and the price breakdown.

### The critical caveat: events carry state, not change
**The booking webhook fires on both create *and* update, delivering the *same* payload shape,
and the parser handles them identically — it does not tell you which event fired.** The event
carries only the booking's **current state**, no diff, no event type. So from one event you
can't tell if the booking was created, cancelled, rescheduled, or edited. Derive meaning by
tracking state yourself:

- **Act only on *new* bookings:** keep a store of booking IDs you've already seen; if seen,
  ignore; if not, it's new.
- **Detect a *specific* change (e.g. a reschedule):** store the old value of the field(s) you
  care about and compare the incoming value each event. (Check the package types / `docs/` for
  exact field paths.)

### Stable keys
The **booking ID and order ID never change** — use them as keys for stores/caches/lookups,
combined with `installDataId` scoping. **Normalize every ID first** to the internal
`b_123abc` / `o_123abc` form (lowercase, `-`→`_`) so keys match. See `peek-backoffice-api`.

## Waiver events

Fires when a **waiver agreement signature is created** (`agreement_signature_created`).

- **Fixed payload — no GraphQL query to register.** The shape is predefined by Peek.
- **Parse with `parseWaiverWebhook`** — pure transform, never throws on bad input.
- Apply the same endpoint rules (you verify the delivery, ack fast, idempotent, scope to
  `installDataId`). For new-vs-seen logic use the same seen-before pattern on a stable
  identifier (check the package types / `docs/` for the waiver's ID field; a referenced booking's
  booking/order IDs stay stable).

## Related skills

- **peek-backoffice-api** — ID normalization + `installDataId` scoping (shared with webhooks);
  and the SDK to *act* on what an event tells you.
- **peek-embed-and-auth** — the *other* inbound path (peek-auth token API); contrast the auth
  models so you don't confuse them.
- **peek-app-manifest-and-deploy** — where the webhook endpoint URL is declared for the app.
