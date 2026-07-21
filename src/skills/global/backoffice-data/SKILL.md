---
name: backoffice-data
description: >-
  The discipline for reading and writing a platform's back-office data from an app built on this
  kit — reach the API only through the platform's official SDK (never raw HTTP/GraphQL against a
  live account), discover capabilities from the INSTALLED SDK (they're platform- and version-
  specific), normalize resource IDs on input, treat platform data as PII, and scope persisted data
  by a stable per-install key. Use when calling the platform API — listing products/activities,
  querying availability, reading bookings/orders/payments/customers — and for the data rules that
  govern it. Triggers on "platform API", "SDK methods", "list bookings", "activity data",
  "booking data", "normalize IDs", "install data scoping", "PII", "never hand-write GraphQL".
---

# Talking to the platform's back-office data

Authenticated requests in this app get a ready-to-use, install/tenant-scoped **platform SDK
client**. This skill covers the discipline around using it: how to reach the API, how to discover
what's available, and the data rules (ID normalization, scoping, PII). **Peek Pro is the canonical
example** — its concrete client (`PeekAccessService`), resources, ID formats, and GraphQL
escape-hatch live in `peek-backoffice-api`.

> **How you get the client:** the auth pipeline builds it for you, scoped to the acting install.
> See `embed-and-auth` for the pipeline; this skill is about *using* it responsibly.

## Reach the API only through the platform's official SDK

- **Never hand-write GraphQL or hand-roll an HTTP client against a live account.** Platforms often
  expose a GraphQL or HTTP API underneath, but **raw access against an installed account is risky**
  — misuse can harm the account's underlying data or infrastructure. The official SDK wraps it
  safely; use it.
- **Every server-side interaction with the platform API goes through the official SDK** — from
  authenticated routes, the MCP endpoint, webhook handlers, scripts, cron jobs, anywhere. On the JS
  stack the SDK is typically Node-only; see `javascript-app-utilities`.
- If the SDK seems to lack a method you need, **check the installed package's type definitions
  first** (see below) — the full method list is right there — before even considering a raw
  escape-hatch, and **flag the risk to the user**. Whether an escape-hatch even exists is
  platform-specific (peek has one; some platforms have none) — see your platform's
  `*-backoffice-api`.

## Capabilities are platform- AND version-specific — discover them, don't assume

The single most important rule: **do not assume from memory that a method, resource, or field
exists.** The SDK surface **differs per platform** (the same package can expose GraphQL on one
platform and a strictly typed ceiling on another) and **evolves per version**. A capability that's
trivial on the canonical platform may be **absent** on the one you're building for.

So, before calling any method or referencing any field:

