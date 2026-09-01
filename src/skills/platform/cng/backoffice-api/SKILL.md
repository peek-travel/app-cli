---
name: cng-backoffice-api
description: >-
  How to read Connect&GO (cng) back-office data with the CngAccessService SDK (from
  @peektravel/app-utilities) — the concrete cng capability surface and the data rules around it.
  Use when calling the cng API (products/activities), and for cng's capability ceiling (the typed
  SDK is the hard limit — no direct-API escape hatch), the placeholder/unconfirmed data shapes,
  installDataId scoping, and PII handling. The installed package's own type definitions are
  the authoritative SDK surface — read them (see javascript-app-utilities). Triggers on "cng API",
  "Connect&GO API", "CngAccessService", "getAllActivities on cng", "cng products", "cng activities",
  "cng SDK methods", "CngApiError", "cng capability boundary".
---

# Talking to the Connect&GO (cng) back-office API

This is the **concrete cng data mechanism**. The generic discipline — use the platform's official
SDK, never a raw client; minimize PII; discover capabilities from the installed SDK rather than
assuming — lives in `backoffice-data`. Read that for the *why*; this skill is the authoritative
*how it works on cng*.

Authenticated requests get a ready-to-use, install-scoped **`CngAccessService`** instance (called
`cng` by convention). The auth pipeline builds it for you: a route under the cng tree wrapped in
`withAppAuthentication<CngAccessService>` receives the authenticated `cng` client as its second
argument (see `cng-embed-and-auth`).

```ts
// app/examples/cng/main/api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type CngAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

export const GET = withAppAuthentication<CngAccessService>(
  async (_request: NextRequest, cng: CngAccessService) => {
    const activities = await cng.getAllActivities();
    return NextResponse.json({ activities });
  },
);
```

## The installed types are the source of truth

