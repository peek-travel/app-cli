---
name: peek-backoffice-api
description: >-
  How to read and write Peek Pro back-office data from this starter kit using the
  PeekAccessService SDK (from @peektravel/app-utilities). Use when calling the Peek API —
  listing products/activities, querying availability/timeslots, reading or searching bookings,
  orders, payments, or customers — and for the rules that govern that data: booking/order ID
  normalization, installDataId data scoping, PII handling, and "never hand-write GraphQL." The
  package's own type definitions (index.d.ts) are the authoritative SDK surface — read them.
  Triggers on "Peek API", "getAllActivities", "getAllProducts", "searchBookings",
  "getAllAccountUsers", "getTimeslotsForDay", "assignTimeslotGuide", "PeekAccessService", "SDK
  methods", "app-utilities types", "index.d.ts", "list bookings", "Peek GraphQL", "activity
  data", "booking data", "timeslot", "timeslot timezone", "startTime", "availability time",
  "wall-clock".
---

# Talking to the Peek back-office API

Authenticated requests in this app get a ready-to-use, install-scoped **`PeekAccessService`**
instance (called `peek` by convention). It wraps Peek's GraphQL safely — **use it; never
hand-write GraphQL.** This skill covers what it can do and the data rules around it.

> **How you get `peek`:** the auth pipeline builds it for you. Inside a route wrapped in
> `withPeekAuthentication`, the second argument *is* the authenticated `PeekAccessService`.
> See `peek-embed-and-auth` for the pipeline; this skill is about *using* the client.

## The SDK is the only sanctioned way to reach Peek

- Peek exposes a **GraphQL API**, but **raw GraphQL against an installed account is risky** —
  misuse can harm the account's underlying infrastructure. **Do not hand-write GraphQL.**
- **Any server-side (Node) interaction with the Peek Pro API goes through
  `@peektravel/app-utilities` (`PeekAccessService`) — never a hand-rolled HTTP or GraphQL
  client.** The SDK is Node-only by design; since every Peek API call in this kit is server-side,
  app-utilities is *the* way you talk to Peek — from authenticated routes, the MCP endpoint,
  webhook handlers, scripts, cron jobs, anywhere. It's already wired: `lib/peek-service.ts`
  constructs it from the verified token's install ID and the app's env (`PEEK_APP_SECRET`,
  `PEEK_APP_ID`, `PEEK_API_URL`, `mode: "v2"`).
- If the SDK seems to lack a method you need, **check the type definitions first** (see
  "The type definitions are the source of truth" below) — the full method list is right there —
  before even considering raw GraphQL, and flag the risk to the user.

## Using it in a route

```ts
// app/peek-pro/main/api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type PeekAccessService } from "@peektravel/app-utilities";
import { withPeekAuthentication } from "@/lib/with-peek";

export const GET = withPeekAuthentication(
  async (_request: NextRequest, peek: PeekAccessService) => {
    const products = await peek.getAllActivities();
    return NextResponse.json({ activities: products });
  },
);
```

## The type definitions are the source of truth

The **complete, authoritative** SDK surface ships with the package — read it directly instead of
guessing or relying on a partial list:

```
node_modules/@peektravel/app-utilities/dist/index.d.ts
```

Every public method is fully typed there, with **TSDoc** and the exact **return shapes** — so you
get real method names, argument shapes, and nested field names, not approximations. Far more of
the API lives here than the three methods the examples happen to use: e.g.
`getAllAccountUsers`, `getTimeslotsForDay`, `assignTimeslotGuide`, and nested fields like
`assignedResources[].accountUserId` are all discoverable straight from the types.

**Before calling any method or referencing any field:** open `index.d.ts` (and any other docs the
package ships — its `README`, any additional `*.d.ts`) and confirm the real name and shape. The
types are the contract; don't invent method or field names. Only consider raw GraphQL if a
capability is genuinely **absent** from the types — and flag that to the user first.

> If `@peektravel/app-utilities` isn't present in your working tree, install dependencies so the
> types are available to read. For the SDK surface, prefer the shipped types over any other
> lookup.

### Methods confirmed in use by this starter kit

A few concrete examples from the shipped routes (`app/peek-pro/main/api/` and
`app/examples/dashboard/api/`) — a starting point, **not** the limit (the `.d.ts` above is the
full surface):

- `peek.getAllActivities()` → activity products (`{ productId, name, color, … }`).
- `peek.getAllProducts()` → all products; filter out add-ons with the exported
  `ADD_ON_PRODUCT_TYPE` constant (`products.filter(p => p.type !== ADD_ON_PRODUCT_TYPE)`).
- `peek.searchBookingsByTimeRange({ start, end, searchBy })` — `start`/`end` are ISO strings;
  `searchBy` is `"activityDate"` or `"purchaseDate"`. Bookings expose fields like `isCanceled`
  and `valueAmount` (a string — `parseFloat` it for math).

