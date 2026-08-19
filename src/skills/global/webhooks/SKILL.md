---
name: webhooks
description: >-
  The inbound-events model for an app built on this kit — receiving and handling platform webhooks
  (something happened: a booking created/changed/cancelled, a waiver signed, etc.). Use when adding
  an endpoint that reacts to a platform event for waitlist, abandoned-booking, dynamic-pricing, or
  sync features — or the install/uninstall lifecycle webhook that tells the app who an install
  belongs to. Covers the registration/endpoint split, verifying the delivery yourself, validating
  fields, idempotency, the critical "events carry state, not change" caveat, and what install
  identity (installId, accountId/partnerId, accountName, platform) to persist and how permanent each
  is. Triggers on "webhook", "platform event", "booking event", "react to a booking", "handle an
  event", "verify a webhook", "webhook idempotency", "install webhook", "install event", "uninstall",
  "who is this install", "account id", "partner id".
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

## The install / lifecycle webhook — how the app learns who it belongs to

Separate from the "something happened to a resource" event webhooks above, the platform fires an
**install lifecycle webhook** on **install / uninstall / update**. It is special: **it is the only
place the app ever learns *who an install belongs to*** — the account identity behind an install.
No back-office read and no user-token returns the account id, so **whatever you persist from this
delivery is all you will ever have.** Handle it (provision on install, tear down on uninstall) and
persist the identity it carries.

It arrives as **one POST carrying two payloads at once**, with a **split trust model** — and you use
**both**:

- **A signed `app_registry_v2` JWT** — the **security boundary** *and* the **authoritative identity**.
  Verifying its signature proves the delivery came from the platform. It carries `installId`,
  `accountId`, `status`, `displayVersion`, and the acting `user`.
- **A plain JSON body** — the **enrichment** channel, and the *only* source of `accountName`,
  `platform`, and `isTest`. It is **unsigned**, so trust it *only* for those three fields.

The four fields present in **both** (`installId`, `accountId`, `status`, `displayVersion`) must be
read from the **verified token, never the body** — so a forged or mismatched body can never override
an authenticated identity.

