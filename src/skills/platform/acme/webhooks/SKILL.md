---
name: acme-webhooks
description: >-
  How to receive and handle ACME webhooks in a starter-kit app — today that means the
  platform-agnostic install-status webhook (install/uninstall lifecycle), NOT booking/waiver
  parsers (those are peek-only). Use when adding or changing the endpoint that reacts to an app
  being installed/uninstalled on ACME, or any future ACME event. Covers verifying + parsing the
  delivery with parseInstallWebhook (it verifies the signed app_registry_v2 JWT and merges the JSON
  body into a flat InstallWebhook), what identity to persist (accountId/partnerId is permanent,
  installId may change, persist platform + accountName) and how permanent each is,
  idempotency/installDataId scoping, and acting on an event via an install-scoped ACME client.
  Triggers on "acme webhook", "install-status", "parseInstallWebhook", "install/uninstall event",
  "app_registry_webhook", "react to an acme install".
---

# ACME webhooks — receiving events

This is the **concrete ACME inbound path**. The generic model — verify the delivery yourself, be
idempotent, and "events carry state, not change" — lives in `webhooks`. Read that for the *why*;
don't re-derive idempotency here. This skill is the authoritative *how ACME delivers events*.

Webhooks are ACME → your endpoint, "something happened." This is a **different auth model** from the
API pipeline — here *you* verify the delivery came from the platform; there is no per-request
peek-auth *user* token to trust (contrast `acme-embed-and-auth`).

## What's available today: the install-status webhook (and NOT booking/waiver parsers)

**Load-bearing difference from Peek:** the package ships webhook **parsers** — `parseBookingWebhook`
/ `parseWaiverWebhook` — but those are **Peek-only** (Peek bookings/waivers). **There are no
ACME-specific event parsers in the SDK.** Don't reach for `parseBookingWebhook` on ACME; it doesn't
model ACME data.

What ACME apps in this starter kit **do** receive is the **install-status webhook** — a
platform-agnostic lifecycle event (install / uninstall / etc.) that Peek's app registry POSTs. It's
declared in `app.acme.json` as the `app_registry_webhook@v1` registry extendable pointing at
`/examples/webhooks/install-status`, and implemented at
`app/examples/webhooks/install-status/route.ts`. This same endpoint serves every platform — the
`account.platform` field on the payload tells you which one fired it.

Unlike booking/waiver, the install lifecycle **does** have a package helper, and it is
**platform-agnostic** (not Peek-only): **`parseInstallWebhook(token, body, secret)`** verifies the
signed token and merges it with the JSON body into one flat `InstallWebhook` (`installId`, `accountId`
— **a.k.a. the partner id** — `accountName`, `platform`, `isTest`, `status`, `displayVersion`,
`user`). Use it rather than hand-parsing — see `javascript-app-utilities`.

> **Not yet fully handled.** The shipped endpoint **verifies + logs** the delivery; real handling
> ("do X on install/uninstall") is left to you.

## Verifying + parsing the delivery — `parseInstallWebhook`

The install delivery carries **two payloads at once**: a signed `app_registry_v2` JWT (in the
`x-peek-auth` header) and a plain JSON body. **`parseInstallWebhook(token, body, secret)` verifies the
token** (signature, `app_registry_v2` issuer, `Joken` audience, expiry — pass the app's
`PEEK_APP_SECRET`) and **merges** it with the body, so you no longer hand-roll JWT verification. It
**throws on verification failure** → one `try/catch` → **401**. It also tolerates the `user: null`
that system-initiated install events carry.

```ts
// app/examples/webhooks/install-status/route.ts
import { parseInstallWebhook, type InstallWebhook } from "@peektravel/app-utilities";
import { parseEnv } from "@/lib/env";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const header = request.headers.get("x-peek-auth");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : header ?? "";

  let event: InstallWebhook;
  try {
    event = parseInstallWebhook(token, await request.text(), parseEnv().PEEK_APP_SECRET);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); // bad/forged token
  }
  // ... react to event.status for event.platform === "acme"
  return NextResponse.json({ ok: true });
}
```

