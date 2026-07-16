# platform/cng — Connectngo skills (stub)

No Connectngo-specific skills exist yet. When cng gets platform-specific guidance, mirror the
structure of `platform/peek/`:

- `embed-and-auth/SKILL.md` — how a cng app receives identity and authenticates requests.
- `backoffice-api/SKILL.md` — the cng API client from `@peektravel/app-utilities`, its domain,
  and its **capability boundary** (note: **cng has no GraphQL** — the typed SDK is the hard ceiling;
  if a capability isn't in the SDK for cng, it doesn't exist).
- `webhooks/SKILL.md` — cng's inbound events, if any.
- `mcp-endpoint/SKILL.md` — wiring the MCP endpoint for cng.
- `manifest-and-deploy/SKILL.md` — cng's manifest/registry and env/secrets.

Each should link **up** to the generic `global/*` skill it implements and **sideways** to the
relevant `stack/javascript/*` skills. Discover the actual cng surface by reading the installed
`@peektravel/app-utilities` package for the cng platform (see `stack/javascript/app-utilities`) —
don't assume it matches peek.

Shared JS SDK / framework / UI facts (the `@peektravel/app-utilities` package, Next.js, Odyssey,
Vitest) are **not** duplicated here — they live in `stack/javascript/` and are reused as-is.
