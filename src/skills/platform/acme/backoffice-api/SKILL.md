---
name: acme-backoffice-api
description: >-
  How to read ACME back-office data with the AcmeAccessService SDK (from @peektravel/app-utilities)
  — the concrete ACME capability surface and the data rules around it. Use when calling the ACME
  API (activities, which come from published event templates), and for ACME's capability ceiling
  (the typed SDK is the hard limit — no direct-API escape hatch), the published-templates and
  no-tickets facts, installDataId scoping, and PII handling. The installed package's own type
  definitions are the authoritative SDK surface — read them (see javascript-app-utilities). Triggers
  on "ACME API", "AcmeAccessService", "getAllActivities on acme", "acme activities", "event
  templates", "acme SDK methods", "AcmeApiError", "acme capability boundary".
---

# Talking to the ACME back-office API

This is the **concrete ACME data mechanism**. The generic discipline — use the platform's official
SDK, never a raw client; minimize PII; discover capabilities from the installed SDK rather than
assuming — lives in `backoffice-data`. Read that for the *why*; this skill is the authoritative
*how it works on ACME*.

Authenticated requests get a ready-to-use, install-scoped **`AcmeAccessService`** instance (called
`acme` by convention). The auth pipeline builds it for you: a route under the ACME tree wrapped in
`withAppAuthentication<AcmeAccessService>` receives the authenticated `acme` client as its second
argument (see `acme-embed-and-auth`).

```ts
// app/examples/acme/main/api/<thing>/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { type AcmeAccessService } from "@peektravel/app-utilities";
import { withAppAuthentication } from "@/lib/with-app";

export const GET = withAppAuthentication<AcmeAccessService>(
  async (_request: NextRequest, acme: AcmeAccessService) => {
    const activities = await acme.getAllActivities();
    return NextResponse.json({ activities });
  },
);
```

## The installed types are the source of truth