The **complete, authoritative** SDK surface ships with the package — read it directly instead of
guessing. `CngAccessService` is the cng client; every public method is fully typed there with TSDoc
and exact return shapes. **How** to introspect the installed package (paths, confirming a current
version, enumerating the client's methods) is a stack concern — see `javascript-app-utilities`.
This skill states the *capability boundary* and the data rules.

> The SDK surface is **version-evolving** — always confirm a method or field name against the
> installed types before calling it. Don't rely on the example below as the limit or on model
> memory. `TODO(verify)` anything the types/docs don't pin.

### The surface confirmed in use by this starter kit

cng's typed surface is **small today** — the shipped route (`app/examples/cng/main/api/activities`)
uses exactly one method:

- `cng.getAllActivities()` → a flat list of `Activity` (`{ productId, name, type, color, tickets }`).
  Internally this delegates to `cng.getProductService().getAllActivities()`.

Treat this as a **starting point that will grow**, not the ceiling of what cng *could* expose — but
also not proof that anything else exists yet. Read the installed `.d.ts` to see the real current
surface before calling anything else.

## The cng capability boundary — the typed SDK is a HARD ceiling

**This is cng-specific and load-bearing:**

- **The typed `CngAccessService` is the only supported way into cng — there is no escape hatch.**
  The package gives you **only** the typed client. If a capability is absent from the installed
  types, on cng **it does not exist** — there is nothing to "drop down" to. **Do not access cng's
  API directly** (no hand-written HTTP against the gateway); the SDK is the hard ceiling.
- (This is unlike Peek, which does have a documented last-resort way to reach capabilities the SDK
  doesn't wrap — **don't carry that assumption to cng.** cng has no such fallback.)
- If you need something the SDK doesn't offer, that's a gap to raise with the user / the package —
  not something to work around with a raw HTTP client.

All server-side (Node) interaction with cng goes through `@peektravel/app-utilities`
(`CngAccessService`) — from authenticated routes, webhook handlers, scripts, cron. It's wired in
`lib/cng-service.ts`.

## The data shapes are provisional — validate defensively

The cng `Activity` model is a **best-guess placeholder** until the real
`api/v2/commerce-config/products` response shape is confirmed (the package says so in
`internal/cng/products/product-queries.ts`). The converter is written defensively so unexpected or
missing fields degrade rather than throw — you should be equally defensive:

- **Validate the fields you depend on** before using them; don't assume a field is populated.
- `Activity.type` is the product type (`ACTIVITY_PRODUCT_TYPE === "ACTIVITY"`).
- `Activity.color` is a hex string, **empty string when unset** — fall back to a neutral color in
  the UI (`bar-color={a.color || "var(--color-neutral-300)"}`).
- `Activity.tickets` is the bookable sub-options list.
- **`TODO(verify)` the real response shape** against a live sample; re-check the installed types
  after any package bump, since these fields may be renamed once the shape is confirmed.

## Errors — branch on the typed classes

The package throws typed errors; import and branch with `instanceof` rather than parsing messages:

- **`CngApiError`** — a non-2xx REST response that isn't one of the specifically-handled statuses.
  Carries `.statusCode` and the raw `.body` (parsed JSON when possible, else text).
- **`AdminAccountRequiredError`** (HTTP 418) — the install isn't permitted; an admin account is
  required. **Shared** with the other gateways.
- **`RateLimitError`** (HTTP 429 after the SDK's retries are exhausted) — also shared. The client
  already retries 429 with backoff; this only surfaces once retries run out.

These three are the typed errors you'll see on cng.

## IDs are opaque strings today — don't invent Peek's normalization

Peek has a dual-format booking/order ID scheme (`b_123abc` vs `B-123ABC`) with a normalize-on-input
rule. **That is Peek-specific — do not carry it to cng.** cng surfaces product IDs today; treat
`productId` as an **opaque, stable key** (store/compare it as-is). If cng later exposes IDs with a
display/canonical split, confirm the exact rule from the installed types/docs and `TODO(verify)` —
don't assume it matches Peek's.

## `installDataId` — scope persisted data (when you add a DB)

The install model is **brand-agnostic**, but the identifiers differ in **permanence**:

- **`accountId` (a.k.a. the partner id) is the permanent anchor** — consistent across installs, it
  does not change. **Key anything that must survive an uninstall→reinstall on `accountId`.**
- **`installId` identifies a specific install** — the verified token hands it to the app on every
  request; it's the handle you build a client from (together with the install's `apiUrl`), but it
  **may change**, so don't use it as an immortal key for account-permanent data.
- **`apiUrl` — the per-install back-office endpoint** (`api.url`). Persist it and build this install's
  `CngAccessService` against it **as given**, not a hardcoded/app-level URL.
- `accountId`, `accountName`, `platform`, **`apiUrl`**, and `timezone` are **not** in the request
  token — they arrive only on the **install-status webhook** (see `cng-webhooks`), which cng **does**
  receive. That delivery is the single source of account identity **and the endpoint**; persist it on
  install and refresh it on every event (an `update_installed` can move `apiUrl`).

Phase 0 ships no database. **When you add persistence:**

- **Mint your own `installDataId`** (an install-time marker, e.g. `installId` + a first-seen stamp)
  and **scope working data to it** — get-or-create it on the first authenticated request from
  `auth.installId` (there is no `auth.installDataId`; you mint and store it). Its purpose is a
  **clean wipe on a fresh (re)install**: hang that on the install-status webhook (mint a new
  `installDataId`, drop the old install's data). On JavaScript, the SDK (`@peektravel/app-utilities`)
  verifies + parses that delivery with `parseInstallWebhook` → `InstallWebhook`; **on a non-JS stack
  (Python, etc.) there is no such package — replicate it by hand** (verify the signed JWT, read the
  JSON body), following the roll-your-own steps and wire-format examples in `webhooks`.
- **Treat each event as a full-snapshot upsert by `installId`** — capture `accountId`, `accountName`,
  `platform`, `timezone`, and **`apiUrl` (always the latest)**, overwriting the stored values, so a
  later `update_installed` can't leave you on a stale `apiUrl`.
- **Mint a new `installDataId` only on a genuine (re)install — guard on an operator-level active flag**
  (keyed on `accountId`): mint a fresh one (and wipe the old install's data) only when the operator has
  no record (first install) or its current install is **not active** (was uninstalled). While the
  operator is already active, an incoming `installed` (a duplicate/extra delivery — defensive) or an
  `update_installed` upserts the record but **keeps the existing `installDataId`**. On uninstall, flip
  the flag off and mark the old data for wipe. Key on `accountId`, since `installId` may change.
- **Build the client from `apiUrl`.** Construct `CngAccessService` with the persisted `apiUrl`, or use
  **`createAccessServiceForInstall({ platform, apiUrl, installId }, config)`**. The config's
  `baseUrl`/`appId`/`mode` are **deprecated** (hardcoded gateway default) and will be removed —
  source the URL from the webhook's `apiUrl`.
- **These identity fields always arrive and are never null — model them as non-nullable columns**
  (`installId`, `accountId`, `accountName`, `platform`, `isTest`); `apiUrl`/`timezone` may be `""` on a
  delivery, so keep the last stored value. The only `null` is the version-mismatch sentinel on
  `platform`/`status`, which you fail loud on and resolve before writing.

Build the `installDataId` indirection in from the start of any persistence work — retrofitting it is
painful.

## Security & PII

- HTTPS in transit; encrypt at rest; restrict who/what can read it.
- Store the **minimum** necessary; prefer referencing cng IDs over copying data.
- Keep secrets out of source control and client bundles — use your host's secret store (see
  `cng-manifest-and-deploy`).
- **Never log PII or tokens.** Redact.

## Related skills

- **`backoffice-data`** (global) — the generic SDK-not-raw / discover-don't-assume / PII discipline
  behind this skill.
- **`javascript-app-utilities`** (stack) — *how* to introspect the installed `@peektravel/app-
  utilities` package: types/`docs/` paths, confirming a version, enumerating the client surface.
- **`cng-embed-and-auth`** — how the authenticated `cng` client gets built per request
  (`withAppAuthentication` → `createCngService`), and the server-to-cng path with no user token.
- **`cng-webhooks`** — the inbound path (the install-status webhook); reuse the same
  `installDataId` scoping to *act* on events.
- **`cng-manifest-and-deploy`** — the `cng_backoffice_api@v1` extendable in `app.cng.json` grants
  this API access.
- **`peek-backoffice-api`** — the canonical, larger example of a platform capability surface. cng
  mirrors its *discipline*, not its *capabilities* (no escape hatch, far smaller surface).
