---
name: peek-pricing
description: >-
  How to adjust Peek Pro ticket prices from your app with the pricing engine + overrides API on
  PeekAccessService (from @peektravel/app-utilities). Use when building dynamic/scheduled/tiered
  pricing — promos, group discounts, demand- or time-of-day-based adjustments — on Peek. Covers the
  engine-once/overrides-many lifecycle, fixed vs. percentage adjustments, the spotsTaken off-by-one,
  order/tier ranking, PostgreSQL range formats for dates and start-time windows, full-replace upsert
  semantics, clearing (must name activities), and the error types. Peek-only — cng/acme have no
  pricing engine. Triggers on "pricing", "price override", "dynamic pricing", "discount", "promo",
  "tiered pricing", "pricing engine", "getPricingService", "createEngine", "upsertOverrides",
  "clearOverrides", "spotsTaken", "resourceOptions", "UpsertOverridesInput".
---

# Adjusting Peek Pro prices — pricing engines & overrides

This is the **concrete Peek pricing mechanism**. It rides on the same `PeekAccessService` client and
the same `peek_backoffice_api@v1` grant as the rest of the back-office API (see
`peek-backoffice-api`) — everything here goes through **`peek.getPricingService()`**. It is a
**Peek-only** capability: on `cng`/`acme` there is no pricing engine, so don't carry this design to
another platform.

> **Authoritative, always-current source — read it live.** The full walkthrough (with complete,
> copy-pasteable examples) lives in the package's external doc and evolves with the SDK:
> **`https://raw.githubusercontent.com/peek-travel/app-utilities/refs/heads/main/docs/external/pricing-api.md`**.
> **Pull that doc when you build against this API** — this skill is a durable orientation and a
> pointer, not a substitute. If anything here disagrees with the doc or the installed types, the
> **doc and the installed `@peektravel/app-utilities` types win** (see `javascript-app-utilities`
> for how to introspect the installed package). `TODO(verify)` any signature the types don't pin.

## The mental model (read this first)

Peek applies price adjustments at checkout through a **pricing engine**. You don't edit product
prices directly — instead:

1. Create a **pricing engine** *once*. It's just a named container; Peek returns an **`engineId`**
   you persist and reuse forever.
2. Push **overrides** onto that engine, keyed by **(date range × activity)**. An override says "for
   this activity, on these dates, adjust these tickets' prices — optionally only once N spots are
   taken and/or within a start-time window."

```
Pricing engine  (created once, identified by engineId)
└── Overrides, upserted per (date range × activity)
    └── one or more override entries, each:
        ├── resourceOptions[]  ← which tickets, and the fixed/percentage adjustment
        └── filters[]          ← optional: spotsTaken and/or startTimeRange gates
```

The service is a **thin, faithful pass-through**. Three things are **your app's job**, not the
API's: (a) **deciding** the overrides (which tickets, what price, what dates); (b) **ordering** the
entries (the `order` field); (c) **computing `spotsTaken` bounds** from ticket counts (the
off-by-one below). The service validates and sends what you give it — nothing more.

## What you need before you start

Resolve these against the installed SDK for the selected account (see `peek-backoffice-api`):

- **A configured `PeekAccessService`** — the same install-scoped `peek` client the rest of the app
  uses (built by the auth pipeline; see `peek-embed-and-auth`).
- **The activity id** — `peek.getProductService().getAllActivities()` → `product.productId`.
- **The ticket (resourceOption) ids** under it — the same product's `tickets[].id`.
- **The activity's currency** (for fixed prices) — the same product's `currency` (e.g. `"USD"`).

> **Money and percentages are STRINGS, not numbers.** `"80.00"`, `"-25"` — never `80` or `-25`. The
> API rejects floats; strings avoid precision loss. This is the single most common mistake.

## Lifecycle — create the engine once, then live in upsert/clear/update/delete

```
① createEngine ── save engineId (lazily, on first override; persist it in YOUR storage)
② build UpsertOverridesInput (you decide the overrides)
③ upsertOverrides(input) ── Peek stores them, echoes the resolved activityContexts
   … then, as things change …
   ├─ upsertOverrides(...)  re-send to CHANGE (full replace per date+activity — not a patch)
   ├─ clearOverrides(...)   remove overrides for a date range (must name the activities)
   ├─ updateEngine(...)     rename or re-scope the engine
   └─ deleteEngine(id)      tear the whole engine down (idempotent)
```

