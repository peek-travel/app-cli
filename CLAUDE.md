# app-cli — repo guide

`@peektravel/app-cli` (`peek`): an oclif CLI to scaffold, develop, and publish Peek platform apps.

- **Commands:** `src/commands/**` (oclif), organized into topics — a file's path IS its command
  (`commands/apps/push.ts` → `peek apps push`). What acts on the current directory is top level
  (`init`, `dev`, `tunnel`, `skills`); what acts on the registry sits under a topic (`apps`,
  `extensions`, `auth`, and the hidden `env`). Topic descriptions live in `package.json`
  `oclif.topics`. All commands extend `BaseCommand` (`src/base-command.ts`), which registers the
  global `--skip-env-confirm` flag and `guard()` — the shared "print a CLIError's suggestion, treat
  an abort as clean, let a bug keep its stack" wrapper every registry command's body runs inside.
- **`init [name-or-slug]` adopts rather than clobbers.** The positional is a name for a new app
  OR the slug of one that already exists; `init` looks the slug up before writing anything and
  scaffolds a kit that publishes to that app, pulling its manifest into `app.json`. The lookup
  happens even when the developer is naming a brand-new app, because the registry's upsert is
  create-or-update on the slug: scaffolding onto a taken slug and pushing would overwrite that
  app's manifest with the starter kit's. A slug the developer typed is adopted silently; one
  derived from a name they typed needs a confirm (and is refused with no TTY). `--app <slug>` is
  the strict form (must exist); `--no-sync` skips the lookup and says so.
- **`init` is the magic one, and every step it does is also a command:** `apps link` (identity +
  manifest), `skills` (skill composition), `apps push` (register), `tunnel` (public URL), `dev`
  (start + tunnel + publish). Keep that true — a step `init` does and nothing else can is a step a
  developer with an existing codebase can't reach. Platform/stack resolution is shared in
  `src/lib/axes.ts`; the tunnel/publish loop is `src/lib/serve.ts` (`attach: true` = `peek tunnel`,
  i.e. start nothing and hold the tunnel open).
- **Renaming a command:** keep the old id working as `static hiddenAliases = ["old-name"]` plus
  `static deprecateAliases = true` (see `commands/apps/use-url.ts`) — published skills and scripts
  say the old name, and the alias makes the CLI answer while naming the replacement. A command that
  SPLIT needs a forwarding shim instead (`commands/apps/sync.ts`), since one alias can't point at
  two commands. Retired so far: `sync-app` (→ `apps push` / `apps pull`), `use-url`, `show-env`,
  `set-env`.
- **Registry/session state:** `src/lib/registry.ts` (which registry, override, confirm gate),
  `src/lib/session.ts` (per-registry tokens).
- **Registry client:** `src/lib/sync.ts` — every publisher-API call (upsert, base-url, export,
  test-apps, versions, publish) plus `peek apps push` / `peek apps pull`.
- **The dev loop's test app:** `createTestApp` sends an `identifier` (registry derives
  `<source>-test-<identifier>`, slugified, idempotent per identifier). `DEFAULT_TEST_IDENTIFIER`
  is `"dev"` — shared across a team on purpose, with `dev`/`tunnel --test <name>` (or
  `PEEK_TEST_IDENTIFIER`) for a personal one. Never predict the slug: report what the response
  returns. Whichever way the identifier arrives, the test app used lands in `.peek-kit.json`
  `app.testId`, which is committed — an unresolved wrinkle for personal identifiers.
- **Source app vs test app:** the registry reports `is_test_app` / `test_app_for` on `GET /apps`
  and `GET /apps/:id`, and honours `?exclude-test-apps=true`. A test app is a clone `peek dev`
  owns (`app.testId`), never a link/`init` target — the registry refuses to clone one off
  another, so accepting it here surfaces as a 422 a run later. `apps list` excludes them by
  default; `apps link`, `init` and the dev loop (`serve.ts` `assertSourceApp`, before the tunnel
  opens) reject them by naming `testAppFor`. A registry too old to send those fields reports
  every app as an ordinary one, which is the pre-change behavior.
- **Don't record a slug you might refuse.** `serve.ts` opens the project with `persist: false`
  and writes a derived/legacy slug into `.peek-kit.json` only after `assertSourceApp` passes —
  otherwise a refused run would leave the file claiming this directory publishes to an app the
  dev loop just rejected.
