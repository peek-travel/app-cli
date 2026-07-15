# Peek Pro app plan — <app name>

> Copy this into the project (e.g. `PLAN.md`), fill it in during step 3, and use it to get
> sign-off in step 4. Replace every `<…>` and resolve every `TODO(verify)` before building.
> The stack is fixed by this starter kit, so there is no stack-selection section.

## 1. Summary
- **What it does:** <one-line purpose>
- **Who uses it:** <account staff / guests / app admin>
- **Trigger(s):** <webhook event(s) / schedule / user action>

## 2. Peek integration (confirm against the installed package — mark `TODO(verify)` if not found)
- **Webhooks/events consumed:** <event names + payload fields> — check `@peektravel/app-utilities` `docs/webhooks.md` + types · see `peek-webhooks`
- **SDK calls made:** <`PeekAccessService` methods> — check `@peektravel/app-utilities` `dist/index.d.ts` · see `peek-backoffice-api`
- **Resources touched:** <products/activities · availability · bookings · orders · payments · customers>
- **Auth:** identity from the peek-auth token via the API pipeline (NO own login). See `peek-embed-and-auth`.

## 3. Surfaces
- **Embedded (in Peek Pro):** <what the installing account / guests see>
- **Admin (optional, developer-owned):** <installs, logs, ops — may have its own auth>

## 4. Data flow (verify EVERY Peek-sourced item — no assumptions)
For each piece of data the app needs, map source → when → storage → and confirm it's actually
available via the SDK / webhook payload / npm model. Don't list a field you haven't verified.

| Data item | Source (SDK call · webhook field · app-derived) | When (webhook / user action / schedule) | Stored where (if persisted) | Verified available? |
| --- | --- | --- | --- | --- |
| <e.g. guest count> | <booking webhook → parseBookingWebhook → guests> | on booking webhook | <table.field or "in-memory only"> | ⬜ verify in package types/`docs/` |

> Any row not marked verified must be resolved (find the real source or change the design)
> **before sign-off**. An app built on assumed-but-absent data won't work.

## 5. Hosting & persistence
- **Host:** <recommended default: **Vercel** — or the chosen host>
- **Database:** <none for Phase 0 — or **Neon (serverless Postgres)**, server-side only, if persistence is needed>
- **Real-time (if any):** <polling / SSE from your own API routes — or N/A>

Phase 0 ships no DB. If this app needs one:
- `installDataId = installId + installTimestamp`; store `currentInstallDataId` on the account
  object; **scope all records to `installDataId`**, keyed on **normalized** booking/order IDs.
- **Entities:** <tables/collections + fields>
- **PII handling:** <what is stored vs. referenced by Peek ID; encryption; retention>

## 6. Security
- Secrets in the host's secret store (Vercel env vars by default; Neon `DATABASE_URL`
  server-only) — never in the repo or client bundle. See `peek-app-manifest-and-deploy`.
- Webhook delivery verification (you verify it — scheme: see `@peektravel/app-utilities` `docs/webhooks.md` + types); idempotent handlers.
- No PII or tokens in logs.

## 7. Setup the user must do (drives step 6)
- [ ] Peek **Development Hub** access + app registration (app ID + `PEEK_APP_SECRET`)
- [ ] Host project (Vercel by default) created + env/secrets set
- [ ] Database (Neon) project + `DATABASE_URL` — only if the plan needs persistence
- [ ] <any other API keys the plan calls for>

## 8. v1 scope (and explicit non-goals)
- **In:** <…>
- **Out (later):** <…>

## 9. Open questions / risks
- <anything to confirm with the user or the Peek team>
