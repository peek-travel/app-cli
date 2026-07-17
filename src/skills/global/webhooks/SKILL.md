---
name: webhooks
description: >-
  The inbound-events model for an app built on this kit — receiving and handling platform webhooks
  (something happened: a booking created/changed/cancelled, a waiver signed, etc.). Use when adding
  an endpoint that reacts to a platform event for waitlist, abandoned-booking, dynamic-pricing, or
  sync features. Covers the registration/endpoint split, verifying the delivery yourself,
  validating fields, idempotency, and the critical "events carry state, not change" caveat.
  Triggers on "webhook", "platform event", "booking event", "react to a booking", "handle an event",
  "verify a webhook", "webhook idempotency".
---

# Webhooks — receiving platform events

Webhooks are the **inbound** path: platform → your endpoint, "something happened." Reactive
features (waitlist, abandoned bookings, dynamic pricing, sync) depend on them. This is a
**different auth model** from the embedded API pipeline — here *you* verify the delivery came from
the platform; there is no user identity token. **Peek Pro is the canonical example** — its concrete
events (booking, waiver) and parsers live in `peek-webhooks`.

## Always pull the live event doc first

The exact config (payload spec, field names, parser signatures, the signature scheme) **changes
over time — do not rely on memory or hard-code it.** Before configuring or implementing, read the
installed SDK package's types + shipped `docs/` for the selected platform, and pull the live web
doc for anything the package doesn't pin. Mark `TODO(verify)` for anything you can't confirm — don't
guess. See `peek-webhooks` for where the canonical platform's event docs live.

## Two halves that must agree

1. **Registration (external — the platform's config / registry).** You declare the webhook, its
   **target endpoint URL**, and its **payload spec** in the app's manifest via a webhook extension —
   the install/uninstall `app_registry_webhook@v1` and/or a booking-event `webhook_on_…` extension.
   The payload spec can be a fixed format or, for richer events, a field selection you provide that
   shapes the delivery. Registration and your parsing **must agree** on the shape. The exact config
   keys live in the platform's live doc — pull them, don't bake. Enumerate the available webhook
   extensions and read each one's required config with the CLI (`extensions list` / `extensions
   show <slug>` — see `cli`); see `manifest-and-deploy` for where the endpoint URL is declared.
2. **The endpoint (you implement it).** The platform POSTs the event to a route your app exposes.
   Build it following your stack's route conventions (see `javascript-nextjs`), and parse the
   delivery with the platform SDK's parser functions rather than reading raw JSON where the platform
   provides them (they're pure transforms — no auth, no network).

## Endpoint rules (every webhook)

- **YOU authenticate the delivery.** The platform's parser functions do **not** verify the request
  came from the platform — **verify the signature/secret yourself before trusting the payload.**
  Confirm the scheme + header name in the installed package types + `docs/`; `TODO(verify)` the
  algorithm against the live doc if the package doesn't pin it.
- **Validate the fields you depend on.** Parsers commonly **don't throw on malformed input** — they
  yield **empty fields** instead. A bad delivery won't crash you, but you must validate every field
  you rely on rather than assuming the parser guarantees it.
- **Pass the body through; don't pre-shape it.** Parsers typically accept multiple shapes (an
  envelope, a bare node, a JSON-string body) — hand them the raw body.
- **Acknowledge fast, process idempotently.** Assume **at-least-once** delivery and possible
  **redelivery** — the same event can arrive more than once. Make handlers idempotent.
- **Scope stored data + normalize IDs.** Scope anything you persist to the stable per-install data
  key, keyed on **normalized** resource IDs (see `backoffice-data`).

## The critical caveat: events carry STATE, not change

**A platform event typically delivers the resource's *current state*, not a diff — and often the
same payload shape whether the resource was created, updated, or cancelled, with no event type to
tell them apart.** From one delivery you **cannot** tell whether it was a create, an update, a
reschedule, or a cancellation. You must **derive the meaning yourself** by tracking state:

- **Act only on *new* items:** keep a **seen-set** of the IDs you've already processed; if seen,
  ignore; if not, it's new. (This also gives you idempotency against redelivery.)
- **Detect a *specific* change (e.g. a reschedule or a price change):** **store the prior value** of
  the field(s) you care about and **compare** the incoming value each delivery.

This is the single easiest thing to get wrong, and the easiest to leave untested — cover it (see
`testing`). The canonical example (a booking webhook that fires identically on create and update)
is in `peek-webhooks`.

## Stable keys

Use the resource's stable IDs (which typically **never change**) as your keys for seen-sets, stores,
and lookups — combined with per-install scoping. **Normalize every ID first** to its canonical form
so keys match (see `backoffice-data`). The exact ID fields and formats are platform-specific — see
`peek-webhooks` / `peek-backoffice-api`.

## Related skills

- `peek-webhooks` — the canonical concrete events (booking + waiver), the parser functions, the
  registered-query payload shape, and the "state not change" caveat made concrete.
- `backoffice-data` — ID normalization + per-install scoping (shared with webhooks), and the SDK to
  *act* on what an event tells you.
- `embed-and-auth` — the *other* inbound path (the user-token API); contrast the auth models so you
  don't confuse them, and the server-to-host client you build from the delivery's install id.
- `javascript-nextjs` — the route-handler mechanics for the endpoint.
- `cli` — list the webhook extensions available for the platform and read each one's manifest config
  (`app_registry_webhook@v1`, `webhook_on_…`).
- `manifest-and-deploy` — where the webhook endpoint URL is declared for the app.
- `testing` — testing the "state not change" derivation and delivery verification.
