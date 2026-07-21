# Platform app plan — <app name>

> Copy this into the project (e.g. `PLAN.md`), fill it in during step 3, and use it to get
> sign-off in step 4. Replace every `<…>` and resolve every `TODO(verify)` before building.
> The platform and stack are fixed by the CLI when it scaffolded this kit, so there is no
> platform- or stack-selection section.

## 1. Summary
- **What it does:** <one-line purpose>
- **Who uses it:** <account staff / guests / app admin>
- **Trigger(s):** <webhook event(s) / schedule / user action>

## 2. Platform integration (confirm against the installed SDK for the selected platform — mark `TODO(verify)` if not found)
- **Webhooks/events consumed:** <event names + payload fields> — confirm in the installed SDK package (types + `docs/`) · see `webhooks`
- **SDK calls made:** <platform SDK client methods> — confirm in the installed SDK package (types) · see `backoffice-data`
- **Resources touched:** <products/activities · availability · bookings · orders · payments · customers>
- **Capabilities confirmed present for THIS platform:** <list each needed method/resource and ✅ once seen in the installed SDK — a capability trivial on one platform may be absent on another>
- **Auth:** identity from the platform's host-delivered token via the API pipeline (NO own login). See `embed-and-auth`.

## 3. Surfaces
- **Embedded (in the platform):** <what the installing account / guests see>
- **Admin (optional, developer-owned):** <installs, logs, ops — may have its own auth>

## 4. Data flow (verify EVERY platform-sourced item — no assumptions)
For each piece of data the app needs, map source → when → storage → and confirm it's actually
available via the SDK / webhook payload / installed model. Don't list a field you haven't verified
in the installed SDK for the selected platform.

| Data item | Source (SDK call · webhook field · app-derived) | When (webhook / user action / schedule) | Stored where (if persisted) | Verified available? |
| --- | --- | --- | --- | --- |
| <e.g. guest count> | <booking webhook → parsed booking → guests> | on booking webhook | <table.field or "in-memory only"> | ⬜ verify in installed SDK types/`docs/` |

> Any row not marked verified must be resolved (find the real source or change the design)
> **before sign-off**. An app built on assumed-but-absent data won't work.

## 5. Hosting & persistence
- **Host:** <the chosen host — any capable host works>
- **Database:** <none — or a serverless-Postgres-style DB, server-side only, if persistence is needed>
- **Real-time (if any):** <polling / SSE from your own API routes — or N/A>

If this app needs a DB:
- Scope every persisted row to a **stable per-install data key** (a get-or-create value derived
  from the install identifier — don't key on a raw install id that survives reinstall). Key rows
  on **normalized** resource IDs. See `backoffice-data`.
- **Entities:** <tables/collections + fields>
- **PII handling:** <what is stored vs. referenced by a platform ID; encryption; retention>
- **`fullCustomerAccess`:** <default `false` (PII off) — the recommendation whenever the app needs
  only aggregate/operational signal; OR `true` + the concrete feature(s) that require PII (customer
  contact / payments / refunds / invoicing / add-ons) and confirmation the install is entitled>. Set
  once at client construction; no per-call override. See `backoffice-data` / `peek-backoffice-api`.

## 6. Security
- Secrets in the host's secret store — never in the repo or client bundle. See `manifest-and-deploy`.
- Webhook delivery verification (you verify it yourself — scheme: confirm in the installed SDK
  package types + `docs/`); idempotent handlers.
- No PII or tokens in logs.

## 7. Setup the user must do (drives step 6)
- [ ] Platform **developer hub** access + app registration (app id + app secret)
- [ ] Host project created + env/secrets set
- [ ] Database project + `DATABASE_URL` — only if the plan needs persistence
- [ ] <any other API keys the plan calls for>

## 8. v1 scope (and explicit non-goals)
- **In:** <…>
- **Out (later):** <…>

## 9. Open questions / risks
- <anything to confirm with the user or the platform team>
