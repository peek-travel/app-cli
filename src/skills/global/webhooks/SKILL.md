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

It arrives as **one POST carrying two payloads at once**, and you use **both**:

- **A signed `app_registry_v2` JWT** — the **security boundary**. Verifying its signature is what
  proves the delivery came from the platform; **it authenticates the whole request, body included**
  (only the platform can mint a valid one). It also carries `installId`, `accountId`, `status`,
  `displayVersion`, and the acting `user`.
- **A plain JSON body** — the **event payload**, and the source of the event data: the full account
  block (`name`, `platform`, `timezone`, `is_test`), the per-install **`api.url`**, the acting user
  (`modified_by`), and `install_id` / `status` / `display_version`.

**Trust model:** verify the token *first*; because a valid token authenticates the whole delivery, the
**body is trusted within a verified request**. Read the event data from the **body**, and for the few
fields the token *also* carries (`installId`, `accountId`, `status`, `displayVersion`, `user`) **fall
back to the token** when the body omits them.

**Recommended: use the SDK.** JS apps call `@peektravel/app-utilities`' `parseInstallWebhook(token,
body, secret)` — it verifies the token and reads the event (with token fallback) into one flat record
in a single call (see `javascript-app-utilities`). **If you're not on JavaScript, replicate exactly
what it does:**

1. **Verify the JWT** (HS256, your app secret): check the signature, `iss === "app_registry_v2"`,
   `aud === "Joken"`, and `exp`. Restrict the accepted algorithm to HS256. The token arrives in the
   **`x-peek-auth` request header** (strip a leading `Bearer ` if present). Any failure → **401** —
   this authenticates the whole delivery.
2. **Read the event from the JSON body:** `installId` = `install_id`, `accountId` = `account.id`
   (a.k.a. partner id), `accountName` = `account.name`, `platform` = `account.platform`, `isTest` =
   `account.is_test`, `timezone` = `account.timezone`, **`apiUrl` = `api.url`**, `status`,
   `displayVersion` = `display_version`, `user` = `modified_by`.
3. **Fall back to the token** for the fields it also carries (`installId` = `sub`, `accountId` =
   `account.id`, `status`, `displayVersion` = `display_version`, `user`) when the body omits them.
4. **Validate the growable enums and fail loud** (below), then **persist as a unit** and **use
   `apiUrl` as the endpoint for this install's API calls** (both further below).

**The JSON body** — the event payload (the POST body):

```json
{
  "status": "installed",
  "api": { "url": "https://app-registry.sandbox.peeklabs.com/installations-api/your-app-dev" },
  "account": {
    "id": "4b52e9d2-7411-4d47-9100-71bebb55d151",
    "name": "Oskar's Boat Tours",
    "timezone": "America/New_York",
    "is_test": true,
    "platform": "peek"
  },
  "install_id": "cf34832d-16ea-4197-86fd-bf63e6917348",
  "display_version": "1.0.3",
  "modified_by": {
    "email": "jane@operator.com", "id": "user-xyz", "is_admin": true,
    "locale": "en", "name": "Jane Operator", "platform": "peek"
  }
}
```

**The signed token** — decoded `app_registry_v2` claims. It authenticates the delivery and backs up
the shared fields (`sub`, `account.id`, `status`, `display_version`, `user`); `api.url` / `timezone` /
`name` / `platform` / `is_test` are **body-only**:

```json
{
  "iss": "app_registry_v2",
  "aud": "Joken",
  "sub": "cf34832d-16ea-4197-86fd-bf63e6917348",
  "exp": 1699999999,
  "status": "installed",
  "display_version": "1.0.3",
  "account": { "id": "4b52e9d2-7411-4d47-9100-71bebb55d151" },
  "user": { "email": "jane@operator.com", "id": "user-xyz", "is_admin": true, "locale": "en", "name": "Jane Operator", "platform": "peek" }
}
```

Concrete field names are pinned by the SDK types — see `javascript-app-utilities`
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
  account-permanent data lives under `accountId` and is meant to *survive*.) **Only mint a new one on a
  *genuine* (re)install — see "When to mint a new `installDataId`" below.** See `backoffice-data`.
- **`platform` — persist it per install.** It decides **which platform APIs / SDK client / features**
  the install is served by (peek vs cng vs acme), two installs of the same app can be on **different**
  platforms, and this webhook is its **only source**. Store it alongside `installId` / `accountId`.
- **`apiUrl` — persist it per install, and use it as the API endpoint for this install's calls.** The
  registry serves each install from its **own app endpoint URL** (`api.url`). Persist it and pass it
  **as given** (unmodified — don't decompose it or append your own app id) when you build this
  install's back-office client — **never a hardcoded or app-level endpoint.** It has no source other
  than this webhook, and **it can change**: an `update_installed` event redelivers the full record with
  a possibly-new `apiUrl`, so overwrite the stored value on every event. A client built against a
  stale `apiUrl` sends its API calls to the **wrong endpoint**. (The app-level hardcoded gateway is a
  deprecated fallback that will be removed — see `javascript-app-utilities` / your platform's
  `*-backoffice-api`.)
- **`timezone` — persist it per install.** The account's IANA zone (e.g. `America/New_York`).
  Date/time handling for the install (scheduling, day boundaries, display) needs the **account's own
  zone**, not the server's. Body-only, no other source.
- **`accountName` — always persist it** from the install call. It has no functional role, but keeping
  it makes **debugging far easier** (logs/records name the account, not just opaque ids).

**The identity fields always arrive on the install delivery and are never absent — model
`installId` / `accountId` / `accountName` / `platform` / `isTest` as non-nullable columns.** The only
`null` you will ever see is the **version-mismatch sentinel** on `platform` (and `status`) described
above — a fail-loud condition you resolve *before* writing the row, never a value you persist.
(`apiUrl` and `timezone` default to `""` when a given delivery omits them — treat empty as "not
reported this time" and **keep the last non-empty value you stored**, rather than overwriting with
blank.)

### Every install event is a full snapshot — upsert by `installId`

An install webhook is **not** just a one-time "who is this install" signal. **Every event carries the
complete, current record**, and an `update_installed` event delivers the *same fields* as the original
`installed` event — that's how the registry pushes changes (a new `apiUrl`, a renamed account, a new
`displayVersion`, even a platform move). So treat each delivery as an **upsert keyed by `installId`**
and overwrite your stored fields with the incoming ones. A consumer that reads only the first
`installed` event and ignores later `update_installed` deliveries keeps **stale data — most
dangerously a stale `apiUrl`, sending its API calls to the wrong endpoint.**

### When to mint a new `installDataId` — guard on the operator's active state

Minting a fresh `installDataId` **wipes the old install's working data**, so mint one only on a
*genuine* (re)install — **not** on every install delivery. Persist an **operator-level active flag**
(keyed on the permanent `accountId`) on the account/install record, and on each install-status delivery
branch on the operator's *current* stored state:

- **No record for this operator (first install)** → create it, mint a fresh `installDataId`, mark active.
- **Operator's current install is *not active* (was previously uninstalled)** → a real reinstall: mint a
  **new** `installDataId`, drop everything under the old one, mark active.
- **Operator's install is *already active*** → an incoming `installed` (a duplicate/extra delivery —
  defensive; it shouldn't happen) or an `update_installed` (a field refresh) is **not** a reinstall.
  Upsert the record (overwrite `apiUrl` / name / version / platform) but **keep the existing
  `installDataId`** — do **not** wipe live data.
- **On uninstall** → flip the flag inactive and tear down / mark the old install's data for wipe. The
  *next* `installed` then falls into the "not active" branch and mints fresh.

Key this check on **`accountId`** (the operator), never on `installId` — `installId` **may change**
across reinstalls, so an installId-keyed check would miss the prior install's state. Keying on the
operator is what makes minting both correct *and* idempotent against a redelivered `installed`.

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
