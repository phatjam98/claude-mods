// Plan markdown fixtures, shaped after the real corpus in ~/.claude/plans.

/** Marked WP plan: every marker, an unmarked step-like sibling, child checkboxes (nested + fenced). */
export const MARKED_WP = `# Plan: ship the widget

## Context
Why we are doing this.

### Decisions
- Use the small widget.

## Work packages

### [x] WP0 — Bootstrap
- [x] repo created
- [x] branch cut

### [~] WP1 — Parser ([spec](https://example.com/spec))
- [x] fences
- [ ] headings
  - [~] nested child
\`\`\`md
- [ ] not a child, inside a fence
## [x] not a heading either
\`\`\`
- PR: https://github.com/phatjam98/claude-mods/pull/7

### [!] WP2 — Needs the user
Waiting on a decision.

### WP3 — Unmarked sibling

### [-] WP4 — Dropped

### [ ] WP5 — Release

## Verification
- run the tests
`

/** noble-tulip shape: `### WPn` under `## Work packages`, `### Decisions` under Context, fenced `# comment` lines. */
export const NOBLE_TULIP = `# ECFX-18104 — re-baseline \`schema.sql\`, close the enum-label drift, release 0.8.0

## Context
The test schema drifted.

### Decisions (made with the user)
- Regenerate, do not curate.

### Out of scope (say so in MIGRATION_HISTORY "What's next")
- Anything else.

## Execution model (user's rule: the orchestrator writes no code)
Agents do the work.

## Work packages

### WP0 — Prep (sonnet, general-purpose)
- Rename branch.

### WP1 — Regenerate \`schema.sql\` from a DB migrated from empty (sonnet, general-purpose)

\`\`\`bash
# throwaway Postgres, same image as ecfx-backend compose
docker run -d --name ecfx_ref_pg postgres:15.4-alpine
# migrate from empty (B694 baseline, then V695..head in order)
./gradlew :db_migrator:run --args='migrate'
## not a heading
\`\`\`

### WP2 — Remove \`DownloadBatch.skippedDocuments\` + RED evidence #2 (opus, java-micronaut-dev)
- Delete the field.

### WP6a / WP6b — Docs (sonnet, general-purpose)
- Update the docs.

## RED → GREEN expectations
Stage A, Stage B.

## Risks and mitigations (short)
- None.

## Verification
- Full gate.
`

/** whimsical-nautilus shape: \`## Step N —\` with a prose \`## Branch / release\` before the first step. */
export const NAUTILUS = `# Plan: raise real test coverage and add a JaCoCo gate (ecfx/data)

## Context
Coverage is low.

## Branch / release
Branch off master, one MR.

## Step 1 — Prove the proxy bug first (RED)
Write the failing spec.

## Step 2 — Make equality proxy-safe (GREEN)
\`\`\`java
# not a heading
\`\`\`

## Step 3 — One contract spec for every mapped type

## Step 4 — Targeted gaps with real regression value

## Step 5 — JaCoCo gate and CI (\`build.gradle:315-368\`)

## Step 6 — Docs, fixed in the same MR

## Verification
- \`./gradlew check\`
`

/** transient-platypus shape: \`## PR n:\` steps, \`## Ground rules\` before and prose after. */
export const PLATYPUS = `# Portfolio refresh: everything beyond the case studies

## Context
Refresh the site.

## Ground rules for every PR
Small PRs.

## PR 1: \`docs/claude-md-refresh\`, docs that future agents rely on

## PR 2: \`content/home-about-realign\`, highest-visibility corrections

## PR 3: \`site/chrome-seo\`, site-wide correctness and polish

## Explicitly out of scope
- Case studies.

## Your inputs checklist
- Photos.

## Verification (per PR)
- Build.
`

/** squishy-puddle shape: \`### 1.\` numbered steps under \`## Plan: …\`. */
export const SQUISHY = `# Stop the recurring ITA drift: fix the two Loki rules and add guards

## Context
\`\`\`
# query_type drifted
\`\`\`

## Plan: one MR, branch \`travis/ECFX-16406_ita-loki-query-type-drift\` (off master)

### 1. Fix the two ITA stages: \`terraform/alerts_backend_poller.tf\`

### 2. Pre-merge check: new \`scripts/lint-alert-rules.sh\`

### 3. Post-apply check: new \`converge:nonprod\` and \`converge:prod\` jobs

### 4. Fix the guidance that misleads

## Files
- terraform/alerts_backend_poller.tf

## Verification
- plan shows no drift

## Coordination / non-code
- Tell the team.
`

/** Excerpt of the waypoint plan itself (we-are-going-to-purring-origami.md). */
export const WAYPOINT_PLAN = `# claude-mods repo + \`waypoint\`, a plan-progress pane mod

## Context

Claude Code mods can draw live panes.

### Decisions (made with the user)

- Monorepo: one folder per mod under \`mods/\`.

### Reuse (verified on this machine)

- Private dev mods set the conventions.

## Execution model

Work in this session with hot reload.

### Agent model policy (user correction during planning)

| Task | Agent type | Model |
|---|---|---|
| Searching files | Explore | haiku |

## Work packages

### [x] WP0 — Repo bootstrap and dev loop

\`\`\`bash
mkdir -p ~/src/claude-mods && cd ~/src/claude-mods && git init -b main
# write LICENSE (MIT), README.md stub, .gitignore
\`\`\`

### [~] WP1 — Mod skeleton, contract, plan parser

Files under \`mods/waypoint/\`.

### [ ] WP2 — State, events, discovery, commands, prompt section

### [ ] WP3 — Pane, band, status line

### [~] WP4 — PR/MR "needs attention" subsystem

### [ ] WP5 — Docs, CI, PR, release

## Verification

- \`claude plugin validate --strict mods/waypoint\`
`

export const CHECKBOX_ONLY = `# Groceries

- [x] milk
- [ ] eggs
  - [ ] free range
- [~] bread
`

export const ORDERED_ONLY = `# Steps to deploy

Some intro text.

1. Build the image
   with jib
2. Push it
3. Roll the deployment

Trailing prose.
`

export const ZERO_STEPS = `# Notes

Just some prose with no structure at all.
`

export const DUPLICATE_TITLES = `# Dupes

## Work

### [ ] WP1 — Write tests

### [ ] WP1 — Write tests

### [ ] WP1 — Write tests
`
