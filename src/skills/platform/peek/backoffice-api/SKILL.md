---
name: peek-backoffice-api
description: >-
  How to read and write Peek Pro back-office data with the PeekAccessService SDK (from
  @peektravel/app-utilities) — the concrete Peek capability surface and the data rules around it.
  Use when calling the Peek API (products/activities, availability/timeslots, bookings, orders,
  payments, customers) and for booking/order ID normalization, installDataId scoping, the timeslot
  wall-clock hazard, PII handling, and Peek's raw-GraphQL escape hatch. The installed package's own
  type definitions are the authoritative SDK surface — read them (see javascript-app-utilities).
  Triggers on "Peek API", "getAllActivities", "getAllProducts", "searchBookings",
  "getAllAccountUsers", "getTimeslotsForDay", "assignTimeslotGuide", "PeekAccessService", "SDK
  methods", "list bookings", "Peek GraphQL", "activity data", "booking data", "timeslot",
  "timeslot timezone", "startTime", "wall-clock", "installDataId".
---

# Talking to the Peek back-office API

This is the **concrete Peek data mechanism**. The generic discipline — use the platform's official
SDK, never a raw client; normalize IDs; minimize PII; discover capabilities from the installed SDK
rather than assuming — lives in `backoffice-data`. Read that for the *why*; this skill is the
authoritative *how it works on Peek*.