> **Version note.** Earlier package versions split the install webhook across `parseInstallEvent`
> (**removed** in 0.7.0) and `verifyInstallWebhook` (**deprecated**); `parseInstallWebhook` supersedes
> both — verifying *and* merging in one call. If you're on an older scaffold that hand-rolled JWT
> verification in a `lib/webhook-auth.ts`, that helper is no longer needed — `parseInstallWebhook`
> verifies for you.

## The payload — a split trust model

The **verified token** is authoritative for `installId`, `accountId`, `status`, `displayVersion`, and
`user`; the **unsigned JSON body** supplies only `accountName`, `platform`, `isTest`.
`parseInstallWebhook` reads the shared fields from the token, so a forged or mismatched body can't
override an authenticated identity. The exact wire shapes (token claims + body JSON) are in `webhooks`.

- **No payload query to register** (unlike Peek's booking webhook, whose payload is shaped by a
  registered field selection). The shape is fixed by the registry.
- **`accountId` (the partner id) is the permanent anchor** for account-scoped data; **`installId`
  identifies a specific install and may change** — don't treat it as an immortal key (full model in
  `webhooks` / `acme-backoffice-api`).
- **Persist `platform`** — it selects the access service (acme vs peek vs cng) on this shared
  endpoint — and **`accountName`** for debugging.
- `isTest` flags a test/sandbox account — you may want to skip or branch on it.
- **These fields always arrive and are never null — model them as non-nullable columns.** The only
  `null` is the version-mismatch sentinel on `platform`/`status`, which you fail loud on.

## Endpoint rules

- **Verify before trusting the delivery** — `parseInstallWebhook` throws unless the token's signature,
  issuer, audience, and expiry all check out; a `try/catch` → **401** is your gate.
- **Acknowledge fast, process safely, be idempotent** — assume at-least-once delivery (generic
  discipline in `webhooks`). Install/uninstall can be redelivered; make handling repeat-safe.
- **Key account-permanent data on `accountId`; scope wipe-on-reinstall working data to a
  `installDataId` you mint** (see `acme-backoffice-api`). Install-status is the natural place to hang
  install-lifecycle handling: on install, upsert the install/account record (capturing `accountId`,
  `accountName`, `platform`) and stamp a fresh `installDataId`; on uninstall, tear down / wipe the
  prior install's data. **Fail loud on an unknown `status`** — a 2xx is treated as delivered and not
  redelivered, so a coerced unknown drops the transition.
- **To *act* on an event** (call ACME in response), build an install-scoped client from
  `event.installId` — `createAcmeServiceForInstall(event.installId)` (see the server-to-ACME recipe in
  `acme-embed-and-auth`). Do **not** use the user-token pipeline — there is no user here.

## Future ACME events

If ACME later ships event-specific parsers or additional webhooks, they'll appear in the installed
package (types + `docs/webhooks.md`) — introspect it (`javascript-app-utilities`) and pull the live
doc; **don't hand-write or assume a parser that isn't there.** Today, install-status is the only
ACME-relevant webhook, and you verify + parse it with `parseInstallWebhook`.

## Related skills

- **`webhooks`** (global) — the generic delivery-verification / idempotency / "state not change"
  model behind this skill (don't re-explain it here).
- **`acme-embed-and-auth`** — the *other* inbound path (peek-auth token API), and the
  `createAcmeServiceForInstall` recipe to *act* on an event with no user token.
- **`acme-backoffice-api`** — `installDataId` scoping and the ACME client used inside a handler.
- **`javascript-nextjs`** (stack) — the route-handler rules (JSON only, no `react-dom/server`).
- **`acme-manifest-and-deploy`** — where the webhook endpoint URL (`app_registry_webhook@v1`) is
  declared in `app.acme.json`.
- **`peek-webhooks`** — Peek's richer webhook story (booking/waiver parsers); a contrast, since
  those parsers **do not** apply to ACME.
