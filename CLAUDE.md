# CLAUDE.md

Conventions for this repo, a Claude Code plugin marketplace of mods.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace; one entry per mod.
- `mods/<name>/`: one folder per mod, with its own `.claude-plugin/plugin.json`, `hooks/`, `tests/`, `README.md`, `CHANGELOG.md`.
- The engine writes `mods/<name>/.claude-plugin/types/` after the mod's first interactive load. It is gitignored. Regenerate it; never edit it.
- `.github/workflows/ci.yml` validates and tests every mod.

## Commands

- `claude plugin validate --strict .` for the marketplace.
- `claude plugin validate --strict mods/<name>` for a mod.
- `claude plugin test mods/<name>` runs every `*.test.ts` under the mod.
- `npx -p typescript tsc -p mods/<name>` after the first interactive load has laid the types.
- Run all of the above after every change.

## Code conventions

- All mod source lives under `hooks/` (the engine's tsconfig includes only `hooks/`, `types/`, `tests/`).
- Pure logic goes in `hooks/<area>/*.ts` and never takes `$`.
- Every function that touches `$` is declared top-level in `hooks/register.tsx`. The validator attributes `$` calls only to top-level functions there.
- `hooks/register.tsx` is the only file that calls `on()`.
- Hooks observe only. Never deny or rewrite a tool call, prompt or attachment, unless the mod's README says it is a guard. A hook may append advisory text the model reads: to an attachment (`next(e)` first, then add to its text), as hidden context after a tool result, or from a command. It never drops an attachment, changes a tool's input, or changes what a tool writes.
- Wrap every `$.process.run` so it never throws. Run read-only CLIs only.
- Render hooks do no I/O and never write state; they read atoms and draw a precomputed model.
- Tests import `{ test, expect, mock }` from `claude-code/testing`.

## README requirements per mod

- The validator's install line: `/plugin install <name> --marketplace phatjam98/claude-mods`.
- A "What it can reach" section stating plainly what the mod reads, observes, runs, stores and sends.
- Options table matching `userConfig` in `plugin.json`.

## Adding a mod

1. Create `mods/<name>/` with `plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `tsconfig.json`, `.gitignore` (`.claude-plugin/types/`).
2. Add the entry to `.claude-plugin/marketplace.json`, with the same `version` as `plugin.json`.
3. Add tests, `README.md` and `CHANGELOG.md`.
4. Add a line to the root `CHANGELOG.md` and a row to the root README's mods table.

## Versioning

- SemVer per mod. `version` in `plugin.json` is mirrored in `marketplace.json`.
- Root `CHANGELOG.md` has one line per mod release; each mod's `CHANGELOG.md` has the detail.
- After merge, on main: `claude plugin tag mods/<name> --dry-run`, then `--push -m "<name> %s"`. Tags look like `waypoint--v0.1.0`.

## Git

- Never commit to `main`. Work on a feature branch and open a PR with `gh` (GitHub repo; do not use `glab`).
- Check the current branch before every commit.