Authenticated requests get a ready-to-use, install-scoped **`PeekAccessService`** instance (called
`peek` by convention). The auth pipeline builds it for you: inside a route wrapped in
`withAppAuthentication<PeekAccessService>` (the current, brand-agnostic wrapper — it verifies once
and branches on the token's `platform` claim to the Peek accessor), the second argument *is* the
authenticated `PeekAccessService` (see `peek-embed-and-auth`).

```ts
// app/examples/peek-pro/main/api/<thing>/route.ts
export const GET = withAppAuthentication<PeekAccessService>(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const products = await peek.getAllActivities();
    return NextResponse.json({ activities: products });
  },
);
```

## The installed types are the source of truth

The **complete, authoritative** SDK surface ships with the package — read it directly instead of
guessing. `PeekAccessService` is the Peek client; every public method is fully typed there with
TSDoc and exact return shapes. **How** to introspect the installed package (paths, confirming a
current version, enumerating the client's methods) is a stack concern — see
`javascript-app-utilities`. This skill states the *capability boundary* and the data rules.

> The SDK surface is **version-evolving** — always confirm a method or field name against the
> installed types before calling it; don't rely on the examples below as the limit or on model
> memory. `TODO(verify)` anything the types/docs don't pin.

### Methods confirmed in use by this starter kit

Concrete examples from the shipped routes (`app/examples/peek-pro/main/api/` and
`app/examples/dashboard/api/`) — a **starting point, not the limit**:

- `peek.getAllActivities()` → activity products (`{ productId, name, color, … }`).
- `peek.getAllProducts()` → all products; filter out add-ons with the exported
  `ADD_ON_PRODUCT_TYPE` constant (`products.filter(p => p.type !== ADD_ON_PRODUCT_TYPE)`).
- `peek.searchBookingsByTimeRange({ start, end, searchBy })` — `start`/`end` are ISO strings;
  `searchBy` is `"activityDate"` or `"purchaseDate"`. Bookings expose fields like `isCanceled`
  and `valueAmount` (a string — `parseFloat` it for math).
- `peek.getAllAccountUsers()` → account staff (with nested fields like
  `assignedResources[].accountUserId`).
- `peek.getTimeslotsForDay(...)` → the day's timeslots (see the wall-clock hazard below).
- `peek.assignTimeslotGuide(...)` → assign a guide/resource to a timeslot.

## The Peek capability boundary — raw GraphQL is a flagged last resort

**This is Peek-specific and load-bearing:**

- Peek exposes a **GraphQL API** underneath the SDK. **On Peek, raw GraphQL exists as a flagged
  last-resort escape hatch** — if a capability is *genuinely absent* from the typed SDK, you
  *can* drop to raw GraphQL. But **raw GraphQL against an installed account is risky** (misuse can
  harm the account's underlying infrastructure), so **flag it to the user first** and confirm
  before using it. Default: **never hand-write GraphQL** — use `PeekAccessService`.
- **This escape hatch is a PEEK-ONLY affordance.** On other platforms (`cng`, `acme`) there is
  **no GraphQL** — the typed SDK is their **hard ceiling**. Don't carry Peek's "you can drop to
  GraphQL in a pinch" assumption to another platform.
- Before reaching for GraphQL, **confirm the capability is truly missing** from the installed
  types (`javascript-app-utilities`) — far more of the API lives in the types than the handful of
  methods the examples use. Only if it's genuinely absent, and only after flagging the risk.

All server-side (Node) interaction with Peek goes through `@peektravel/app-utilities`
(`PeekAccessService`) — from authenticated routes, the MCP endpoint, webhook handlers, scripts,
cron. It's already wired in `lib/peek-service.ts`.

## Core resources (the domain map)

Field-level specifics live in the SDK's return types — read them in the installed package; don't
invent field names. The domain centers on:

- **Products / activities** — bookable experiences (tours, activities, rentals).
- **Availability / timeslots** — when a product can be booked; capacity per slot.
- **Bookings** — a customer's reserved spot(s) on a timeslot. Central to most apps.
- **Orders** — the commercial wrapper around bookings (line items, totals).
- **Payments** — charges, refunds, status. **Treat as sensitive.**
- **Customers / guests** — **PII-bearing.** Minimize what you store; prefer referencing Peek IDs.

## Timeslots are local wall-clock time — no timezone

A **Timeslot carries no timezone.** Its time fields are the **operator's local wall-clock**:

- `date` — `YYYY-MM-DD`
- `startTime` — a **12-hour local time string** like `"5:00 PM"` (the SDK exposes it as
  `node.start`), **with AM/PM** — not 24-hour, not ISO, not UTC.
- `durationMin` — length in minutes.

Peek attaches **no offset and no zone**; the slot means exactly what it reads in the operator's
locale. So:

- **Read the wall-clock literally.** Parse `date` + `startTime` as-is (handle AM/PM). To compute
  an end time, add `durationMin` to the parsed local time. Compare slots by their literal
  `date`/`startTime`.
- **Never convert a timeslot through a timezone.** Do **not** feed it to `new Date(...)`,
  `Intl.DateTimeFormat`, `toISOString()`, or any tz-aware conversion — those apply the *server's*
  zone (UTC on Vercel) and silently shift the slot by hours. This caused a real half-day
  reconciliation bug: a `"5:00 PM"` slot round-tripped through UTC and landed on the wrong half of
  the day.

If you must build a real `Date` (e.g. to sort across days), keep the components local and never
assume the process timezone equals the operator's. When in doubt, treat the timeslot as opaque
local strings.

## Booking & order IDs — normalize on input

Booking/order IDs arrive in **two formats**:

- **Internal / canonical** — lowercase + underscore: `b_123abc` (booking), `o_123abc` (order).
- **Display** — uppercase + dash: `B-123ABC`, `O-123ABC` (for humans only).

**Whenever you receive an ID — from the SDK, a webhook, a URL, user input — normalize it to the
internal form first** (lowercase the string, replace `-` with `_`, e.g. `B-123ABC` → `b_123abc`).
Store, compare, and key caches/lookups on the canonical form; use display form only for showing
humans. These IDs **never change**, so they're your stable keys. Mixing formats causes duplicate
or missed records.

## `installDataId` — scope persisted data (when you add a DB)

Peek passes three identifiers: **user ID** (who's acting), **partner/account ID** (the account),
and **install ID** (unique account+app). The **install ID does NOT rotate** — an
uninstall→reinstall yields the *same* install ID. So keying data on the install ID alone means a
reinstalled app inherits **stale data**.

Phase 0 has no database, so there's nothing to scope yet. **When you add persistence:**

- Conceptually, `installDataId` = **install ID + an install-time marker**, stored as
  **`currentInstallDataId`** on an account object; **scope all records to `installDataId`**.

**Where it comes from in this starter: you derive it lazily — there is no install event that
hands it to you.** This kit ships **no install webhook**, so nothing fires "on install" to mint
the ID. Instead, **get-or-create it on the first authenticated request**: take `auth.installId`
off the verified token (the *only* install identifier you're given — see the "What's in the
token" note in `peek-embed-and-auth`), look it up in your store, and if absent, create the record
now and stamp its `installDataId` (e.g. `installId` + a first-seen timestamp you generate). Every
later request reuses the stored one. Don't wait for an install callback — it won't come.

- **Reinstall rotation is a `TODO(verify)` until an uninstall/reinstall signal exists.** The
  clean-slate-on-reinstall behavior — mint a *new* `installDataId` on reinstall, wipe everything
  tied to the prior one — **requires an uninstall (or reinstall) webhook this starter does not yet
  receive.** Without it, a get-or-create keyed on `installId` alone will **reuse the old record on
  reinstall** (stale data inherited), because the install ID doesn't rotate. Until that signal is
  wired, treat the wipe/rotation as unimplemented: note it, and check whether an uninstall webhook
  is available to hang it on (the package's `docs/webhooks.md` + types and `peek-webhooks`);
  `TODO(verify)` if it's not there.

Build the `installDataId` indirection in from the start of any persistence work — retrofitting it
is painful — even while the rotation half stays a TODO. For the exact install-payload field names
for the three IDs, check the installed package types + `docs/` (`javascript-app-utilities`);
`TODO(verify)` anything not pinned there.

## Security & PII

Peek data routinely includes sensitive PII (guest names, emails, phones, payment metadata):

- HTTPS in transit; encrypt at rest; restrict who/what can read it.
- Store the **minimum** necessary; prefer referencing Peek IDs over copying PII.
- Keep secrets out of source control and client bundles — use your host's secret store (Vercel
  env vars by default; if using Neon, keep `DATABASE_URL` server-only). See
  `peek-manifest-and-deploy`.
- **Never log PII or tokens.** Redact.

## Related skills

- **`backoffice-data`** (global) — the generic SDK-not-raw / ID-normalization / PII / discover-
  don't-assume discipline behind this skill.
- **`javascript-app-utilities`** (stack) — *how* to introspect the installed `@peektravel/app-
  utilities` package: types/`docs/` paths, confirming a version, enumerating the client surface.
- **`peek-embed-and-auth`** — how the authenticated `peek` client gets built per request, and
  `createPeekServiceForInstall` for server paths with no user token.
- **`peek-webhooks`** — the inbound path; reuse the same ID normalization + `installDataId`
  scoping to *act* on events.
- **`peek-manifest-and-deploy`** — the `peek_backoffice_api@v1` extendable in `app.json` grants
  this API access.
