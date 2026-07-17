---
name: cng-webhooks
description: >-
  How to receive and handle Connect&GO (cng) webhooks in a starter-kit app — today that means the
  platform-agnostic install-status webhook (install/uninstall lifecycle), NOT booking/waiver
  parsers (those are peek-only). Use when adding or changing the endpoint that reacts to an app
  being installed/uninstalled on cng, or any future cng event. Covers verifying the delivery with
  requirePeekWebhookAuth (the same registry-signed peek-auth JWT, tolerant of a null user), the
  unconfirmed install-status payload, idempotency/installDataId scoping, and acting on an event via
  an install-scoped cng client. Triggers on "cng webhook", "install-status", "install/uninstall
  event", "requirePeekWebhookAuth", "app_registry_webhook", "react to a cng install".
---

# Connect&GO (cng) webhooks — receiving events

This is the **concrete cng inbound path**. The generic model — verify the delivery yourself, be
idempotent, and "events carry state, not change" — lives in `webhooks`. Read that for the *why*;
don't re-derive idempotency here. This skill is the authoritative *how cng delivers events*.

Webhooks are cng → your endpoint, "something happened." This is a **different auth model** from the
API pipeline — here *you* verify the delivery came from the platform; there is no per-request
peek-auth *user* token to trust (contrast `cng-embed-and-auth`).

## What's available today: the install-status webhook (and NOT booking/waiver parsers)

**Load-bearing difference from Peek:** the package ships webhook **parsers** — `parseBookingWebhook`
/ `parseWaiverWebhook` — but those are **Peek-only** (Peek bookings/waivers). **There are no
cng-specific event parsers in the SDK.** Don't reach for `parseBookingWebhook` on cng; it doesn't
model cng data.

What cng apps in this starter kit **do** receive is the **install-status webhook** — a
platform-agnostic lifecycle event (install / uninstall / etc.) that Peek's app registry POSTs. It's
declared in `app.cng.json` as the `app_registry_webhook@v1` registry extendable pointing at
`/examples/webhooks/install-status`, and implemented at
`app/examples/webhooks/install-status/route.ts`. This same endpoint serves every platform — the
`account.platform` field on the payload tells you which one fired it.

> **Not yet fully handled.** The shipped endpoint **verifies + logs** the delivery; real handling
> ("do X on install/uninstall") is left to you, and the exact payload shape is **unconfirmed** —
> `TODO(verify)` it against a real delivery before depending on any field.

## Authenticating the delivery — `requirePeekWebhookAuth`, not `verifyPeekAuthToken`

cng POSTs the **same registry-signed peek-auth JWT** the API pipeline uses, in the `x-peek-auth`
header. But **do not reuse the library's `verifyPeekAuthToken`** here: that helper assumes a user
context and throws on `user: null`, and **install-status events are system events with no user.**

So the starter verifies the delivery itself against the same secret and scheme —
`lib/webhook-auth.ts` exports **`requirePeekWebhookAuth(request)`**, which checks the signature,
the `app_registry_v2` **issuer**, the `Joken` **audience**, and expiry, while tolerating a null
user. Missing/invalid token → **401**.

```ts
// app/examples/webhooks/install-status/route.ts
import { requirePeekWebhookAuth } from "@/lib/webhook-auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = requirePeekWebhookAuth(request);
  if ("error" in result) return result.error;   // 401 on bad/missing token

  const body = JSON.parse(await request.text()) as InstallStatusPayload;
  // ... react to body.status for body.account.platform === "cng"
  return NextResponse.json({ ok: true });
}
```

## The payload (unconfirmed — `TODO(verify)`)

The shipped type is a best-effort placeholder; confirm against a real delivery:

```ts
type InstallStatusPayload = {
  status?: string;         // e.g. install / uninstall (values TODO(verify))
  install_id?: string;     // the install this event is about — your stable key
  display_version?: string;
  account?: { id?: string; name?: string; platform?: string; is_test?: boolean };
};
```

- **No payload query to register** (unlike Peek's booking webhook, whose payload is shaped by a
  registered field selection). The shape is fixed by the registry, not shaped by a query you provide.
- `account.platform` distinguishes peek / cng / acme on this shared endpoint.
- `account.is_test` flags a test/sandbox account — you may want to skip or branch on it.

## Endpoint rules

- **Authenticating the delivery is YOUR responsibility** — always run `requirePeekWebhookAuth`
  before trusting the body.
- **Acknowledge fast, process safely, be idempotent** — assume at-least-once delivery (generic
  discipline in `webhooks`). Install/uninstall can be redelivered; make handling repeat-safe.
- **Scope any stored data to `installDataId`**, derived from `install_id` (the install ID does not
  rotate — see `cng-backoffice-api`). Install-status is the natural place to hang install-lifecycle
  handling: on install, get-or-create the install record; on uninstall, mint a fresh
  `installDataId` / wipe prior data on the next reinstall (`TODO(verify)` the exact `status`
  values first).
- **To *act* on an event** (call cng in response), build an install-scoped client from the
  `install_id` on the payload — `createCngServiceForInstall(install_id)` (see the server-to-cng
  recipe in `cng-embed-and-auth`). Do **not** use the user-token pipeline — there is no user here.

## Future cng events

If cng later ships event-specific parsers or additional webhooks, they'll appear in the installed
package (types + `docs/webhooks.md`) — introspect it (`javascript-app-utilities`) and pull the live
doc; **don't hand-write or assume a parser that isn't there.** Today, install-status is the only
cng-relevant webhook, and you parse its JSON yourself.

## Related skills

- **`webhooks`** (global) — the generic delivery-verification / idempotency / "state not change"
  model behind this skill (don't re-explain it here).
- **`cng-embed-and-auth`** — the *other* inbound path (peek-auth token API), and the
  `createCngServiceForInstall` recipe to *act* on an event with no user token.
- **`cng-backoffice-api`** — `installDataId` scoping and the cng client used inside a handler.
- **`javascript-nextjs`** (stack) — the route-handler rules (JSON only, no `react-dom/server`).
- **`cng-manifest-and-deploy`** — where the webhook endpoint URL (`app_registry_webhook@v1`) is
  declared in `app.cng.json`.
- **`peek-webhooks`** — Peek's richer webhook story (booking/waiver parsers); a contrast, since
  those parsers **do not** apply to cng.
