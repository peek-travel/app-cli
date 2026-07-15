---
name: odyssey-ui
description: >-
  Build UI that looks native to Peek Pro using Odyssey, Peek's design system of framework-
  agnostic <ody-*> web components (from @peektravel/app-utilities). Use when adding or styling
  any embedded view, rendering Odyssey components in React, wiring the OdysseyLoader, typing a
  new <ody-*> element, or generating an interactive HTML mockup for design sign-off. Covers the
  npm vs CDN include paths, the attribute/property/event conventions, and pulling the live
  component docs. Triggers on "Odyssey", "ody-button", "ody-*", "Peek UI", "component",
  "style the app", "mockup", "design the view", "JSX.IntrinsicElements", "odyssey-elements.d.ts",
  "env.d.ts", "ody-* attribute not working", "custom element typings", "ody-icon", "icon name",
  "iconNames", "brand icon", "which icons are available".
---

# Odyssey UI — Peek's design system

Apps that render UI should use **Odyssey** so they look and feel native to Peek Pro. Odyssey
ships **framework-agnostic web components** (`<ody-*>` tags) via `@peektravel/app-utilities`.
They use light DOM, are dependency-free, and work in React (as here), Vue, Angular, Svelte, or
vanilla HTML. This starter kit already wires them into the embedded views.

## Always load the live component docs first

Odyssey evolves — **do not rely on memory for component names/attributes.** Fetch and read the
current docs before building UI:

```
https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/docs/ui.md
```

