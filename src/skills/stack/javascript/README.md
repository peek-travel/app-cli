# stack/javascript

The JavaScript/TypeScript tech stack the CLI scaffolds. Shared across **all** platforms
(peek/cng/acme) — a future cng- or acme-on-JavaScript app reuses these skills as-is.

## ⚠️ Runtime: Node.js is REQUIRED — this is not "any JavaScript"

This stack targets the **Node.js runtime, non-negotiably.** The platform SDK,
`@peektravel/app-utilities`, is **Node-only** — its API clients verify the incoming auth token and
**mint the platform's API tokens with Node `crypto`**, which a limited/Edge runtime does not
provide. So:

- **Every route, handler, cron job, or script that touches the SDK must run on the Node runtime**
  — never Edge (`export const runtime = 'edge'` breaks token verification and the SDK). See
  `javascript-app-utilities` and `javascript-nextjs`.
- There is **no browser-only, Deno, Bun, or Workers/edge-only variant** of this stack while the SDK
  is Node-only — a JS app on this platform is a **Node** app. That's why "Node" is a *requirement*
  of this stack, not a separate stack: it's constant across every JS app the SDK permits.

If you scaffold or deploy anywhere, confirm the target provides a full Node.js runtime.

## What this stack is

| Layer | Choice |
| --- | --- |
| **Runtime** | **Node.js (required)** |
| **Language** | TypeScript |
| **Framework** | Next.js 16 (App Router) + React 19 — see `javascript-nextjs` |
| **Styling** | Tailwind CSS v4 (`app/globals.css` + `postcss.config.mjs`) |
| **Platform SDK** | `@peektravel/app-utilities` (Node-only) — see `javascript-app-utilities` |
| **UI** | Odyssey web components (ship inside the SDK) — see `javascript-odyssey-ui` / `javascript-typings` |
| **Tests** | Vitest — see `javascript-testing` |

> Versions above reflect the current kit; treat the installed `package.json` / `node_modules` as
> the source of truth (these are **not** the Next.js/React you may remember — see `javascript-nextjs`).

## Skills in this folder

- `app-utilities/` — the SDK package + how to introspect it for the selected platform (Node-only).
- `nextjs/` — Next.js App Router conventions, route handlers, the client-SPA/token-gate pattern,
  Node-vs-Edge runtime, CSP.
- `odyssey-ui/` — the shared Odyssey design theme (`<ody-*>` components), plus `mockup-template.html`.
- `typings/` — typing custom elements for React/TSX (`CustomEl`, one-declaration-file rule).
- `testing/` — Vitest wiring, coverage, the CI gate.

These are the **stack** layer. The generic concepts live in `global/*`; the platform specifics live
in `platform/<platform>/*`. A finished app composes one of each.
