# App-building skills — source of truth

These are the Claude skills that teach an agent how to build an app on this CLI's starter kits.
They're organized on **three orthogonal axes** so the same knowledge can be composed for any
platform + tech stack the CLI supports.

> **Delivery note (current state):** this tree is the **authoring source of truth**. It is not yet
> wired into `peek init` — the `templates/nextjs-starter-kit/.claude/skills/` copy is still what
> ships into scaffolded apps. A follow-up will teach the CLI to compose
> `global + platform/<platform> + stack/<stack>` into each scaffolded app's `.claude/skills/`.
> Until then, skills live in two places; edit *here*.

## The three axes

| Axis | Folder | Holds | Example |
| --- | --- | --- | --- |
| **global** | `global/` | The generic, self-standing solution — true for **any** platform or stack. Written to stand on its own, then links **down** to the concrete skills. | "The host owns identity; verify server-side; never build your own login." |
| **platform** | `platform/<peek\|cng\|acme>/` | What's specific to one platform — its auth token, its API client, its registry/manifest, its capability boundary. | peek's `PeekAccessService`, `app.json`, `installId`. |
| **stack** | `stack/<javascript>/` | What's specific to one tech stack — runtime, language, framework, SDK package, test runner — **shared across platforms** on that stack. | `javascript` = **Node.js (required)** + TypeScript + Next.js + `@peektravel/app-utilities` + Vitest. |

> **`stack/javascript` requires the Node.js runtime** — the SDK (`@peektravel/app-utilities`) is
> Node-only, so there is no non-Node JS variant. Node is a *requirement* of the stack, not a
> separate stack. See `stack/javascript/README.md`.

A finished app is built from **one of each**: e.g. `global` + `platform/peek` + `stack/javascript`.

## Naming & cross-links

- `global/<x>` → frontmatter `name: <x>` (e.g. `embed-and-auth`)
- `platform/peek/<x>` → `name: peek-<x>` (e.g. `peek-embed-and-auth`)
- `stack/javascript/<x>` → `name: javascript-<x>` (e.g. `javascript-app-utilities`)

Skills reference each other by these names. Global skills link down to their platform/stack
counterparts; platform/stack skills link up to the global concept.

## A note on `@peektravel/app-utilities`

The JS SDK package is a **stack** concern (`stack/javascript/app-utilities`) — it serves **all**
platforms (peek/cng/acme). But **its API surface differs per platform and evolves per version**
(e.g. GraphQL is peek-only). Skills never hardcode a platform's capabilities: the stack skill says
*how* to introspect the installed package, the platform skill states the *capability boundary*, and
the `app-builder` orchestrator makes verifying-against-the-installed-package a plan-time gate. See
`SKILLS-REFACTOR-RECOMMENDATION.md` for the full rationale.
