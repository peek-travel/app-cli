---
name: javascript-testing
description: >-
  The test tooling for JS-stack apps on this kit — Vitest with v8 coverage, colocated __tests__/
  folders, and the lint→typecheck→test→build CI gate. Use when adding tests, running the suite,
  checking coverage, wiring the @/ alias, or debugging CI. This skill is the runner/config and how
  to run it; for WHAT to prioritize testing (auth, webhook state-not-change, ID normalization, install
  scoping, env validation), see the generic testing skill. Triggers on "test", "tests", "vitest",
  "vitest.config", "coverage", "test:coverage", "add a test", "CI failing", "run the tests",
  "@/ alias in tests", "how do I run the suite".
---

# Testing JS-stack apps (Vitest)

This starter kit ships a **Vitest** suite with **v8 coverage**, and CI runs it on every branch. This
skill is the **tooling** — the runner, scripts, coverage wiring, and the CI gate. For **what to
prioritize** (the critical logic that goes subtly wrong — auth/token handling, webhook "state, not
change" derivation, ID normalization, install-data scoping, env validation), see the generic
**testing** skill; don't re-derive those priorities here.

## What's already wired

- **Runner:** Vitest (`vitest.config.mts`, `vite-tsconfig-paths` so the `@/` path alias resolves in
  tests too).
- **Scripts** (`package.json`): `pnpm test` (run once), `pnpm test:watch`, `pnpm test:coverage`.
- **Coverage:** `@vitest/coverage-v8` (`pnpm test:coverage` → `coverage/`).
- **Colocated tests** live in `__tests__/` folders next to the code they cover (`lib/__tests__/`,
  `app/.../__tests__/`, …) — so **deleting a feature folder removes its tests too**. Follow that
  convention: put a feature's tests beside the feature, not in a top-level `test/` tree.
- **Learn the patterns from the shipped tests.** The kit already ships worked examples of the
  hardest cases — copy their shape: `lib/__tests__/api-auth.test.ts`, `lib/__tests__/with-peek.test.ts`,
  `lib/__tests__/peek-service.test.ts` (token verification + the 401 pipeline),
  `lib/app-client/__tests__/api.test.ts` (the client 401→refresh→retry path), and
  `lib/__tests__/env.test.ts` (env validation). Read these before writing new auth/webhook tests.
- **CI** (`.github/workflows/ci.yml`): **lint → typecheck → test w/ coverage → build** on every
  branch; coverage uploaded as an artifact. Keep all four green.

## Coverage discipline

- Target **≥90% line coverage** with meaningful tests — don't pad with trivial ones, and don't leave
  the critical logic (see the generic `testing` skill) uncovered just because the number looks fine.
- **Report the actual number** when you finish work (`pnpm test:coverage`).
- CI already runs lint + typecheck + test + build, so **run all four locally before pushing**:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
  ```
  A red CI blocks the deploy on `main`. (Note `pnpm build` runs a real `next build`, which
  type-checks in its own pass and catches errors `tsc` misses — see `javascript-nextjs` /
  `javascript-typings`.)

## Related skills

- **testing** — the generic priorities: *what* to test (auth/token handling, webhook state-not-change
  derivation, ID normalization, install-data scoping, env validation) and the coverage philosophy.
  This skill is the JS runner that executes them.
- **peek-embed-and-auth**, **peek-backoffice-api**, **peek-webhooks**, **peek-mcp-endpoint** — the
  platform logic these tests should cover (canonical example; cng/acme mirror it).
- **javascript-nextjs** — the `next build` step in the gate and why it type-checks beyond `tsc`.
- **manifest-and-deploy** — CI is the gate before deployment.
