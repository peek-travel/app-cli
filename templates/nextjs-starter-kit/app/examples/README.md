# Examples

Optional, working demonstrations of things you can build on this starter kit.
None of them are wired into the app's main flow — delete a folder entirely if
you don't need it, no other cleanup required.

Each example owns its own UI *and* its own API routes, colocated under the
same folder, so deleting the folder removes both. The one exception is
`app/peek-pro/main/api/activities` — the welcome page
(`app/peek-pro/main/view/page.tsx`) depends on it directly to prove the Peek
Pro connection works, so it lives with the main app and stays even if you
delete every example.

## dashboard

A multi-tab dashboard (overview / bookings / activities) showing stats and
recent bookings pulled live from the Peek Pro API.

- UI: `app/examples/dashboard/`
- API: `app/examples/dashboard/api/dashboard`, `app/examples/dashboard/api/bookings`
- To try it, visit `/examples/dashboard` (it does its own token handshake with
  the parent frame, same pattern as the main welcome page).