- **Scaffolding:** `src/lib/scaffold.ts` — `composeSkills()` copies `src/skills/{global, platform/<p>,
  stack/<s>}` into a scaffolded app's `.claude/skills/`.

## An app's two files

The publisher API takes the app's slug in the URL and the bare **manifest** as the body, so a
project's facts are split:

- `app.json` — `src/lib/manifest.ts`. The manifest and only the manifest: `{ global: [...],
  peek: [...] | null, acme: …, cng: … }`. Unknown top-level keys are a 400, so nothing else may be
  smuggled in. `loadManifest()` also reads two older shapes and converts them: the pre-flattening
  `{data: {app: …}}` envelope, and a flat manifest whose non-platform key is still named
  `registry` (the registry renamed it to `global`).
- `.peek-kit.json` — `src/lib/project.ts`. Which app this directory publishes to (`app.id`), the
  test app the dev loop uses (`app.testId`), and what scaffolded it. `openProject()` is the
  migrating loader every registry-touching command goes through: it flattens a legacy `app.json`,
  moves the slug out of it, and retires `app-dev.json`. `peek init` writes it when it scaffolds;
  `peek apps link` (`src/commands/apps/link.ts`) writes it for a codebase the CLI didn't scaffold, which is
  what makes an existing repo / existing registry app work without hand-editing the file.

`base_url` belongs to neither — it is per environment, set by `peek dev` (tunnel) and
`peek apps use-url` (a deployed host). Listing copy belongs to neither either: it is per platform and
written in the portal.

## Recipes (`docs/recipes/`) — the human-facing walkthroughs

One file per situation a developer arrives in: nothing yet, an app without code, code without a
project file. They name exact commands, exact prompts and exact file effects, so **a command,
flag or prompt you change is a recipe you have to re-check** — same rule as the `cli` skill, and
for the same reason (a stale recipe is worse than no recipe). `docs/recipes/README.md` is the
index and holds the shared preflight (auth, which registry) plus the source-app/test-app model.

## App-building skills (`src/skills/`) — the authoring source of truth

These SKILL.md files teach an app-building agent how to build on the starter kit. They're organized
on three axes (`global`, `platform/<peek|cng|acme>`, `stack/<javascript>`) and composed into every
scaffolded app. `global/app-builder` is the orchestrator; the rest are its siblings. See
`src/skills/README.md`.

> **Keep the `cli` skill in sync with the CLI.** `src/skills/global/cli/SKILL.md` documents the
> CLI's commands, flags, and the extensions workflow for app-building agents. **Whenever you change
> a command, a flag (e.g. `--skip-env-confirm`), the `env show` / `auth` / `dev` / `tunnel` / `apps push` /
> `apps use-url` / `extensions` behavior, the shape of `app.json` / `.peek-kit.json`, or the set of
> registry extensions apps can declare, update that skill in the same change** — and check its
> cross-links (`app-builder`, `manifest-and-deploy` incl. the three platform ones, `webhooks`,
> `backoffice-data`) still hold. A stale `cli` skill silently teaches agents the wrong CLI.

## Versioning — every PR bumps `package.json`

**A PR that changes shipped behavior bumps the root `package.json` `version` in the same PR**, by
semver, as part of the change — not in a follow-up `chore: bump` commit. `@peektravel/app-cli` is
published from this repo and developers install it globally; the version is how they (and a bug
report) say which CLI they're on, so a merged change with no bump is a released behavior change
nobody can name.

What counts as which bump — remember that `src/skills/**` and `templates/nextjs-starter-kit/**`
ship inside the package (`files`), so a change to the starter kit or a skill is a released change
like any other:

- **major** — a breaking change for someone already using the CLI: a command or flag removed or
  renamed without an alias, a change to `app.json` / `.peek-kit.json` that an existing project
  can't read, a starter-kit change an existing scaffolded app can't take.
- **minor** — new capability, backward compatible: a new command or flag, a new skill, a starter
  kit that can do something it couldn't.
- **patch** — everything else that ships: bug fixes, a dependency bump inside the starter kit,
  rewording a skill, a doc/recipe correction.

Repo-only changes that don't land in the published package (tests, this file, CI) don't need one.

## Build & test

- Build/typecheck: `tsc -b` (run the local binary directly if the sandbox blocks `pnpm run`).
- Tests: `vitest run`. Run the CLI in dev with `./bin/dev.js <command>`.