The **complete, authoritative** SDK surface ships with the package — read it directly instead of
guessing. `AcmeAccessService` is the ACME client; every public method is fully typed there with
TSDoc and exact return shapes. **How** to introspect the installed package (paths, confirming a
current version, enumerating the client's methods) is a stack concern — see
`javascript-app-utilities`. This skill states the *capability boundary* and the data rules.

> The SDK surface is **version-evolving** — always confirm a method or field name against the
> installed types before calling it. Don't rely on the example below as the limit or on model
> memory. `TODO(verify)` anything the types/docs don't pin.

### The surface confirmed in use by this starter kit

ACME's typed surface is **small today** — the shipped route
(`app/examples/acme/main/api/activities`) uses exactly one method:

- `acme.getAllActivities()` → a flat list of `AcmeActivity`
  (`{ productId, name, type, color, tickets }`). Internally this delegates to
  `acme.getProductService().getAllActivities()`.

Treat this as a **starting point that will grow**, not the ceiling of what ACME *could* expose —
but also not proof that anything else exists yet. Read the installed `.d.ts` for the real current
surface before calling anything else.

## The ACME capability boundary — the typed SDK is a HARD ceiling

**This is ACME-specific and load-bearing:**

- **The typed `AcmeAccessService` is the only supported way into ACME — there is no escape hatch.**
  The package gives you **only** the typed client. If a capability is absent from the installed
  types, on ACME **it does not exist** — there is nothing to "drop down" to. **Do not access ACME's
  API directly** (no hand-written HTTP against the gateway); the SDK is the hard ceiling.
- (This is unlike Peek, which does have a documented last-resort way to reach capabilities the SDK
  doesn't wrap — **don't carry that assumption to ACME.** ACME has no such fallback.)
- If you need something the SDK doesn't offer, that's a gap to raise with the user / the package —
  not something to work around with a raw HTTP client.

All server-side (Node) interaction with ACME goes through `@peektravel/app-utilities`
(`AcmeAccessService`) — from authenticated routes, webhook handlers, scripts, cron. It's wired in
`lib/acme-service.ts`.

## What an ACME "activity" actually is — published event templates, no tickets

ACME's `getAllActivities()` reads the **event-templates** endpoint (`v2/b2b/event/templates/names`)
and returns each as an `AcmeActivity`. Two ACME-specific facts about the shape:

- **Only *published* templates are surfaced.** The converter filters to `reviewState ===
  "published"`; drafts/other states never appear. Don't expect an unpublished template in the list.
- **`AcmeActivity.tickets` is ALWAYS empty today.** ACME does not expose tickets/sub-options yet,
  so the field is present (for shape parity with cng/peek) but is always `[]`. Don't build UI that
  depends on tickets being populated on ACME.
- `AcmeActivity.type` is the template type (`ACME_ACTIVITY_TYPE === "standard"` is the fallback for
  templates missing a type).
- `AcmeActivity.color` is a hex string with a **neutral-gray fallback (`"#d1d1d1"`)** when no color
  is set — so unlike cng (empty string), ACME always gives you a usable color, but you may still
  prefer your own neutral token in the UI.

Re-check the installed types after any package bump — the shape may evolve (e.g. tickets could
become populated once ACME exposes them). `TODO(verify)` anything not pinned by the types/docs.

## Errors — branch on the typed classes

The package throws typed errors; import and branch with `instanceof` rather than parsing messages:

- **`AcmeApiError`** — a non-2xx REST response that isn't one of the specifically-handled statuses.
  Carries `.statusCode` and the raw `.body` (parsed JSON when possible, else text).
- **`AdminAccountRequiredError`** (HTTP 418) — the install isn't permitted; an admin account is
  required. **Shared** with the other gateways.
- **`RateLimitError`** (HTTP 429 after the SDK's retries are exhausted) — also shared. The client
  already retries 429 with backoff; this only surfaces once retries run out.

These three are the typed errors you'll see on ACME.

## IDs are opaque strings today — don't invent Peek's normalization

Peek has a dual-format booking/order ID scheme (`b_123abc` vs `B-123ABC`) with a normalize-on-input
rule. **That is Peek-specific — do not carry it to ACME.** ACME surfaces template/product IDs
today; treat `productId` as an **opaque, stable key** (store/compare it as-is). If ACME later
exposes IDs with a display/canonical split, confirm the exact rule from the installed types/docs and
`TODO(verify)` — don't assume it matches Peek's.

## `installDataId` — scope persisted data (when you add a DB)

The install model is **brand-agnostic**: every platform hands the app an `installId` on the
verified token, and the install ID **does not rotate** across uninstall→reinstall. So keying your
own data on `installId` alone means a reinstalled app inherits **stale data**.

Phase 0 ships no database. **When you add persistence:** scope every row to an **`installDataId`**
you derive yourself — get-or-create it on the first authenticated request from `auth.installId`
(there is no `auth.installDataId`; you mint and store it). ACME **does** receive an install
lifecycle signal — the **install-status webhook** (see `acme-webhooks`) — which is where
uninstall/reinstall handling (minting a fresh `installDataId`, wiping prior data) can hang once its
payload shape is confirmed (`TODO(verify)`). Build the `installDataId` indirection in from the start
of any persistence work — retrofitting it is painful.

## Security & PII

- HTTPS in transit; encrypt at rest; restrict who/what can read it.
- Store the **minimum** necessary; prefer referencing ACME IDs over copying data.
- Keep secrets out of source control and client bundles — use your host's secret store (see
  `acme-manifest-and-deploy`).
- **Never log PII or tokens.** Redact.

## Related skills

- **`backoffice-data`** (global) — the generic SDK-not-raw / discover-don't-assume / PII discipline
  behind this skill.
- **`javascript-app-utilities`** (stack) — *how* to introspect the installed `@peektravel/app-
  utilities` package: types/`docs/` paths, confirming a version, enumerating the client surface.
- **`acme-embed-and-auth`** — how the authenticated `acme` client gets built per request
  (`withAppAuthentication` → `createAcmeService`), and the server-to-ACME path with no user token.
- **`acme-webhooks`** — the inbound path (the install-status webhook); reuse the same
  `installDataId` scoping to *act* on events.
- **`acme-manifest-and-deploy`** — the `acme_backoffice_api@v1` extendable in `app.acme.json` grants
  this API access.
- **`peek-backoffice-api`** — the canonical, larger example of a platform capability surface. ACME
  mirrors its *discipline*, not its *capabilities* (no escape hatch, far smaller surface).
