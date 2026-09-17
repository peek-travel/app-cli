# app-cli — repo guide

`@peektravel/app-cli` (`peek`): an oclif CLI to scaffold, develop, and publish Peek platform apps.

- **Commands:** `src/commands/**` (oclif). All extend `BaseCommand` (`src/base-command.ts`), which
  registers the global `--skip-env-confirm` flag.
- **Registry/session state:** `src/lib/registry.ts` (which registry, override, confirm gate),
  `src/lib/session.ts` (per-registry tokens).
- **Registry client:** `src/lib/sync.ts` — every publisher-API call (upsert, base-url, export,
  test-apps, versions, publish) plus `peek sync-app`'s push/pull.
- **Scaffolding:** `src/lib/scaffold.ts` — `composeSkills()` copies `src/skills/{global, platform/<p>,
  stack/<s>}` into a scaffolded app's `.claude/skills/`.

## An app's two files

The publisher API takes the app's slug in the URL and the bare **manifest** as the body, so a
project's facts are split:

- `app.json` — `src/lib/manifest.ts`. The manifest and only the manifest: `{ registry: [...],
  peek: [...] | null, acme: …, cng: … }`. Unknown top-level keys are a 400, so nothing else may be
  smuggled in. `loadManifest()` also reads the pre-flattening `{data: {app: …}}` envelope and
  converts it.
- `.peek-kit.json` — `src/lib/project.ts`. Which app this directory publishes to (`app.id`), the
  test app the dev loop uses (`app.testId`), and what scaffolded it. `openProject()` is the
  migrating loader every registry-touching command goes through: it flattens a legacy `app.json`,
  moves the slug out of it, and retires `app-dev.json`.

`base_url` belongs to neither — it is per environment, set by `peek dev` (tunnel) and
`peek use-url` (a deployed host). Listing copy belongs to neither either: it is per platform and
written in the portal.

## App-building skills (`src/skills/`) — the authoring source of truth

These SKILL.md files teach an app-building agent how to build on the starter kit. They're organized
on three axes (`global`, `platform/<peek|cng|acme>`, `stack/<javascript>`) and composed into every
scaffolded app. `global/app-builder` is the orchestrator; the rest are its siblings. See
`src/skills/README.md`.

> **Keep the `cli` skill in sync with the CLI.** `src/skills/global/cli/SKILL.md` documents the
> CLI's commands, flags, and the extensions workflow for app-building agents. **Whenever you change
> a command, a flag (e.g. `--skip-env-confirm`), the `show-env` / `auth` / `dev` / `sync-app` /
> `use-url` / `extensions` behavior, the shape of `app.json` / `.peek-kit.json`, or the set of
> registry extensions apps can declare, update that skill in the same change** — and check its
> cross-links (`app-builder`, `manifest-and-deploy` incl. the three platform ones, `webhooks`,
> `backoffice-data`) still hold. A stale `cli` skill silently teaches agents the wrong CLI.

## Build & test

- Build/typecheck: `tsc -b` (run the local binary directly if the sandbox blocks `pnpm run`).
- Tests: `vitest run`. Run the CLI in dev with `./bin/dev.js <command>`.
