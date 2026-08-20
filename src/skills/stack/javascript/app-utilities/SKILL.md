---
name: javascript-app-utilities
description: >-
  The @peektravel/app-utilities package — the JavaScript SDK for apps on the Peek platform
  (peek, cng, and soon acme). Use when importing from @peektravel/app-utilities, calling the
  back-office API clients, wiring Odyssey UI, or parsing webhooks — and, crucially, when you need
  to know what the SDK can actually do on the selected platform. Its API surface differs per
  platform and evolves per version, so this skill is the method for introspecting the installed
  package rather than trusting memory. Triggers on "@peektravel/app-utilities", "app-utilities",
  "the SDK", "index.d.ts", "which methods does the SDK have", "SDK version", "SDK surface",
  "install the SDK", "Node-only SDK".
---

# `@peektravel/app-utilities` — the JavaScript SDK

`@peektravel/app-utilities` is the **JavaScript SDK for Peek-platform apps** — the one package a
JS-stack app built on this kit talks to the platform through, across **peek, cng, and (soon)
acme**. It ships three things:

- **Back-office API access clients** — the typed client(s) that read and write platform data
  (products, bookings, timeslots, orders, …). **Node-only:** they verify the incoming auth token
  and **mint the platform API tokens with Node `crypto`**, so any code that uses them must run on
  the Node runtime.
- **Odyssey UI** — the shared app design theme: framework-agnostic `<ody-*>` web components +
  CSS tokens. Ships *inside this same package* (`@peektravel/app-utilities/ui`). See
  `javascript-odyssey-ui`.
- **Webhook parsers and helpers** — for the inbound platform → app path (see your platform's
  `*-webhooks` skill for the concrete parsers).

Because all three are the same JS package regardless of platform, the SDK itself is a **stack**
concern, not a Peek-specific one — a future cng- or acme-on-JavaScript app installs the same
package.

## The central rule: read the installed package, don't trust memory

**The SDK's API surface differs per platform AND evolves per version.** The same package name
exposes a *different* client and method set on `peek` than on `cng` or `acme`, and a newer version
can add, rename, or remove methods. So for the **selected platform**, you **must introspect the
installed package** rather than recall an API from training data:

1. **Read the shipped type definitions** — the fully-typed surface, with **TSDoc** and the exact
   return shapes:
   ```
   node_modules/@peektravel/app-utilities/dist/index.d.ts
   ```
   Every public method is typed there — real names, argument shapes, nested field names — not
   approximations. Also read any other `*.d.ts` the package ships (e.g. `dist/ui/index.d.ts` for
   the Odyssey/icon helpers).
2. **Read the shipped `docs/`** — the package carries its own markdown docs (e.g.
   `docs/ui.md`, `docs/webhooks.md`) for the wire protocols and conventions the types don't spell
   out.
3. **If it isn't installed**, mirror both on jsdelivr:
   ```
   https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/dist/index.d.ts
   https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/docs/ui.md
   ```
   or just **install dependencies** so the types are local and version-matched.
4. **Confirm you're on a current version** (`node_modules/@peektravel/app-utilities/package.json`,
   or `npm view @peektravel/app-utilities version`) before you rely on a method — an old pinned
   copy can lie about the surface.

**Then enumerate *that platform's* client and its methods from the types** — the `.d.ts` is the
contract. Don't invent method or field names; if a capability is genuinely absent from the types
and `docs/`, mark it **`TODO(verify)`**, check the live doc, and/or ask the user — never guess.

> If `@peektravel/app-utilities` isn't present in your working tree, install dependencies so the
> types are readable. Prefer the shipped types over any other lookup for the SDK surface.

## What's platform-specific vs. what's shared

| Platform-specific — lives in the platform's `*-backoffice-api` skill | Shared / stack-level — lives here |
| --- | --- |
| **Which client class** the platform exposes (peek → `PeekAccessService`) | The package itself + how to install/introspect it |
| **Which methods / capabilities** exist (and their return shapes) | The **Node-only** constraint on the API clients |
| Whether a **raw-GraphQL escape-hatch** exists (**peek: yes**, flagged last resort; **cng/acme: no GraphQL** — the typed SDK is the hard ceiling) | Odyssey UI (`javascript-odyssey-ui`) |
| Domain rules (ID normalization, timeslot wall-clock, install scoping, PII) | The webhook-parser *mechanism* (parsers themselves are platform-specific) |

So this skill owns the **method** — introspect the installed package for the selected platform —
while each platform's `*-backoffice-api` skill owns that platform's **capabilities**. `peek` is the
canonical example (`PeekAccessService`, `getAllActivities()`, GraphQL as a flagged last resort);
don't assume its surface holds on cng/acme.

