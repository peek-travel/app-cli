# app-cli — repo guide

`@peektravel/app-cli` (`peek`): an oclif CLI to scaffold, develop, and publish Peek platform apps.

- **Commands:** `src/commands/**` (oclif). All extend `BaseCommand` (`src/base-command.ts`), which
  registers the global `--skip-env-confirm` flag.
- **Registry/session state:** `src/lib/registry.ts` (which registry, override, confirm gate),
  `src/lib/session.ts` (per-registry tokens).
- **Scaffolding:** `src/lib/scaffold.ts` — `composeSkills()` copies `src/skills/{global, platform/<p>,
  stack/<s>}` into a scaffolded app's `.claude/skills/`.

## App-building skills (`src/skills/`) — the authoring source of truth

These SKILL.md files teach an app-building agent how to build on the starter kit. They're organized
on three axes (`global`, `platform/<peek|cng|acme>`, `stack/<javascript>`) and composed into every
scaffolded app. `global/app-builder` is the orchestrator; the rest are its siblings. See
`src/skills/README.md`.

> **Keep the `cli` skill in sync with the CLI.** `src/skills/global/cli/SKILL.md` documents the
> CLI's commands, flags, and the extensions workflow for app-building agents. **Whenever you change
> a command, a flag (e.g. `--skip-env-confirm`), the `show-env` / `auth` / `dev` / `sync-app` /
> `extensions` behavior, or the set of registry extensions apps can declare, update that skill in
> the same change** — and check its cross-links (`app-builder`, `manifest-and-deploy`, `webhooks`,
> `backoffice-data`) still hold. A stale `cli` skill silently teaches agents the wrong CLI.

## Build & test

- Build/typecheck: `tsc -b` (run the local binary directly if the sandbox blocks `pnpm run`).
- Tests: `vitest run`. Run the CLI in dev with `./bin/dev.js <command>`.
