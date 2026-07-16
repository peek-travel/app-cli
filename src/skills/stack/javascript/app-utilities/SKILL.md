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

## Related skills

- **backoffice-data** — the generic discipline: official SDK only (never raw HTTP/GraphQL),
  capabilities are platform/version-specific — discover them from the installed SDK, never assume.
- **peek-backoffice-api** — the canonical **capability boundary**: which client peek exposes, its
  methods, and its GraphQL last-resort (cng/acme mirror this file when they have content). This
  skill's introspection method feeds it.
- **javascript-odyssey-ui** — the Odyssey UI theme that ships inside this same package.
- **javascript-nextjs** / **peek-mcp-endpoint** — where the Node-only constraint forces the Node
  runtime.
