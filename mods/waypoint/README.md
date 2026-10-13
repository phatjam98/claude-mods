# waypoint

A Claude Code mod that draws the plan your session is working through as a live pane, with the PRs/MRs it touches and what each needs from you.

## Requirements

- Claude Code 2.1.296 or later. Mods are early access.
- `gh` and/or `glab` installed and logged in, for PR/MR tracking. Plan progress works without them.

## Install

```
/plugin marketplace add phatjam98/claude-mods
/plugin install waypoint@claude-mods
```

The validator's form:

```
/plugin install waypoint --marketplace phatjam98/claude-mods
```

From a clone, for a single session:

```bash
claude --plugin-dir mods/waypoint
```

## What you see

Docked and wide (64 columns or more):

```
⚑ claude-mods repo + waypoint, a plan-progress pane mod                     WP5 · 6 of 7 · 85%
██████████████████████████████████████████████████████████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░

  ✓  WP0  Repo bootstrap and dev loop
  !  WP5  Docs, CI, PR, release                                           3/6  waiting on you
          ✓ README, CHANGELOG, marketplace entry
          ✓ CI workflow green on a clean runner
          · mark PR #1 ready and merge (after WP6)
  ▶  WP6  Visual redesign and "Waiting on you" handoff

── Pull requests · 1 open · none need you · polled 0s ago ────────────────────────────────────
  ○  #1  feat(waypoint): plan pane with PR/MR attention and handoff note   WP6   draft   copy · untrack

── Waiting on you · 12m ago ──────────────────────────────────────────────────────────────────
  waypoint 0.2.0 is pushed to PR #1 as commit f7a4a05 …
  !  action    Look at the redesigned pane and this note on screen
  !  decision  Mark PR #1 ready and merge?                                                  #1

──────────────────────────────────────────────────────────────────────────────────────────────
  ~/.claude/plans/we-are-going-to-purring-origami.md · changed 12m ago     r refresh · p path · c close
```

Narrow dock. The docked pane asks the engine for 48 columns (`paneColumns`), and from 44 to 63 columns it keeps the sectioned layout, adapted: one-space indents, `WP6 · 5/7 · 71%` in the header, `needs you` on a blocked step, PR rows without the step or the `copy · untrack` buttons (the link opens the PR; `/waypoint untrack <ref>` still works), a PR header without `none need you` or `n other`, and the footer on two rows, the path and then the keys:

```
⚑ claude-mods repo + waypo…  WP6 · 5/7 · 71%
████████████████████████████████▓▓▓▓▓▓░░░░░░░░

 ✓ WP0 Repo bootstrap and dev loop
 ✓ WP1 Mod skeleton, contract, plan parser
 ! WP5 Docs, CI, PR, release     3/6  needs you
       ✓ README, CHANGELOG, marketplace entry
       · mark PR #1 ready and merge (after WP6)
 ▶ WP6 Visual redesign and "Waiting on you"…

── Pull requests · 1 open · polled 3s ago ─────
 ○ #1 feat(waypoint): plan pane with P…  draft

── Waiting on you · 12m ago ───────────────────
 waypoint 0.2.0 is pushed to PR #1 as commit
 f7a4a05: the pane redesign and this very
 note. After your sign-off I mark #1 ready…
 ! action   Look at the redesigned pane and…
 ! decision Mark PR #1 ready and merge?     #1

───────────────────────────────────────────────
 ~/.claude/plans/we-are-going-to-purring-o…
 r refresh · p path · c close
```

Inline, or docked narrower than 44 columns (8 rows at most, no footer):

```
⚑ ship the widget                    3/9 33%
████████████████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░
✓ 3 done · WP0 WP1 WP2
▶ WP3 Draw the pane                      1/2
· WP4 Step number 4
· WP5 Step number 5                  +3 more
! waiting on you · Mark PR #13 ready a… (+1)
✗ 1 PR needs you · #13 ci failed · polled 0s…
```

The pane shows:

- the plan title, and on the right the current step, `done of total` and the percentage (`3/9 33%` in compact);
- a bar the full width of the pane in three spans: finished steps `█` (green), the current step's own share `▓` (plan-mode colour, or warning when it is blocked) and what remains `░`. It shows how far along the plan is and where the session is in it;
- the step list, one glyph per step: `✓` done, `▶` in progress (bold), `·` pending (dim), `!` blocked on you (warning), `–` skipped (struck through); the current step shows its child-checkbox progress (`2/4`) and, in the wide layout, its checkboxes below it: one per line under the title (8 at most, then `+n more`) when the rows allow, else all in one row. When the steps do not fit, leading finished steps fold into one `✓ n done` row and a `+n more` row ends the list; the current step is always shown;
- a "Pull requests" section while any tracked PR/MR is open: the header counts those that need you (failing CI, requested changes, conflicts, ready to merge; in warning colour when any do), the other open ones, and when PRs were last polled. Rows list those needing you first, then the others dimmed (5 rows at most), each with its link, title, step, status and `copy · untrack` buttons (the narrow dock drops the step and the buttons). A gh/glab error (not logged in, rate-limited, not installed) shows as a note under the header. Merged and closed PRs are not listed. Compact draws one line for the PR most in need;
- a "Waiting on you" section while the model has left a handoff note (see below): when it was left, its summary (6 lines at most, fewer when rows are tight) and one line per item, `!` for those blocking the plan, with a link when the item names a tracked PR/MR or a URL. Its header says `from an earlier session` when the note was left by another session. Compact draws one line, `! waiting on you · <first item>`, and so does every other pane state (no plan tracked, planning, file missing, no steps), on its first row. This section and the PR section keep their rows before the step list does; in the wide layout each section opens with a rule carrying its header (`── Pull requests ───`, `── Waiting on you ───`) and a full-width rule sits above the footer. When rows run short, the current step's checkboxes go back to one row first; then the sections give up the blank lines between them (and the footer rule), then the `+n more` item row, then fold to one line each (the handoff first, then the PRs);
- in the wide layout, a footer with the plan path (`~` for your home folder), when the plan file last changed, and `refresh` / `path` / `close` buttons.

With no plan tracked, `/waypoint` lists up to 5 recent plans from `planDir`, newest first, each with a hotkey `1`–`5` to track it.

When the pane is not placed (narrow terminal, or closed), a one-line band above the prompt carries the summary (for example the current step, steps done, PRs needing you) with an `open` button. While a handoff note is up it reads `⚑ waiting on you (2) · WP5 of 6 · 5 done`, in warning colour, and with no plan tracked it still shows as `⚑ waiting on you (2)`.

The status line carries a short segment: `⚑ 3/9 WP2`, with `!` after the step when blocked, `✓` when complete, and ` · needs you` while a handoff note is up (`⚑ 5/6 WP5 · needs you`; `⚑ needs you` with no plan tracked, `⚑ no steps · needs you` for a plan with no steps).

## The plan convention

A step is a heading whose text starts with a marker:

| Marker | Meaning |
|---|---|
| `[ ]` | pending |
| `[~]` | in progress |
| `[x]` | done |
| `[!]` | blocked on you |
| `[-]` | skipped |

Example: `### [~] WP2 — Remove the old field`. A step-like heading with no marker counts as pending. Plans with no markers at all are still recognised by their `### WP1 —` / `## Step 1` shapes, and prose sections (Context, Decisions, Verification and the like) are not steps. Child items written as `- [ ]` under a step show as its checkboxes.

While a plan is tracked, the mod adds a short section to the system prompt asking the model to keep the markers current and to add a `- PR: <url>` line under a step when it opens a PR. In plan mode it asks the model to write markers on the step headings.

PR/MR links are read from a step in two ways: any full PR/MR URL anywhere in the step, and short refs (`#13`, `!6677`, `group/project!6677`, against this repo) only on a `- PR: <url or #n>` / `- MR: …` line under the step, or as a markdown link target (`[fix](#13)`). A bare `#123` in prose is ignored.

## Handoff: when the session waits on you

When the model stops because only you can move the plan (a decision, a merge, a credential, an answer), the system-prompt section asks it to call the tool `mcp__waypoint__handoff` first, with a 2–4 sentence summary of where things stand and one item per thing you must do, decide or answer (`decision`, `action` or `answer`; `blocking` when the plan cannot move without it; an optional PR/MR `ref`). The note shows in the pane as "Waiting on you", in the band and on the status line, and raises a toast (and a native notification with `notify` on). When work resumes the model calls the tool with `clear: true`, or replaces the note. An input with neither a summary nor an item comes back to the model as an error. `/waypoint handoff` prints it and `/waypoint handoff clear` clears it yourself.