Create the engine **lazily** — only when you're about to push the first override — and store the
returned `engineId` against whatever your app calls a "schedule". Optionally scope it to specific
activities via `createEngine({ name, activityIds })`; omit `activityIds` and it can carry overrides
for any activity.

## The load-bearing gotchas

These are the details that bite. Read the live doc for the full worked examples; internalize these:

- **`upsertOverrides` is a FULL REPLACE for that `(dateRange, activity)`.** To change prices, rebuild
  the complete desired set and send it again — you don't diff or patch. Whatever you send *becomes*
  the entire override set for those dates.
- **To clear, use `clearOverrides` — and you MUST name the activities.** Clearing works by upserting
  `overrides: []` *for each activity id*; an empty `activities` array clears **nothing**. Recover the
  activity ids from what you previously upserted (e.g. the `activityContexts` you persisted). Never
  "send nothing" to clear.
- **`spotsTaken` is zero-indexed — mind the off-by-one.** It counts spots *already taken*, not the
  ticket count. For a ticket range `[L, U)`: `minSpots = L - 1` (clamp to 0, omit when 0),
  `maxSpots = U - 1` (omit when unbounded). So 5–9 tickets → `{ minSpots: 4, maxSpots: 9 }`; "5+" →
  `{ minSpots: 4 }`; any group size → omit the filter.
- **`order` ranks tiers, lowest first — you assign it.** The service does not reorder. Convention:
  sort entries **descending by `minSpots`** (deepest-discount / most-specific tier first), then
  assign `order = 0, 1, 2, …`.
- **Fixed vs. percentage per entry.** `{ id, mode: "fixed", price: { amount: "80.00", currency: "USD" } }`
  or `{ id, mode: "percentage", percentageAdjustment: "-25" }` (must be `> -100`). Keep **one mode
  per set of overrides** — mixing is harder to reason about.
- **Range strings are PostgreSQL inclusive ranges.** `dateRange`: `"[2025-07-04,2025-07-04]"` (single
  day = equal ends) or `"[2025-07-04,2025-07-06]"` (a span). Optional `startTimeRange` filter:
  `"[09:00:00,11:00:00]"` (omit for all-day). An entry can carry zero, one, or both filters.
- **`deleteEngine` is idempotent**; `upsertOverrides`/`clearOverrides` return the resolved
  `activityContexts` Peek stored — persist them if you want an audit trail of exactly what Peek
  accepted.

## Methods (short-forms exist on `PeekAccessService`)

`getPricingService()` exposes `createEngine`, `updateEngine`, `deleteEngine`, `upsertOverrides`,
`clearOverrides`. The same behavior is available one accessor call shorter directly on the client:
`peek.createPricingEngine(...)`, `updatePricingEngine`, `deletePricingEngine`,
`upsertPricingOverrides`, `clearPricingOverrides`. **Confirm exact signatures and the
`UpsertOverridesInput` shape in the installed types** — don't rely on the summary here.

## Errors — branch with `instanceof`

- **Validation errors** throw *before* any network call (plain `Error`): missing
  `engineId`/`dateRange`/`name`/`activityId`/ticket id, a `currency` that isn't 3 uppercase letters,
  a non-numeric amount, a non-numeric `percentageAdjustment`, or `percentageAdjustment <= -100`.
- **Peek rejections** surface as thrown `Error`s carrying Peek's message (e.g. overlapping tiers →
  `InvalidDataError`; `updateEngine` on a missing engine → `NotFoundError`; on `deleteEngine` it's
  swallowed for idempotency).
- **Transport errors** are importable: HTTP 418 → `AdminAccountRequiredError`, 429 after retries →
  `RateLimitError`, GraphQL errors → `PeekGraphQLError`.

## Related skills

- **`peek-backoffice-api`** — the concrete Peek client this rides on (`PeekAccessService`), how the
  authenticated `peek` instance is built, product/ticket lookup (`getAllActivities`,
  `tickets[].id`, `currency`), ID normalization, and PII rules.
- **`javascript-app-utilities`** — *how* to introspect the installed `@peektravel/app-utilities`
  package (types + `docs/`) to confirm the pricing method signatures and `UpsertOverridesInput`.
- **`peek-manifest-and-deploy`** — the `peek_backoffice_api@v1` extendable that grants this access
  (no separate pricing extendable — it's the same back-office API grant).
- **`app-builder`** — the design flow; treat "does this app change prices?" as a plan-time data-flow
  question and confirm the pricing capability exists in the installed SDK before locking the plan.