**Recommended: use the SDK.** JS apps call `@peektravel/app-utilities`' `parseInstallWebhook(token,
body, secret)` — it verifies the token and merges both payloads into one flat record in a single call
(see `javascript-app-utilities`). **If you're not on JavaScript, replicate exactly what it does** —
you must consume both payloads:

1. **Verify the JWT** (HS256, your app secret): check the signature, `iss === "app_registry_v2"`,
   `aud === "Joken"`, and `exp`. Restrict the accepted algorithm to HS256. Any failure → **401** —
   this is the only proof the delivery is really from the platform. (The token rides with the request;
   confirm the exact header — e.g. `Authorization: Bearer …` or `x-peek-auth` — against a real
   delivery.)
2. **Read identity from the verified token** (authoritative): `installId` = `sub`, `accountId` =
   `account.id` (a.k.a. partner id), `status`, `displayVersion` = `display_version`, `user` (nullable
   — system events have none).
3. **Read enrichment from the JSON body**, and *only* these: `accountName` = `account.name`,
   `platform` = `account.platform`, `isTest` = `account.is_test`. Never take an identity field from
   the body.
4. **Validate the growable enums and fail loud** (below), then **persist as a unit** (further below).

**The signed token** — decoded `app_registry_v2` claims (`user` is `null` for system-initiated events
such as most uninstalls):

```json
{
  "iss": "app_registry_v2",
  "aud": "Joken",
  "sub": "8bd8fa02-a496-4866-a00a-e327f5f7c2e6",
  "exp": 1699999999,
  "status": "installed",
  "display_version": "1.0.2",
  "account": { "id": "1000001" },
  "user": {
    "email": "jane@operator.com", "id": "user-xyz", "is_admin": true,
    "locale": "en", "name": "Jane Operator", "platform": "peek"
  }
}
```

**The JSON body** — the unsigned POST body:

```json
{
  "status": "installed",
  "install_id": "8bd8fa02-a496-4866-a00a-e327f5f7c2e6",
  "display_version": "1.0.2",
  "account": { "id": "1000001", "name": "Demo Park", "platform": "peek", "is_test": true }
}
```

The body repeats `status` / `install_id` / `display_version` / `account.id`, **but ignore those** —
take them from the verified token; trust the body only for `account.name` / `account.platform` /
`account.is_test`. Concrete field names are pinned by the SDK types — see `javascript-app-utilities`
(`parseInstallWebhook` → `InstallWebhook`) and `peek-webhooks`.

### Fail loud on an unknown status or platform

The lifecycle payload's `status` (installed / uninstalled / updated) and `platform` can be values a
given SDK version doesn't recognize (the contract **grows** — a new status, a new platform). Parsers
report these as **`null` rather than coercing** them. **Give both a `default:` branch that fails
loudly** (e.g. `500`, so the platform can redeliver): the platform treats any **2xx as delivered and
does not redeliver**, so silently mapping an unknown status onto a no-op drops a lifecycle transition
**permanently**, and defaulting an unknown platform points that install at the **wrong gateway**.

## Install identity: what to persist, and how permanent each field is

From the install webhook, persist the identity as a unit. The fields differ in **permanence** — key
your data on the right one:

- **`accountId` (a.k.a. `partnerId` — note the two names for the same thing) is the permanent
  anchor.** It is **consistent across installs** of the app for that account and does not change.
  **Any data that must survive an uninstall→reinstall — anything tied to a specific platform account
  — key on `accountId`, not on the install id.** This is the only way to guarantee permanence.
- **`installId` identifies a specific install** (the platform + app + account combination). It is
  consistent for a given install, **but it *may* change** — so do **not** treat it as an immortal key
  for account-permanent data. It *is* the handle you build a **server-to-host client** from (see
  `embed-and-auth`) and what a lifecycle delivery is about.
- **`installDataId` — still generate and use one.** Mint your own per-install marker (e.g.
  `installId` + an install-time stamp) and scope an install's own working data to it. Its value is a
  **clean wipe on a fresh (re)install**: on reinstall, mint a new `installDataId` and drop everything
  under the old one, so a reinstalled app starts fresh instead of inheriting stale state. (Contrast:
  account-permanent data lives under `accountId` and is meant to *survive*.) See `backoffice-data`.
- **`platform` — persist it per install.** It decides **which platform APIs / SDK client / features**
  the install is served by (peek vs cng vs acme), two installs of the same app can be on **different**
  platforms, and this webhook is its **only source**. Store it alongside `installId` / `accountId`.
- **`accountName` — always persist it** from the install call. It has no functional role, but keeping
  it makes **debugging far easier** (logs/records name the account, not just opaque ids).

**These identity fields always arrive on the install delivery and are never absent — model them as
non-nullable columns** (`installId`, `accountId`, `accountName`, `platform`, `isTest`). The only
`null` you will ever see is the **version-mismatch sentinel** on `platform` (and `status`) described
above — a fail-loud condition you resolve *before* writing the row, never a value you persist. So a
correctly-handled install never stores a null in any of these; don't model them as nullable.

## Stable keys

Use the resource's stable IDs (which typically **never change**) as your keys for seen-sets, stores,
and lookups — combined with per-install scoping. **Normalize every ID first** to its canonical form
so keys match (see `backoffice-data`). The exact ID fields and formats are platform-specific — see
`peek-webhooks` / `peek-backoffice-api`. For account/install identity specifically, prefer the
**permanent `accountId`** over `installId` for anything that must outlive a reinstall (above).

## Related skills

- `peek-webhooks` — the canonical concrete events (booking + waiver), the parser functions, the
  registered-query payload shape, and the "state not change" caveat made concrete.
- `backoffice-data` — ID normalization + per-install scoping (shared with webhooks), and the SDK to
  *act* on what an event tells you.
- `embed-and-auth` — the *other* inbound path (the user-token API); contrast the auth models so you
  don't confuse them, and the server-to-host client you build from the delivery's install id.
- `javascript-app-utilities` — the concrete JS helper for the install webhook: `parseInstallWebhook`
  (verifies the token and merges it with the JSON body into one flat `InstallWebhook`).
- `javascript-nextjs` — the route-handler mechanics for the endpoint.
- `cli` — list the webhook extensions available for the platform and read each one's manifest config
  (`app_registry_webhook@v1`, `webhook_on_…`).
- `manifest-and-deploy` — where the webhook endpoint URL is declared for the app.
- `testing` — testing the "state not change" derivation and delivery verification.
