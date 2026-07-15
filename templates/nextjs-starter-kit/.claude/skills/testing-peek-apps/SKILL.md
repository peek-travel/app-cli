---
name: testing-peek-apps
description: >-
  How to test an app built on this starter kit and keep the suite meaningful — the Vitest setup
  already wired here, what to prioritize (auth/token handling, webhook state-not-change
  derivation, ID normalization, installDataId scoping), and the coverage discipline enforced in
  CI. Use when adding tests, running the suite, debugging a failing test, checking coverage, or
  deciding what to cover for new Peek logic. Triggers on "test", "tests", "vitest", "coverage",
  "test:coverage", "add a test", "CI failing", "what should I test".
---

# Testing Peek apps

This starter kit ships a **Vitest** suite with **v8 coverage**, and CI runs it on every branch.
The goal is meaningful coverage of the **critical Peek logic**, not a number chased with empty
tests.

## What's already wired

- **Runner:** Vitest (`vitest.config.mts`, `vite-tsconfig-paths` for the `@/` alias).
- **Scripts** (`package.json`): `pnpm test` (run once), `pnpm test:watch`, `pnpm test:coverage`.
- **Coverage:** `@vitest/coverage-v8` (`pnpm test:coverage` → `coverage/`).
- **CI** (`.github/workflows/ci.yml`): **lint → typecheck → test w/ coverage → build** on every
  branch; coverage uploaded as an artifact. Keep all four green.
- **Existing tests** live in `__tests__/` folders next to the code (`lib/__tests__/`,
  `app/peek-pro/.../__tests__/`, `app/examples/dashboard/.../__tests__/`) — colocated, so
  deleting a feature folder removes its tests too. Follow that convention.

## Prioritize the critical Peek logic

Coverage of glue code is cheap; coverage of the logic that goes subtly wrong is what matters.
Test these especially — most bugs in Peek apps hide here:

- **Auth / token handling** — token verification accepts valid tokens and rejects
  missing/expired/wrong-signature ones; the API pipeline returns 401 correctly
  (`lib/__tests__/api-auth.test.ts`, `with-peek.test.ts`, `peek-service.test.ts` show the
  pattern). The client 401→refresh→retry path (`app/peek-pro/client/__tests__/api.test.ts`).
- **Webhook "state, not change" derivation** — given repeated deliveries of the same booking,
  your new-vs-seen logic fires **once**; a changed field is detected by comparing stored vs.
  incoming. This is the single easiest thing to get wrong. See `peek-webhooks`.
- **ID normalization** — `B-123ABC` → `b_123abc`, display ↔ internal, and that keys built from
  normalized IDs actually match. See `peek-backoffice-api`.
- **`installDataId` scoping** (if you add persistence) — records are written/read under the
  current `installDataId`; a reinstall (new `installDataId`) doesn't see stale data.
- **Env validation** — required vars fail loudly, defaults apply (`lib/__tests__/env.test.ts`).

Prefer testing **behavior over implementation**. Parsers return empty fields rather than
throwing, so test that your handler **validates the fields it depends on** rather than assuming
the parser guarantees them.

## Coverage discipline

- Target **≥90% line coverage** with meaningful tests — don't pad with trivial ones, and don't
  leave the critical logic above uncovered just because the number looks fine.
- Report the actual number when you finish work (`pnpm test:coverage`).
- Since CI already runs lint + typecheck + test + build, **run all four locally before pushing**
  (`pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`) — a red CI blocks the
  deploy on `main`.

## Related skills

- **peek-embed-and-auth**, **peek-backoffice-api**, **peek-webhooks** — the logic these tests
  should cover.
- **peek-app-manifest-and-deploy** — CI is the gate before deployment.
