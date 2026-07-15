<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Peek Pro iframe embed constraints

The app's main SPA runs inside a Peek Pro iframe.

**NEVER suggest cookies.** Third-party cookie blocking kills them in iframes — a token cannot be persisted or carried across a redirect that way.

The POST flow (`app/peek-pro/main/route.ts`) exists only because `page.tsx` cannot handle POST requests. Peek Pro POSTs the signed JWT as a body param, but the route handler **ignores it and redirects to the GET view** — it does *not* authenticate here. Verifying at this step would be pointless: the token cannot survive the redirect (no cookies), and the GET view is openly reachable anyway. Authentication happens later, in the GET pipeline — the client-side SPA obtains its own token from the parent frame via `postMessage`, and every API request is authenticated by that token (see `lib/with-peek.ts`).

**NEVER use `react-dom/server` in route handlers.** Next.js blocks it at the bundler level. Route handlers that return raw HTML use string templates — that is the correct pattern here, not JSX.

**Odyssey light-DOM slotting:** wrap dynamically/conditionally rendered children of container components (`ody-two-column`, `ody-panel`, `ody-modal`, …) in a stable `<div>` present from the first render — children appended after the element upgrades are not re-slotted and render invisibly (passes lint/typecheck/tests; fails only in a browser). See the `odyssey-ui` skill.

**Keep the MCP tools in sync with new features.** If this app ships an MCP endpoint (`app/peek-pro/mcp` — most apps do; see the `peek-mcp-endpoint` skill), then whenever you add or change a user-facing capability that's meaningful to expose, add or update the matching MCP tool in the *same* change, reusing the same service-layer function the UI uses. A new UI action with no corresponding tool — or a tool left pointing at old behavior — is drift the App Store assistant will act on incorrectly. (Skip only if the app has deliberately no MCP endpoint.)

## Iframe-embedded views are client-side SPAs — Server Components do not apply

Any view rendered inside the Peek Pro iframe is a **client-side SPA**. For those routes, do not reach for Server Components, SSR data fetching, or try to "remove the `"use client"` directives to modernize" — that advice is correct for normal Next.js apps but wrong here, and the reason is architectural, not stylistic.

**Why SSR can't participate:** The app can do nothing until it receives a JWT from the parent frame via `postMessage`. That token only ever exists in the browser — there is no server-side equivalent, and it isn't available at SSR/RSC render time. Without it no API call can be authenticated, so a Server Component has nothing to fetch and nothing to render. The token gate, not preference, is what forces client rendering.

**How to build an embedded view like this:**

1. **One token bootstrap, at the top.** Pick a single mount point for the subtree (a layout, or a root client component) and let it own the handshake: post the token-request message to the parent (`window.parent.postMessage(...)`), listen for the response, hand the token to whatever holds it (a module-level setter, a context provider, a store), then render children only once it has arrived. Everything below assumes the token exists.

2. **Exactly one requester per mount.** Do not scatter `postMessage` token requests across layouts and pages. Multiple listeners race, and the parent gets duplicate requests. If a descendant needs the token, read it from the shared holder — don't ask the parent again. A token *refresh* path (e.g. after a 401) is fine, but it should be the same single channel, not a second bootstrap.

3. **Fetch in the client, after the gate.** Page components fetch in `useEffect` (or your client data layer) through a helper that attaches the token as a Bearer header. This is the correct pattern for embedded SPAs — it is *not* the "fetch-on-mount instead of Server Components" anti-pattern, because there is no server-side alternative available. Centralize the fetch + auth-header + 401-refresh logic in one helper rather than re-implementing per page.

4. **Keep server-side auth library-owned.** Route handlers that verify the token should delegate to the auth library rather than decoding/validating JWTs by hand. Construct the install/tenant-scoped service from the *verified token's* claims, not from static env values, so each request is scoped to the caller it actually came from.

These are the load-bearing decisions; the specific file names, message types, and helper names will differ per app built on this starter.