## Core resources (the domain map)

Field-level specifics for what the SDK returns live in its **return types — read them in
`index.d.ts` (above); do not invent field names.** The domain centers on:

- **Products / activities** — the bookable experiences (tours, activities, rentals).
- **Availability / timeslots** — when a product can be booked; capacity per slot.
- **Bookings** — a customer's reserved spot(s) on a timeslot. Central to most apps.
- **Orders** — the commercial wrapper around bookings (line items, totals).
- **Payments** — charges, refunds, status. **Treat as sensitive.**
- **Customers / guests** — **PII-bearing.** Minimize what you store; prefer referencing Peek
  IDs over copying PII.

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
  zone (UTC on Vercel) and silently shift the slot by hours. This is exactly what caused a
  half-day reconciliation bug: a `"5:00 PM"` slot round-tripped through UTC and landed on the
  wrong half of the day.

If you must build a real `Date` (e.g. to sort across days), keep the components local and never
assume the process timezone equals the operator's. When in doubt, treat the timeslot as opaque
local strings.

## Booking & order IDs — normalize on input

Booking/order IDs arrive in **two formats**:

- **Internal / canonical** — lowercase + underscore: `b_123abc` (booking), `o_123abc` (order).
- **Display** — uppercase + dash: `B-123ABC`, `O-123ABC` (for humans only).

**Whenever you receive an ID — from the SDK, a webhook, a URL, user input — normalize it to
the internal form first** (lowercase the string, replace `-` with `_`, e.g.
`B-123ABC` → `b_123abc`). Store, compare, and key caches/lookups on the canonical form; use
display form only for showing humans. These IDs **never change**, so they're your stable keys.
Mixing formats causes duplicate or missed records.

## `installDataId` — scope persisted data (when you add a DB)

Peek passes three identifiers: **user ID** (who's acting), **partner/account ID** (the
account), and **install ID** (unique account+app). The **install ID does NOT rotate** — an
uninstall→reinstall yields the *same* install ID. So keying data on the install ID alone means
a reinstalled app inherits **stale data**.

Phase 0 has no database, so there's nothing to scope yet. **When you add persistence:**

- Conceptually, `installDataId` = **install ID + an install-time marker**, stored as
  **`currentInstallDataId`** on an account object; **scope all records to `installDataId`**.

**Where it actually comes from in this starter: you derive it lazily — there is no install
event that hands it to you.** This kit ships **no install webhook**, so nothing fires "on
install" to mint the ID. Instead, **get-or-create it on the first authenticated request**: take
the `installId` off the verified token (`auth.installId` — the *only* install identifier you're
given; see the "What's actually in the token" note in `peek-embed-and-auth`), look it up in your
store, and if it's absent, create the record now and stamp its `installDataId` (e.g. `installId`
+ a first-seen timestamp you generate). Every later request reuses the stored one. Don't wait for
an install callback — it won't come.

- **Reinstall rotation is a `TODO(verify)` until an uninstall/reinstall signal exists.** The
  clean-slate-on-reinstall behavior — mint a *new* `installDataId` on reinstall, wipe everything
  tied to the prior one — **requires an uninstall (or reinstall) webhook this starter does not
  yet receive.** Without it, a get-or-create keyed on `installId` alone will **reuse the old
  record on reinstall** (stale data inherited), because the install ID doesn't rotate. Until that
  signal is wired, treat the wipe/rotation as unimplemented: note it, and check whether an
  uninstall webhook is available to hang it on — the package's `docs/webhooks.md` + types
  (`@peektravel/app-utilities`) and `peek-webhooks`; `TODO(verify)` if it's not there.

Build the `installDataId` indirection in from the start of any persistence work — retrofitting it
is painful — even while the rotation half stays a TODO. For the exact install-payload field names
for the three IDs, check the package types (`@peektravel/app-utilities/dist/index.d.ts`) and
`docs/`; `TODO(verify)` anything not pinned there.

## Security & PII

Peek data routinely includes sensitive PII (guest names, emails, phones, payment metadata):

- HTTPS in transit; encrypt at rest; restrict who/what can read it.
- Store the **minimum** necessary; prefer referencing Peek IDs over copying PII.
- Keep secrets out of source control and client bundles — use your host's secret store
  (Vercel env vars by default; if using Neon, keep the `DATABASE_URL` server-only).
- **Never log PII or tokens.** Redact.

## Related skills

- **peek-embed-and-auth** — how the authenticated `peek` client gets built per request.
- **peek-webhooks** — the inbound path; reuse the same ID normalization + scoping.
- **peek-app-manifest-and-deploy** — the `peek_backoffice_api@v1` extendable in `app.json` is
  what grants this API access.
