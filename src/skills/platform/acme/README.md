# platform/acme — ACME skills (stub)

No ACME-specific skills exist yet. When ACME gets platform-specific guidance, mirror the
structure of `platform/peek/`:

- `embed-and-auth/SKILL.md` — how an ACME app receives identity and authenticates requests.
- `backoffice-api/SKILL.md` — the ACME API client from `@peektravel/app-utilities`, its domain,
  and its **capability boundary** (note: **ACME has no GraphQL** — the typed SDK is the hard ceiling;
  if a capability isn't in the SDK for ACME, it doesn't exist).
- `webhooks/SKILL.md` — ACME's inbound events, if any.
- `mcp-endpoint/SKILL.md` — wiring the MCP endpoint for ACME.
- `manifest-and-deploy/SKILL.md` — ACME's manifest/registry and env/secrets.

Each should link **up** to the generic `global/*` skill it implements and **sideways** to the
relevant `stack/javascript/*` skills. Discover the actual ACME surface by reading the installed
`@peektravel/app-utilities` package for the ACME platform (see `stack/javascript/app-utilities`) —
don't assume it matches peek.

Shared JS SDK / framework / UI facts (the `@peektravel/app-utilities` package, Next.js, Odyssey,
Vitest) are **not** duplicated here — they live in `stack/javascript/` and are reused as-is.