1. **Read the installed SDK's type definitions and shipped docs** for the *selected* platform. The
   types are the authoritative, version-matched contract — real method names, argument shapes,
   nested field names, not approximations. *How* to introspect the installed package (find the
   types, confirm the version, enumerate the client's methods) is your stack's concern — see
   `javascript-app-utilities`.
2. **Confirm the real name and shape** before you rely on it. The types are the contract; don't
   invent method or field names.
3. If a capability is genuinely **absent** from the installed types, treat that as the platform's
   boundary — mark `TODO(verify)`, flag it to the user, and only then consider whatever
   escape-hatch (if any) the platform documents. See `peek-backoffice-api` for the canonical
   capability boundary.

This is the same capability gate the `app-builder` orchestrator enforces at plan time: verify each
needed capability exists in the installed SDK for the selected platform **before** locking the plan.

## Normalize resource IDs on input

Platform resource IDs commonly arrive in **more than one format** — an internal/canonical form and
a human-facing display form (e.g. the canonical example: `b_123abc` internal vs. `B-123ABC`
display). **Whenever you receive an ID — from the SDK, a webhook, a URL, user input — normalize it
to the single canonical form first**, then store, compare, and key caches/lookups on that. Use the
display form only for showing humans. These IDs typically **never change**, so the canonical form is
your stable key. Mixing formats causes duplicate or missed records. The exact formats and the
normalization rule are platform-specific — see `peek-backoffice-api`.

## Scope persisted data by a stable per-install key

Platforms typically pass several identifiers (who is acting, which account, which install). The
**install identifier often does NOT rotate** — an uninstall→reinstall can yield the *same* install
id. So keying your stored data on the raw install id alone means a reinstalled app inherits **stale
data**.

When you add persistence, scope every row to a **stable per-install data key** that you **derive
(get-or-create)** — not the raw install id:

- On the first authenticated request for an install, look it up in your store; if absent, create
  the record now and stamp a data-scoping key (e.g. the install id plus a first-seen marker you
  generate). Every later request reuses the stored one.
- **Scope all records to that key**, keyed on **normalized** resource IDs.
- Build this indirection in from the start of any persistence work — retrofitting it is painful.
  (Cleanly rotating the key on reinstall may require an uninstall/reinstall signal the platform
  doesn't always provide — treat the rotation half as a `TODO(verify)` against your platform's
  webhook capabilities.)

The install identifier (for API auth) and the data-scoping key (for your storage) are **different
values from different sources** — see the "Two IDs" note in `embed-and-auth`, and
`peek-backoffice-api` for how the key is derived on the canonical platform.

## A platform data gotcha to always verify: wall-clock time

Platform data can carry hazards that only show up in production. A common one: **wall-clock / local
time values carry no timezone.** A field like an operator's local start time (e.g. a `"5:00 PM"`
timeslot) means exactly what it reads in the operator's locale — with **no offset, no zone
attached**. **Don't blindly convert it through the server's timezone** (`new Date(...)`,
`toISOString()`, any tz-aware conversion) — the server's zone (often UTC) will silently shift it by
hours. This exact hazard caused a half-day reconciliation bug on the canonical platform. Read such
values literally and treat them as opaque local strings unless you know the zone. Confirm each
field's real semantics in the installed types — see `peek-backoffice-api` for the concrete timeslot
rules.

## Security & PII

Platform data routinely includes sensitive PII (guest names, emails, phones, payment metadata):

- **Don't fetch PII you don't need — and PII is OFF by default, so keep it that way.** The SDK
  (`@peektravel/app-utilities` 0.5.1+) takes `accessOptions: { fullCustomerAccess }` once when the
  access client is constructed; it **defaults to `false`**, so customer identity is redacted at the
  source (fields arrive `null`/empty — filtered in the gateway selection, never fetched) and
  payment/booking-modification operations are disabled. Not fetching PII is the strongest possible
  handling: nothing to encrypt, log-redact, or retain, and far less compliance exposure. **Make this
  an explicit design-time recommendation to the user:** keep the default for operations/logistics
  tooling (manifests, check-in, guide assignment, notes, availability — all fully functional without
  PII), and only opt into `fullCustomerAccess: true` when a concrete feature must contact customers
  or move money (guest messaging, payments, refunds, invoicing, add-ons), and only when the install
  is entitled. The concrete redaction table + blocked-ops list are platform-specific — see
  `peek-backoffice-api`; the constructor option itself lives on the SDK (`javascript-app-utilities`).
- **HTTPS in transit; encrypt at rest; restrict who/what can read it.**
- **Store the minimum** necessary; **prefer referencing platform IDs over copying PII.**
- Keep secrets out of source control and client bundles — use your host's secret store (see
  `manifest-and-deploy`).
- **Never log PII or tokens.** Redact.

## Related skills

- `peek-backoffice-api` — the canonical concrete surface: the `PeekAccessService` client, its
  resources, the b_/o_ ID formats, the timeslot wall-clock rules, and peek's GraphQL escape-hatch
  and capability boundary.
- `javascript-app-utilities` — the stack's SDK package and *how* to introspect the installed
  package (types + docs) to enumerate the platform's capabilities.
- `embed-and-auth` — how the authenticated, install-scoped client gets built per request.
- `webhooks` — the inbound path; reuse the same ID normalization + per-install scoping. The
  install/uninstall signal you need to provision and to **wipe data on uninstall** comes from the
  `app_registry_webhook@v1` extension.
- `cli` — inspect that extension (`extensions show app_registry_webhook@v1`) and the rest of what
  the app can declare; check availability for the selected platform.
- `manifest-and-deploy` — how the app is granted API access and where secrets live.