The note is kept per plan: it comes back when a later session resumes the same plan, as a recap marked `from an earlier session`, and is dropped after 30 days untouched. While such a note is showing, a second short system-prompt section tells the model it is there (with the summary's first 120 characters), so it can clear or replace it once you have acted.

## Commands

| Command | Does |
|---|---|
| `/waypoint` | Re-read the plan and open the pane (at any width) |
| `/waypoint close` | Close the pane |
| `/waypoint refresh` | Re-read the plan and poll tracked PRs now |
| `/waypoint use <path\|slug>` | Track a plan by path, or by slug in `planDir` |
| `/waypoint track <ref>` | Track a PR/MR: a URL, `#n` / `!n` (against this repo), `group/project!n`, or `host/path#n` / `host/path!n` |
| `/waypoint untrack <ref>` | Stop tracking a PR/MR: any form `track` takes, its label, or its full id (`github.com/o/r#5`) |
| `/waypoint handoff` | Print the model's current "waiting on you" note |
| `/waypoint handoff clear` | Clear that note |
| `/waypoint reset` | Forget the tracked plan and its handoff note |
| `/waypoint layout auto\|compact\|wide` | Choose the pane layout; this choice wins over the `layout` option |
| `/waypoint layout` | Forget that choice, so the `layout` option applies again |
| `/waypoint status` | One-line summary, then a `pane:` line (placement, drawn width, width asked) |

## Keys

The pane hotkeys `r` (refresh), `p` (copy path) and `c` (close) sit in the footer of the wide layout only (the per-PR `copy` and `untrack` buttons have no hotkey), and `1`–`5` (pick a recent plan) exist only when no plan is tracked. All work only while the pane is focused (ctrl+x, then tab). The pane opens automatically only at 144 columns or wider; `/waypoint` opens it at any width.

## Configure

Set these in `/config`, or under `pluginConfigs["waypoint"].options` in `settings.json`.

| Option | Default | Purpose |
|---|---|---|
| `openOnStart` | `true` | Open the pane when a plan is found at session start (placed only in wide terminals; the band shows otherwise) |
| `band` | `true` | Draw a one-line plan summary above the prompt while the pane is not placed |
| `statusLine` | `true` | Pin the current step under the prompt |
| `layout` | `auto` | `auto` picks compact inline and wide when docked; or `compact` / `wide` |
| `paneColumns` | `48` | Body columns the docked pane asks for; 0 leaves the engine's share. Ignored inline and once you drag the dock. |
| `planDir` | `~/.claude/plans` | Where `/waypoint use <slug>` looks for plan files |
| `planPollSeconds` | `5` | How often the plan file is stat-ed for outside edits; 0 disables |
| `resumeDays` | `14` | A plan last touched within this many days comes back in a new session in the same directory |
| `pollSeconds` | `120` | How often tracked PRs/MRs are polled with gh/glab; minimum 30 |
| `notify` | `false` | Also raise a system notification when a PR/MR starts needing attention or the model leaves a handoff note (toasts always show) |

## What it can reach

- **Reads** the tracked plan file, and lists `planDir` (default `~/.claude/plans`) for the recent-plans picker and `/waypoint use <slug>`.
- **Reads** the `HOME` environment variable, to expand `~` in paths.
- **Reads** the session's git `origin` remote through the engine (`$.session.repo`), only to know which host and repo a short `#123` / `!123` (on a `- PR:` line, in `/waypoint track`, or in a `gh pr` / `glab mr` command) belongs to.
- **Observes** Bash tool calls whose command mentions `gh` or `glab`, from the main session and from subagents alike: the command text and its output, to find PR/MR references. It reads nothing from other Bash calls. From the output it takes only the first PR/MR URL, and only when the command named no PR (`gh pr create`, a bare `gh pr view`). A `--repo` / `-R` value or PR number carrying quotes, commas, `$` or braces (a `gh` call quoted inside a script) is ignored.
- **Observes** `Write` and `Edit` calls (main session only), to re-read the plan when its file is the one written.
- **Observes** `ExitPlanMode` calls (main session only), to pick up the plan file the call names.
- **Observes** the plan-mode attachments (`plan_mode`, `plan_mode_reentry`, `plan_mode_exit`; main session only), for the plan file path and whether plan mode is on.
- **Observes** turn completion (main session only), to re-check the plan file's modification time.
- **Runs** read-only `gh pr view --json` and `glab mr view -F json`, using your existing logins: every `pollSeconds`, 750 ms after a new PR/MR is discovered, and on `/waypoint refresh`.
- **Registers** one tool, `mcp__waypoint__handoff`, which the model calls to leave (or clear) the "waiting on you" note. The tool only records what the model passes it (a summary, up to 10 items, control characters stripped, at most 1200 + 10 × (200 + 500) characters: a 200-character title and a 500-character ref per item); it runs nothing and reads nothing.
- **Adds** a short section to the system prompt while a plan is tracked or in plan mode. It asks the model to keep the step markers current: "A step is a heading whose text starts with a marker: `### [ ] WP1 — Title` pending, `[~]` in progress, `[x]` done, `[!]` blocked on the user", to edit a heading to `[~]` when starting and `[x]` when finished, to add `- PR: <url>` under a step when it opens a PR, and to call `mcp__waypoint__handoff` when it stops waiting on you (and with `clear: true` when it resumes). While a handoff note from an earlier session is showing, a second section (`waypoint:handoff`) quotes the first 120 characters of its summary and asks the model to clear or replace it once you have acted.
- **Writes** to the clipboard only when you press `p` (plan path) or `copy` (PR URL).
- **Notifies** with native system notifications only when the `notify` option is on (a PR/MR starting to need attention, a new handoff note); toasts show otherwise.
- **Stores**, in the plugin's own store: `layout` (your `/waypoint layout` choice); `last:<cwd>` = `{ path, title, at, percent, sessionId }` (to resume the plan in that directory); `waypoint:prs:plan/<plan path>` and `waypoint:prs:session/<session id>` = the tracked PR/MR entries (id, URL, title, branch, state, CI/review/merge status, when seen and polled). Closed PRs older than 7 days, and PRs/MRs the CLI reported not found three polls running, are pruned on every write and at session start; also at session start other sessions' session keys with no activity in the last day, and plan keys with no open PR and nothing newer than 7 days, are deleted. `waypoint:handoff:plan/<plan path>` and `waypoint:handoff:session/<session id>` = the handoff note (`{ summary, items, at, sessionId }`), the session key folded into the plan key when a plan becomes tracked; notes older than 30 days, and other sessions' session-key notes older than a day, are deleted at session start (never the current session's), and `/waypoint reset` deletes the current one.
- **Sends** nothing itself: it makes no network requests of its own (gh/glab do, with your logins).
- **Never** writes to repositories or to the plan file.