It lists every component, its tag, attributes, and usage conventions. (Intentionally kept out
of this skill so it can't go stale.)

## How this starter kit includes Odyssey (npm — the default)

The embedded views load Odyssey through the npm package, in two pieces:

1. **CSS, in a layout** (`app/peek-pro/main/view/layout.tsx`):
   ```ts
   import '@peektravel/app-utilities/ui/tokens.css';
   import '@peektravel/app-utilities/ui/odyssey.css';
   ```
2. **Component registration, client-side only** — via `OdysseyLoader`
   (`app/peek-pro/main/OdysseyLoader.tsx`), which dynamically imports the elements in a
   `useEffect` so custom elements upgrade **after** React hydration (avoiding hydration
   mismatches):
   ```ts
   'use client';
   useEffect(() => { import('@peektravel/app-utilities/ui'); }, []);
   ```

**To render Odyssey in a new view:** put `<OdysseyLoader />` in the view's layout and import
the two CSS files there (copy `view/layout.tsx` or the dashboard example's `layout.tsx`). Then
use `<ody-*>` tags in your `"use client"` components.

## Typing `<ody-*>` elements for React/TSX — mind the TWO declaration files

Custom elements need JSX typings or TS complains. **This kit augments React's
`JSX.IntrinsicElements` in _two_ different files**, in two different styles — and that overlap
has caused a real, silent bug. Know both before you add or edit a type:

| File | Style | Role |
| --- | --- | --- |
| `app/peek-pro/client/env.d.ts` | `CustomEl<…>` = `DetailedHTMLProps<HTMLAttributes<HTMLElement>, …> & Extra` | **Authoritative.** For any element declared in both files, **this is the declaration that takes effect.** |
| `types/odyssey-elements.d.ts` | `HTMLAttributes<HTMLElement> & { … }` (richer literal unions, **but no `ref`/`key`** — see below) | Augments the same interface; **loses** to `env.d.ts` for any key they share. |

**These elements are declared in BOTH files** — for them, `env.d.ts` wins:
`ody-alert`, `ody-button`, `ody-card`, `ody-copy-button`, `ody-divider`, `ody-empty-state`,
`ody-loading-spinner`, `ody-message`, `ody-status-dot`, `ody-tag`.

**Why it's silent:** `tsconfig.json` has `skipLibCheck: true`, so TS does **not** flag the
duplicate/conflicting declarations across the two `.d.ts` files. Add an attribute to the *losing*
file's entry and it compiles cleanly and does **nothing** — the winning declaration is what the
JSX actually sees. (This is exactly the trap: a prop added to `types/odyssey-elements.d.ts` for,
say, `ody-button` silently has no effect because `env.d.ts` owns that key.)

**Rules:**
- **Never declare the same `ody-*` key in both files.** One element, one home — duplicated keys
  are the whole problem.
- **Editing an existing element's attributes?** Change it in the file that actually owns it. If
  the key is in the overlap list above, that's **`env.d.ts`** — editing the other file won't take.
  Verify the change landed (the new prop should type-check / autocomplete on the element).
- **Adding a brand-new element?** Put it in **exactly one** file — prefer `env.d.ts` (the
  authoritative one) so there's no ambiguity. Example (env.d.ts style):
  ```ts
  'ody-button': CustomEl<{ variant?: string; disabled?: boolean }>;
  ```
- Consult the live `ui.md` for that component's real attributes either way.

### Use a base element type that includes `ref` (and `key`)

Type every `<ody-*>` element with the **`CustomEl`** pattern `env.d.ts` already defines — it is
the correct base, not bare `HTMLAttributes`:

```ts
type CustomEl<Extra = object> =
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Extra;

// e.g.
'ody-datepicker': CustomEl<{ /* scalar attributes… */ }>;
```

`DetailedHTMLProps<…>` layers **`ref`** and **`key`** on top of the plain attributes. The bare
`HTMLAttributes<HTMLElement>` used by `types/odyssey-elements.d.ts` has **neither** — most
importantly, **no `ref`**. That's a real trap: many Odyssey components are driven **through a
ref** — you set rich array/object props and attach `CustomEvent` listeners on the element
instance (datepicker, tabs, table, anything with non-scalar props/events; see "Rich data → JS
properties" below). Type such an element with bare `HTMLAttributes` and `<ody-datepicker ref={r}>`
has **no typed `ref`** — an error that can **slip past a local/incremental `tsc` yet fail the next
clean build** (e.g. Next's `.next/types` regeneration in CI). Always use `CustomEl` so `ref`/`key`
are present, regardless of whether the element takes rich props today.

> **Validate JSX / custom-element typings with a real `next build`, not just `tsc`.** In practice
> `tsc --noEmit` passed while `next build` **failed** on exactly this `ref` typing — Next
> regenerates `.next/types` and type-checks the app in its own pass, so it catches errors a bare
> `tsc` misses. After any `<ody-*>` typing change, run `next build` (or let CI) before trusting it.

## Usage conventions (from ui.md)

- **Scalars → attributes:** strings/booleans as HTML attributes
  (`<ody-button variant="primary" left-icon="plus">Add</ody-button>`).
- **Rich data → JS properties:** arrays/objects/functions set on the element object
  (`el.columns = [...]; el.data = [...]`) — not as attributes.
- **Events → `CustomEvent`:** `el.addEventListener(type, e => e.detail)`. In React you can also
  pass handlers like `onClick` for simple cases (see the shipped `view/page.tsx`).
- **Content → light-DOM children:** the component renders your child nodes.
- **Wrap page/settings UI in `<ody-page-container>`** — the standard responsive wrapper
  (~868px narrow / ~1310px wide).

## Finding icon names (`<ody-icon>` and `<ody-brand-icon>`)

Odyssey ships **two** icon sets, each with its own element and lookup function (both documented
in `@peektravel/app-utilities`'s `dist/ui/index.d.ts` and `docs/ui.md`):

- **Themeable line icons** — `<ody-icon name="…">`; names via **`iconNames()`** (also `iconSvg`,
  `hasIcon`). They render in `currentColor`.
- **Brand icons** (logos, illustrations, status art) — `<ody-brand-icon name="…">`; names via
  **`brandIconNames()`** (also `brandIconSvg`, `hasBrandIcon`).

An unknown `name` renders **nothing** (no error) — a wrong name fails silently, so get it right.
**There is no file in the package that *enumerates* the names**: the `.d.ts` only declares the
`iconNames()` / `brandIconNames()` functions (the SVG data lives in the bundle), and `ui.md` just
says "see `iconNames()`." So you have to obtain the list one of the two ways below.

**Pitfall: you can't just call `iconNames()` from a Node script.** Importing
`@peektravel/app-utilities/ui` **registers custom elements on import**, which throws
`ReferenceError: HTMLElement is not defined` under plain Node — the module never finishes loading,
so the function is unreachable. Instead:

1. **Parse the names out of the bundle** (no DOM needed). The data is a readable object in
   `node_modules/@peektravel/app-utilities/dist/ui/index.js` — `ICONS` (themeable) and
   `BRAND_ICONS` (brand), each an `{ "<name>": { viewBox, body } }` map. Extract the keys:
   ```bash
   node -e 'const s=require("fs").readFileSync("node_modules/@peektravel/app-utilities/dist/ui/index.js","utf8");
   console.log([...s.matchAll(/"([a-z][a-z0-9-]*)":\s*\{\s*"viewBox"/g)]
     .map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).sort().join("\n"))'
   ```
2. **Or call the functions in a DOM environment** — run `iconNames()` / `brandIconNames()` in the
   browser (the app itself) or under jsdom/happy-dom, where `HTMLElement` exists.

Prefer these over guessing, and **don't hardcode a list you can't regenerate** — the set changes
between versions (v0.2.5 has ≈175 names across both sets, ≈53 of them brand icons).

**Confirmed to exist today** (v0.2.5, themeable): `check-filled`, `close`, `alert-filled`,
`refresh`, `calendar` — plus common ones like `plus`, `minus`, `check`, `search`, `edit`,
`delete`, `download`, `export`, `info-filled`, `copy`, `link`, `mail`, `user`, `notifications`.

## Dynamically-added children need a stable wrapper (light-DOM gotcha)

These are **light-DOM** components: some (notably container/layout ones like `ody-two-column`,
`ody-two-column-secondary`, `ody-panel`, `ody-modal`) slot their child nodes **once, when the
element upgrades**, and do **not** re-slot children a framework appends *afterward*. So a child
you render **conditionally** (`{open && <Detail/>}`) directly inside such a component can stay
**invisible** — the element upgraded with that child absent and never picked it up.

The tell: content that's present on first render works, but content added later (on click, after
a fetch, on selection) shows up in React's tree yet never appears on screen. Lint/typecheck/tests
all pass — this only reproduces in a real browser.

**Rule: give the component a stable child that's present from the first render, and let your
framework mutate *inside* it.** Wrap dynamic/conditional content in a plain `<div>`:

```tsx
// ❌ ReviewDetail is appended to the custom element only after a click — not re-slotted.
<ody-two-column-secondary>
  <ody-two-column-secondary-header title="Details" />
  {selected && <ReviewDetail item={selected} />}
</ody-two-column-secondary>

// ✅ The <div> is slotted once on upgrade; React owns everything inside it.
<ody-two-column-secondary>
  <ody-two-column-secondary-header title="Details" />
  <div>{selected && <ReviewDetail item={selected} />}</div>
</ody-two-column-secondary>
```

(A list already inside a stable wrapper `<div>` works for the same reason — the wrapper, not the
rows, is what the component slots.) Toggling **attributes** on these components (e.g.
`secondary-open`) is fine; it's dynamically-added **children** that need the wrapper.

> The component list above is illustrative, not exhaustive — it was diagnosed from symptoms, not
> the Odyssey source. If a given container component *does* observe late-added children (e.g. via
> a `MutationObserver`/slot), it won't have this problem; when in doubt, verify in a real browser.

## Theming / tokens

Override design tokens in CSS rather than hardcoding brand colors:
`--color-<name>-<shade>` (e.g. `--color-interaction-300`), typography `--ody-font-family` /
`--ody-font-weight-*`, layout `--layout-top-bar-height`, `--ody-shadow-base`. Some components
accept inline color via attributes (e.g. `bar-color="var(--color-success-300)"`).

## The mockup workflow (step 2 of the build)

Before building the real UI, make the design concrete with an **interactive single-file
`index.html` mockup** the user can click through — iterate until they're happy.

1. Copy `mockup-template.html` (in this folder) into the project as `index.html`. It wires the
   **CDN** Odyssey includes (mockups are standalone, so CDN — not the npm package) and scaffolds
   `<ody-page-container>` + an `<ody-tabs>` variant area.
2. Build the proposed UI in it from what you've learned; tell the user to open it in a browser
   and react.
3. Collect feedback one question at a time; revise. **When unsure about a layout/flow, render
   multiple variants in the *same* file** (wrap each in a tab) so the user compares directly,
   then collapse to the chosen direction.
4. Repeat until satisfied — the agreed mockup feeds the real build.

> If `ui.md` is unreachable, say so and fall back to clean, neutral, accessible HTML — do
> **not** invent `ody-*` attributes; re-skin with Odyssey later.

## Still open / `TODO(verify)`

- Brand assets beyond the component set (logo usage), and any layout conventions specific to
  embedded vs. admin surfaces.
- Accessibility requirements Peek mandates for published apps.

## Related skills

- **peek-embed-and-auth** — the SPA gate the views render inside; where `OdysseyLoader` and the
  layouts live.
- **peek-app-builder** — step 2 (mockup) and step 5 (build the real UI) both drive this skill.

## Artifacts in this folder

- `mockup-template.html` — single-file Odyssey (CDN) starter for the mockup loop.