## Node-only: the API clients require the Node runtime

The back-office API clients are **Node-only by design** — they verify the auth JWT and mint the
platform's API tokens with Node `crypto`, which a limited Edge runtime doesn't provide. So **any
route, handler, cron job, or script that uses an SDK client must run on the Node runtime**, not
Edge. This is the concrete basis for the runtime flags in the MCP-endpoint guidance (a route on
`export const runtime = 'edge'` breaks token verification and the SDK) — see `peek-mcp-endpoint`
and `javascript-nextjs` for how that constraint lands in the framework.

## PII access — `accessOptions.fullCustomerAccess` (set once at construction)

Every access service takes `accessOptions?: { fullCustomerAccess?: boolean }` in its constructor —
passed **once**, applied to every sub-service it hands out, **no per-call override**. It **defaults
to `false` (PII off)**: customer identity is filtered out of the request at the gateway (fields
arrive `null`/empty, silently) and payment/booking-modification ops throw the exported
`PiiAccessDisabledError` before any network call. This is a **stack-level SDK mechanism** (the field
exists on `Peek`/`Cng`/`Acme` access services alike — inert where a platform has no PII surface); the
concrete redaction table and blocked-op list are a **platform capability** (see `peek-backoffice-api`
on Peek). Design rule of thumb: **keep the default and only opt into `true` when the app must contact
customers or move money** (see `backoffice-data`, `app-builder`). Full spec: the package's `llms.txt`
"Access options / PII" section + the installed types.

## Webhook helpers — including the install / lifecycle webhook

