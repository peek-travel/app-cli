---
name: testing
description: >-
  Testing discipline for an app built on this kit — what to prioritize (the critical integration
  logic where bugs hide: auth/token handling, webhook "state not change" derivation, ID
  normalization, per-install data scoping, env validation), preferring behavior over
  implementation, coverage discipline, and running the full local gate before pushing. Use when
  adding tests, running the suite, debugging a failing test, checking coverage, or deciding what to
  cover. Triggers on "test", "tests", "coverage", "add a test", "CI failing", "what should I test".
---

# Testing the app

The goal is **meaningful coverage of the critical integration logic**, not a number chased with
empty tests. Coverage of glue code is cheap; coverage of the logic that goes subtly wrong is what
matters — and in an app like this, the bugs hide in a small, predictable set of places. **Peek Pro
is the canonical example** for what platform logic to cover; the concrete runner/config lives in
your stack's testing skill (`javascript-testing`).

## Prioritize the critical integration logic

Test these especially — most bugs in apps like this hide here:

- **Auth / token handling.** Verification **accepts a valid token** and **rejects missing / expired /
  wrong-signature** ones; the API pipeline returns **401** on a bad token; the **config error → 500**
  path is distinct from the 401 (a misconfig must not masquerade as a bad token — see
  `embed-and-auth`); and the client **401 → refresh → retry** path fires once and recovers.
- **Webhook "state, not change" derivation.** Given **repeated deliveries** of the same item, your
  new-vs-seen logic fires **exactly once** (also proving idempotency against redelivery); a **changed
  field** is detected by comparing stored-vs-incoming. This is the single easiest thing to get wrong —
  see `webhooks`.
- **ID normalization.** Display ↔ canonical (e.g. `B-123ABC` → `b_123abc`), and that keys built from
  normalized IDs **actually match**. See `backoffice-data`.
- **Per-install data scoping** (if you add persistence). Records are written/read under the current
  per-install data key; a **reinstall (new key) doesn't see stale data**. See `backoffice-data`.
- **Env validation.** Required vars **fail loud**; defaults apply. A missing required var must be a
  boot-time failure, not a silent 401 later.

## Prefer behavior over implementation

Test **what the code does**, not how it's wired. In particular, because platform webhook parsers
often **return empty fields rather than throwing** on bad input, test that your handler **validates
the fields it depends on** rather than assuming the parser guarantees them. Assert on observable
behavior (the 401, the single fire, the matched key), so a refactor that preserves behavior doesn't
break the suite.

## Coverage discipline

- Aim for **meaningful** coverage and a **high line-coverage bar** — don't pad with trivial tests,
  and don't leave the critical logic above uncovered just because the number looks fine.
- **Report the real number** when you finish work (run the coverage script).
- **Run the full local gate before pushing** — lint → typecheck → test w/ coverage → build — the
  same gate CI runs on every branch. A red CI blocks the deploy. The concrete commands and config are
  your stack's concern (see `javascript-testing`).

## Related skills

- `javascript-testing` — the concrete stack wiring: the test runner and its config, path aliases,
  coverage tooling, colocated test folders, and the CI workflow.
- `embed-and-auth`, `backoffice-data`, `webhooks` — the logic these tests should cover (auth/token,
  ID normalization + scoping, "state not change" derivation).
- `peek-embed-and-auth`, `peek-backoffice-api`, `peek-webhooks` — the canonical platform specifics of
  *what* to cover (the exact token claims, ID formats, and event shapes).
- `manifest-and-deploy` — CI is the gate before deployment.
