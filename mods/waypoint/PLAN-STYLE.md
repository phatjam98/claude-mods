# Plan Style Guide

One page on how to write a plan so that it works for the model that runs it, for you, and for the waypoint pane. Of 21 plans checked on one machine, 19 had no status markers, so the parser had to guess what was a step. This guide removes the guessing.

## Skeleton

```
# <What this plan delivers, in plain words>

## Context
Why, constraints, links, decisions so far. Any length. Never a step.

### [ ] WP1 — <short imperative title, about 45 characters>
One or two lines on intent and what "done" means.
- [ ] <checkable outcome>
- [ ] <checkable outcome>
- PR: <url>  (added once it exists)

### [ ] WP2 — ...

## Decisions / Open questions / Verification
Unmarked closing sections, excluded by name.
```

## Rules

- Every unit of work is a `###` heading that starts with `[ ]`, numbered WP1, WP2, …; nothing else is a step. Checkbox lines are children of a step, never steps. One shape means the pane, the model and you all count the same steps.
- Prose lives under `## Context`, under a step, or in a named closing section; never as a bare `##` heading that reads like a unit of work. Otherwise a section of background is counted as a step that never finishes.
- Markers `[ ]` `[~]` `[x]` `[!]` `[-]` and `- PR:` lines are the only lines that change while the plan runs. Everything else stays put, so edits are small and a diff shows progress only.
- Revising a plan another session may have open: add or re-mark steps; keep its prose as it is.

## Markers

| Marker | Meaning |
|---|---|
| `[ ]` | pending |
| `[~]` | in progress (one at a time) |
| `[x]` | done |
| `[!]` | blocked on the person |
| `[-]` | dropped |

## Why it helps the plan itself

Not only the pane benefits.

- The title says what the plan is for, so it can be found and judged later.
- The why (`## Context`) is separate from the what (the steps), so neither is buried in the other.
- Each step carries a done-when, so finishing is a check, not a feeling.
- The markers are a durable record of where the plan stands, and they survive context compaction when the conversation does not.

## Living documents: the additive form

A large "plan of record" document can stay as it is. Add a `## Steps` section whose marked headings point at the sections they execute.

Before:

```
# Migrate billing to the new ledger

## Background
...
## Phase 1: Dual writes
...
## Phase 2: Backfill
...
```

After (nothing above is touched):

```
# Migrate billing to the new ledger

## Background
...
## Phase 1: Dual writes
...
## Phase 2: Backfill
...

## Steps

### [ ] WP1 — Dual writes (see Phase 1)
- [ ] writes land in both ledgers

### [ ] WP2 — Backfill (see Phase 2)
- [ ] row counts match
```

## How waypoint applies it

Four places, all advisory. waypoint appends text the model reads and never changes what a tool writes.

1. **Plan mode.** The guide is appended to the engine's full plan-mode reminder only (sent on the first request of a planning session and after a compaction), not to the sparse repeats; a one-paragraph version of the rules rides in the compose section the rest of the time. The model sees it while writing a plan and nowhere else.
2. **After a plan file is written.** When the model writes or edits any file under the plan directory, waypoint lints it and leaves a short hidden note: what the parser saw and what to fix. Nits are reported after a full write, only fix-level problems after an edit, and an identical note is not repeated. After an edit outside plan mode the note is a pointer, not an order: it says the shape may be intentional and names `/waypoint conform`.
3. **`/waypoint lint [path|slug|n]`.** Prints the report for the tracked plan, or the named one.
4. **`/waypoint conform [rewrite] [path|slug|n]`.** Submits an instruction as a prompt from the waypoint plugin (the transcript shows it as the plugin's message), which starts a turn of its own once the session is idle; the model then applies the guide with the Edit tool and shows the diff. If the submit fails, the instruction rides along with your next prompt instead. The default is additive: add markers to existing step headings, add a `## Steps` section pointing at the sections when there are none, never delete or reorder prose, never change the title. `rewrite` may also reshape headings into the skeleton and move checkbox lines under steps, still keeping every prose line.

The `styleGuide` option (default on) gates 1 and 2. The two commands always work. The parser is unchanged, so plans already tracked keep their snapshots.

## Lint codes

Fix-level, reported always:

| Code | Meaning |
|---|---|
| `no-steps` | no step was found |
| `heuristic-steps` | steps were guessed, not read from markers; names the fallback mode (sections, pattern, checkboxes or ordered) |
| `loose-checkboxes` | top-level checkboxes were taken as steps |
| `mixed-depth` | steps sit at more than one heading level |

Nits, reported after a full write:

| Code | Meaning |
|---|---|
| `no-title` | no `#` title |
| `title-prefix` | the title starts with `Plan:` |
| `unmarked-step` | a step heading has no marker (the parser counts it as pending) |
| `long-title` | a step title is over 45 characters; only when markers are used |
| `many-children` | a step has over 8 checkboxes |
| `multiple-active` | more than one step is `[~]` |
| `unnumbered` | steps are not numbered WP1, WP2, … |