The package ships **pure-transform parsers** for inbound deliveries plus one **verify-and-merge**
helper for the install webhook. Confirm the exact names, signatures, and return shapes in the
installed `dist/index.d.ts` + `docs/webhooks.md` (they're version-specific):

| Helper | Delivery | Auth |
| --- | --- | --- |
| `parseBookingWebhook(body)` → `Booking` | booking create/update (GraphQL-shaped payload) | you verify |
| `parseWaiverWebhook(body, options?)` → `Waiver` | waiver signed (fixed payload; PII via `fullCustomerAccess`) | you verify |
| `parseInstallWebhook(token, body, secret)` → `InstallWebhook` | install/uninstall/update — **signed JWT + JSON body** | **it verifies** |

The two `parse*Webhook(body)` parsers are pure (no auth, no network, construct nothing), tolerate the
delivery envelope / a bare node / a JSON string, and **never throw on malformed input** (empty fields
instead) — so **you** must authenticate those deliveries and validate the fields you use.
`parseInstallWebhook` is different: the install delivery carries a **signed `app_registry_v2` JWT and
a JSON body at once**, so this helper verifies the token (HMAC signature, expiry, `app_registry_v2`
issuer, `Joken` audience — pass the app's `jwtSecret` as `secret`; give it the raw `x-peek-auth`
header value, `Bearer ` prefix and all) and reads the event from the body, **falling back to the
token** for the fields it also carries, returning one flat `InstallWebhook`. It throws on any
verification failure — one `try/catch` → `401`. The generic model (and wire-format examples for non-JS
apps that must roll their own) is in `webhooks`.

> **Version note (0.7.x).** `parseInstallWebhook(token, body, secret)` replaced the earlier helpers:
> **`parseInstallEvent` was removed** and **`verifyInstallWebhook` is deprecated** (token-only — it
> can't report `accountName`/`platform`/`timezone`/`apiUrl`/`isTest`). The return is **flat**: read
> `event.accountId`, not `event.identity.accountId`.

### The install webhook is where the app learns *who it belongs to* (and where to call it)

The install delivery is the **only** source of the account identity **and the per-install `apiUrl`** —
no back-office read and no peek-auth token returns them. `parseInstallWebhook` returns a flat,
JSON-safe `InstallWebhook` meant to be **persisted as a unit**. Trust model: the **JSON body is the
source of the event data**; the **verified token authenticates the whole delivery** and is the
**fallback** for the fields it also carries (so a body that omits `installId`/`accountId`/`status`/
`displayVersion`/`user` uses the token's value). Because the token authenticates the request, the body
is trusted within it.

| Field | Source | Notes on permanence / use |
| --- | --- | --- |
| `accountId` | body → token | **a.k.a. the partner ID** (two names, one value). **Permanent** — consistent across installs, never changes. **Key any account-permanent data on this**, not on the install id. |
| `installId` | body → token | Identifies a specific install (platform + app + account). Consistent for that install **but may change** — the handle you build a server-to-host client from, not an immortal key. |
| `apiUrl` | body | **The per-install back-office API endpoint** (`api.url`). **Persist it and pass it as the client's `apiUrl`** — use it *as given* (do not decompose/append); never a hardcoded endpoint. `""` when a delivery omits it (keep the last stored value). **It can change on `update_installed`.** |
| `platform` | body | `"peek" \| "cng" \| "acme"` — **persist per install.** Decides which access service / APIs / features; two installs can differ; only source is this webhook. `null` if unrecognized — **fail loud**, don't default (wrong gateway). |
| `timezone` | body | Account's IANA zone (e.g. `America/New_York`) — **persist**; date/time logic needs the account's zone, not the server's. `""` when omitted. |
| `accountName` | body | **Always persist it** — no functional role, but makes debugging far easier than opaque ids. |
| `isTest` | body | Whether the install is a test account. |
| `status` / `rawStatus` | body → token | `status` ∈ `installed` / `uninstalled` / `update_installed` (`null` if unrecognized); `rawStatus` is always the wire value. |
| `displayVersion` | body → token | App version at the event. |
| `user` | body → token | Acting user (body's `modified_by`), or `null` for system-initiated events (most uninstalls). |

**Give `status` and `platform` a `default:` branch that fails loudly** — the platform treats any 2xx
as delivered and does not redeliver, so a coerced unknown drops a lifecycle transition permanently.
`installId`/`accountId`/`accountName`/`platform`/`isTest` always arrive → **non-nullable columns**;
`apiUrl`/`timezone` may be `""` on a given delivery, so keep the last non-empty value.

### Every event is a full snapshot — upsert by `installId`; build the client from `apiUrl`

**Every install event carries the complete current record** — an `update_installed` redelivers the
same fields as `installed`, which is how the registry pushes changes (a new `apiUrl`, a rename, a
version bump). **Upsert by `installId` and overwrite** — ignoring `update_installed` leaves you with a
**stale `apiUrl`** calling the wrong endpoint.

To act on a persisted install, **`createAccessServiceForInstall(install, config)`** builds the right
client from `install.platform` + `install.apiUrl` in one call (no `switch` on platform, no URL
wiring); it throws if `platform` is `null`/unrecognized. `install` is any `{ platform, apiUrl,
installId }` (the webhook event or your stored record); `config` is the per-app
`{ jwtSecret, issuer, gatewayKey?, … }`.

```ts
import { parseInstallWebhook, createAccessServiceForInstall } from '@peektravel/app-utilities';

const event = parseInstallWebhook(token, body, secret);        // verify + read
await installs.upsert(event.installId, {                       // full-snapshot upsert
  accountId: event.accountId, accountName: event.accountName,
  platform: event.platform, timezone: event.timezone,
  apiUrl: event.apiUrl,      // may change between events — always take the latest
  isTest: event.isTest, displayVersion: event.displayVersion,
});

// later, to call the install's back office:
const svc = createAccessServiceForInstall(await installs.get(id), { jwtSecret, issuer });
```

> **Source the endpoint from `apiUrl`, not `baseUrl`/`appId`.** The access-service config's
> `baseUrl`/`appId`/`mode` are **deprecated** — they reconstruct the URL from a **hardcoded gateway
> default** that can't be right for every install. `apiUrl` (the install webhook's `api.url`) takes
> precedence and is used *as given*. **The hardcoded fallbacks will be removed and a URL will become
> required**, so persist and pass `apiUrl` now.

Beyond `accountId`/`installId`, still **mint your own `installDataId`** (an install-time marker) to
scope an install's working data so a fresh reinstall wipes cleanly — see `webhooks` and
`backoffice-data`. The full persistence model lives in `webhooks`; concrete usage in your platform's
`*-webhooks` / `*-backoffice-api` skill.

## Related skills

- **backoffice-data** — the generic discipline: official SDK only (never raw HTTP/GraphQL),
  capabilities are platform/version-specific — discover them from the installed SDK, never assume.
- **peek-backoffice-api** — the canonical **capability boundary**: which client peek exposes, its
  methods, and its GraphQL last-resort (cng/acme mirror this file when they have content). This
  skill's introspection method feeds it.
- **javascript-odyssey-ui** — the Odyssey UI theme that ships inside this same package.
- **javascript-nextjs** / **peek-mcp-endpoint** — where the Node-only constraint forces the Node
  runtime.
- **webhooks** (global) / **peek-webhooks** — the inbound model these parsers/verifier serve,
  including the install/lifecycle webhook and the identity-persistence rules the helpers here feed.
