---
name: javascript-typings
description: >-
  How to type custom elements (web components like Odyssey's <ody-*>) for React/TSX by augmenting
  JSX.IntrinsicElements. Use when adding or editing a custom-element declaration, when a JSX
  attribute or ref on a custom element won't type-check, or when tsc passes but next build fails on
  element typings. Covers the one-declaration-file rule (and the skipLibCheck silent-conflict trap),
  the CustomEl base pattern that includes ref/key, and validating with a real next build rather than
  tsc alone. Triggers on "JSX.IntrinsicElements", "elements.d.ts", "custom element typings",
  "CustomEl", "ody-* attribute not working", "ref on a custom element", "next build type error",
  "web component typings", "declare a custom element in TSX".
---

# Typing custom elements for React/TSX

Custom elements (web components) have no built-in JSX types, so React/TSX complains unless you
**augment `JSX.IntrinsicElements`** with a declaration for each element. This is generic web-
component typing — it works for any `<custom-tag>` library — but the **primary consumer here is
Odyssey's `<ody-*>` components** (see `javascript-odyssey-ui`).

## One declaration file — the `skipLibCheck` silent-conflict trap

**Augment `JSX.IntrinsicElements` in exactly one file.** In this kit that file is
`lib/odyssey/elements.d.ts`. **One element, one declaration** — never a second file that also
declares the same keys.

> Earlier this kit split these across two files (`env.d.ts` + `types/odyssey-elements.d.ts`) with
> overlapping keys. Because `tsconfig.json` sets `skipLibCheck: true`, TS **silently let the
> declarations conflict**, and an attribute added to the "losing" file compiled cleanly and did
> **nothing**. That trap is gone — everything lives in `lib/odyssey/elements.d.ts` now. Keep it that
> way: **do not** reintroduce a second file that declares the same custom-element keys.

**Rules:**
- **One home.** Add or edit every custom-element declaration in the single `*.d.ts`
  (`lib/odyssey/elements.d.ts` here).
- **Adding a brand-new element?** Add one entry, using the `CustomEl` base (below):
  ```ts
  'ody-button': CustomEl<{ variant?: 'primary' | 'secondary'; disabled?: boolean }>;
  ```
- Consult the component's live docs for its real attributes (for Odyssey, `ui.md` — see
  `javascript-odyssey-ui`).

## Use a base type that includes `ref` (and `key`) — the `CustomEl` pattern

Type every custom element with the **`CustomEl`** base the declaration file already defines — it is
the correct base, **not** bare `HTMLAttributes`:

```ts
type CustomEl<Extra = object> =
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Extra;

// e.g.
'ody-datepicker': CustomEl<{ /* scalar attributes… */ }>;
```

`DetailedHTMLProps<…>` layers **`ref`** and **`key`** on top of the plain attributes. Bare
`HTMLAttributes<HTMLElement>` has **neither** — most importantly, **no `ref`**. That's a real trap:
many custom elements are driven **through a ref** — you set rich array/object props and attach
`CustomEvent` listeners on the element instance (datepicker, tabs, table, anything with non-scalar
props/events — see "Rich data → JS properties" in `javascript-odyssey-ui`). Type such an element
with bare `HTMLAttributes` and `<ody-datepicker ref={r}>` has **no typed `ref`** — an error that can
**slip past a local/incremental `tsc` yet fail the next clean build**. Always use `CustomEl` so
`ref`/`key` are present, regardless of whether the element takes rich props today.

## Validate with a real `next build`, not just `tsc --noEmit`

> In practice `tsc --noEmit` **passed** while `next build` **failed** on exactly this `ref` typing.
> Next regenerates `.next/types` and type-checks the app in its **own** pass, so it catches
> custom-element typing errors a bare `tsc` misses. After any custom-element typing change, run
> `next build` (or let CI) before trusting it — don't rely on `tsc` alone.

## Related skills

- **javascript-odyssey-ui** — the primary consumer of these typings; where the `<ody-*>`
  components, `CustomEl` file, and attribute/property/event conventions live.
- **javascript-nextjs** — why `next build` type-checks differently than `tsc` (the `.next/types`
  regeneration), and the rest of the framework's build behavior.
