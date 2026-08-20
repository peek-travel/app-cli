# Examples

Optional, working demonstrations of things you can build on this starter kit.
None of them are wired into the app's main flow — delete a folder entirely if
you don't need it, no other cleanup required.

Each example owns its own UI *and* its own API routes, colocated under the
same folder, so deleting the folder removes both. The one exception is
`app/examples/peek-pro/main/api/activities` — the welcome page
(`app/examples/peek-pro/main/view/page.tsx`) depends on it directly to prove the Peek
Pro connection works, so it lives with the main app and stays even if you
delete every example.

## dashboard

A multi-tab dashboard (overview / bookings / activities) showing stats and
recent bookings pulled live from the Peek Pro API.

- UI: `app/examples/dashboard/`
- API: `app/examples/dashboard/api/dashboard`, `app/examples/dashboard/api/bookings`
- To try it, visit `/examples/dashboard` (it does its own token handshake with
  the parent frame, same pattern as the main welcome page).

## webhooks

An inbound webhook endpoint that Peek Pro POSTs to on install-lifecycle events
(installed / uninstalled / updated). The delivery carries a signed
`app_registry_v2` JWT (in the `x-peek-auth` header) plus a JSON body;
`parseInstallWebhook` from `@peektravel/app-utilities` verifies the token and
merges both into one flat `InstallWebhook`, so a bad delivery is a single
`try/catch` → 401. For now it just logs the delivery — add real
provisioning/teardown in the status `switch`.

This is the only place the app learns **who an install belongs to and where to
call it**: persist the identity (key permanent data on `accountId`), and — once
you add a DB — persist each install's **`apiUrl`** and build that install's
back-office client against it, refreshing it on every event (an
`update_installed` can move it). Until then the per-request client uses the
app-level `PEEK_API_URL`.

- Route: `app/examples/webhooks/install-status/route.ts`
- Point the app's install-status webhook URL at
  `/examples/webhooks/install-status` to receive deliveries.