## Troubleshooting

- **Pane does not appear.** It opens automatically only at 144 columns or wider. Run `/waypoint` to open it at any width; below that width the band above the prompt shows the summary.
- **The pane is too tall, or too wide.** The dock is always full height; that is the engine's design, not an option. Its width comes from `paneColumns` (48 by default); a width you set by dragging the dock wins over it. `/waypoint status` ends with a `pane:` line giving the placement (`dock` or `inline`), the width the engine actually drew, and the width asked. If the drawn width differs from the one asked, `/waypoint close` then `/waypoint` opens the pane again with the requested width.
- **Hotkeys do nothing.** They work only while the pane is focused (ctrl+x, then tab).
- **No PR status, or an error note.** Check `gh auth status` / `glab auth status`. The pane shows the error class and retries with backoff.
- **Non-gitlab.com GitLab host.** Support is untested; only gitlab.com has been verified.
- **A PR appears that is not yours.** A `#123` on a `- PR:` line or a PR URL in a step is always tracked. Run `/waypoint untrack <ref>`; one that does not exist is dropped after three not-found polls.
- **See what it hooks.** Run `claude plugin validate .` in `mods/waypoint`.

## Develop

```bash
claude --plugin-dir .                       # load it in a session
claude plugin validate --strict .
claude plugin test .
npx -p typescript tsc -p .                  # after the first interactive load lays .claude-plugin/types/
```

See the repo-level `CLAUDE.md` for code conventions.

## License

MIT.
