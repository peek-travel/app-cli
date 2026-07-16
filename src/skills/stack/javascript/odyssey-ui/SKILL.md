---
name: javascript-odyssey-ui
description: >-
  Build UI with Odyssey, the shared app design theme of framework-agnostic <ody-*> web components
  shipped inside @peektravel/app-utilities. Use when adding or styling any embedded view, rendering
  Odyssey components in React, wiring the OdysseyLoader, finding icon names, or generating an
  interactive HTML mockup for design sign-off. Covers the npm vs CDN include paths, the
  attribute/property/event conventions, the light-DOM slotting gotcha, and pulling the live
  component docs. For typing <ody-*> elements in TSX, see javascript-typings. Triggers on "Odyssey",
  "ody-button", "ody-*", "Peek UI", "component", "style the app", "mockup", "design the view",
  "OdysseyLoader", "ody-icon", "icon name", "iconNames", "brand icon", "which icons are available",
  "ody-* attribute not working".
---

# Odyssey UI — the shared design theme

Apps that render UI should use **Odyssey** so they look and feel native to the platform. Odyssey is
the **shared app design theme**: **framework-agnostic web components** (`<ody-*>` tags) that ship
inside **`@peektravel/app-utilities`** (see `javascript-app-utilities`). They use light DOM, are
dependency-free, and work in React (as here), Vue, Angular, Svelte, or vanilla HTML. This starter
kit already wires them into the embedded views.

> **Provenance:** Odyssey is **Peek-derived** and is **rolling out as the shared theme across the
> other platforms** (cng, acme); it **may fork per-platform later**. For now treat it as the one
> shared theme for every JS-stack app — a cng/acme app on this stack uses the same components until
> a platform-specific fork actually exists.

## Always load the live component docs first

Odyssey evolves — **do not rely on memory for component names/attributes.** Fetch and read the
current docs before building UI:

```
https://cdn.jsdelivr.net/npm/@peektravel/app-utilities/docs/ui.md
```

(Or read the installed copy's `docs/ui.md` / `dist/ui/index.d.ts` — see `javascript-app-utilities`
for introspecting the package.) `ui.md` lists every component, its tag, attributes, and usage
conventions. It is intentionally kept out of this skill so it can't go stale.

## How this starter kit includes Odyssey (npm — the default)

The embedded views load Odyssey through the npm package, in two pieces. Both live in the shared
`lib/odyssey/` module (used by every example — peek-pro, cng, …):

1. **CSS + registration, in the shared view shell** (`lib/odyssey/SettingsViewLayout.tsx`):
   ```ts
   import { OdysseyLoader } from '@/lib/odyssey/OdysseyLoader';
   import '@peektravel/app-utilities/ui/tokens.css';
   import '@peektravel/app-utilities/ui/odyssey.css';
   ```
   Each example's `app/.../main/view/layout.tsx` just re-exports this shell, so Next still finds a
   layout in the route tree.
2. **Component registration, client-side only** — via `OdysseyLoader`
   (`lib/odyssey/OdysseyLoader.tsx`), which dynamically imports the elements in a `useEffect` so
   custom elements upgrade **after** React hydration (avoiding hydration mismatches):
   ```ts
   'use client';
   useEffect(() => { import('@peektravel/app-utilities/ui'); }, []);
   ```

**To render Odyssey in a new view:** use the shared `SettingsViewLayout` (or, for a bespoke shell,
mount `<OdysseyLoader />` and import the two CSS files — copy the dashboard example's `layout.tsx`).
Then use `<ody-*>` tags in your `"use client"` components.

> **Typing `<ody-*>` for React/TSX** (augmenting `JSX.IntrinsicElements`, the `CustomEl` base, the
> one-declaration-file rule, and validating with a real `next build`) is its own concern — see
> **javascript-typings**. That's generic custom-element typing; Odyssey is its primary consumer.

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

Odyssey ships **two** icon sets, each with its own element and lookup function (both documented in
`@peektravel/app-utilities`'s `dist/ui/index.d.ts` and `docs/ui.md`):

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
element upgrades**, and do **not** re-slot children a framework appends *afterward*. So a child you
render **conditionally** (`{open && <Detail/>}`) directly inside such a component can stay
**invisible** — the element upgraded with that child absent and never picked it up.

The tell: content that's present on first render works, but content added later (on click, after a
fetch, on selection) shows up in React's tree yet never appears on screen. Lint/typecheck/tests all
pass — this only reproduces in a real browser.

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
> the Odyssey source. If a given container component *does* observe late-added children (e.g. via a
> `MutationObserver`/slot), it won't have this problem; when in doubt, verify in a real browser.

## Theming / tokens

Override design tokens in CSS rather than hardcoding brand colors: `--color-<name>-<shade>` (e.g.
`--color-interaction-300`), typography `--ody-font-family` / `--ody-font-weight-*`, layout
`--layout-top-bar-height`, `--ody-shadow-base`. Some components accept inline color via attributes
(e.g. `bar-color="var(--color-success-300)"`).

## The mockup workflow (step 2 of the build)

Before building the real UI, make the design concrete with an **interactive single-file
`index.html` mockup** the user can click through — iterate until they're happy.

1. Copy `mockup-template.html` (in this folder) into the project as `index.html`. It wires the
   **CDN** Odyssey includes (mockups are standalone, so CDN — not the npm package) and scaffolds
   `<ody-page-container>` + an `<ody-tabs>` variant area.
2. Build the proposed UI in it from what you've learned; tell the user to open it in a browser and
   react.
3. Collect feedback one question at a time; revise. **When unsure about a layout/flow, render
   multiple variants in the *same* file** (wrap each in a tab) so the user compares directly, then
   collapse to the chosen direction.
4. Repeat until satisfied — the agreed mockup feeds the real build.

> If `ui.md` is unreachable, say so and fall back to clean, neutral, accessible HTML — do **not**
> invent `ody-*` attributes; re-skin with Odyssey later.

## Still open / `TODO(verify)`

- Brand assets beyond the component set (logo usage), and any layout conventions specific to
  embedded vs. admin surfaces.
- Accessibility requirements the platform mandates for published apps.
- Whether/when Odyssey forks per-platform (peek vs. cng vs. acme) — treat as one shared theme until
  it does.

## Related skills

- **javascript-app-utilities** — the SDK package Odyssey ships inside; how to introspect it for the
  live component docs and icon helpers.
- **javascript-typings** — typing `<ody-*>` elements for React/TSX (the material this skill points
  to for JSX/`CustomEl`).
- **app-builder** — step 2 (mockup) and step 5 (build the real UI) both drive this skill.

## Artifacts in this folder

- `mockup-template.html` — single-file Odyssey (CDN) starter for the mockup loop.
