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

The pane shows:

- the plan title and a progress bar with `done of total` and a percentage;
- the step list, one glyph per step: `✓` done, `▶` in progress, `·` pending, `!` blocked on you, `–` skipped;
- in the wide layout, the current step's child checkboxes;
- a "PRs needing attention" section while any tracked PR/MR is open: those needing action (failing CI, requested changes, conflicts, ready to merge) first, then, in the wide layout, the other open ones under "other PRs" (5 rows at most), with `copy` and `untrack` buttons per row. Its header says when PRs were last polled, and a gh/glab error (not logged in, rate-limited, not installed) shows as a note under it. Merged and closed PRs are not listed;
- in the wide layout, a footer with the plan path, when it was last read, and `refresh` / `path` / `close` buttons (the compact layout has no footer or buttons).

With no plan tracked, `/waypoint` lists up to 5 recent plans from `planDir`, newest first, each with a hotkey `1`–`5` to track it.

When the pane is not placed (narrow terminal, or closed), a one-line band above the prompt carries the summary (for example the current step, steps done, PRs needing you) with an `open` button.

The status line carries a short segment: `⚑ 3/9 WP2`, with `!` after the step when blocked, `✓` when complete.

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

## Commands

| Command | Does |
|---|---|
| `/waypoint` | Re-read the plan and open the pane (at any width) |
| `/waypoint close` | Close the pane |
| `/waypoint refresh` | Re-read the plan and poll tracked PRs now |
| `/waypoint use <path\|slug>` | Track a plan by path, or by slug in `planDir` |
| `/waypoint track <ref>` | Track a PR/MR: a URL, `#n` / `!n` (against this repo), `group/project!n`, or `host/path#n` / `host/path!n` |
| `/waypoint untrack <ref>` | Stop tracking a PR/MR: any form `track` takes, its label, or its full id (`github.com/o/r#5`) |
| `/waypoint reset` | Forget the tracked plan |
| `/waypoint layout auto\|compact\|wide` | Choose the pane layout; this choice wins over the `layout` option |
| `/waypoint layout` | Forget that choice, so the `layout` option applies again |
| `/waypoint status` | One-line summary |

## Keys

The pane hotkeys `r` (refresh), `p` (copy path) and `c` (close) exist only in the wide layout, and `1`–`5` (pick a recent plan) only when no plan is tracked. All work only while the pane is focused (ctrl+x, then tab). The pane opens automatically only at 144 columns or wider; `/waypoint` opens it at any width.

## Configure

Set these in `/config`, or under `pluginConfigs["waypoint"].options` in `settings.json`.

| Option | Default | Purpose |
|---|---|---|
| `openOnStart` | `true` | Open the pane when a plan is found at session start (placed only in wide terminals; the band shows otherwise) |
| `band` | `true` | Draw a one-line plan summary above the prompt while the pane is not placed |
| `statusLine` | `true` | Pin the current step under the prompt |
| `layout` | `auto` | `auto` picks compact inline and wide when docked; or `compact` / `wide` |
| `planDir` | `~/.claude/plans` | Where `/waypoint use <slug>` looks for plan files |
| `planPollSeconds` | `5` | How often the plan file is stat-ed for outside edits; 0 disables |
| `resumeDays` | `14` | A plan last touched within this many days comes back in a new session in the same directory |
| `pollSeconds` | `120` | How often tracked PRs/MRs are polled with gh/glab; minimum 30 |
| `notify` | `false` | Also raise a system notification when a PR/MR starts needing attention (toasts always show) |

## What it can reach

- **Reads** the tracked plan file, and lists `planDir` (default `~/.claude/plans`) for the recent-plans picker and `/waypoint use <slug>`.
- **Reads** the `HOME` environment variable, to expand `~` in paths.
- **Reads** the session's git `origin` remote through the engine (`$.session.repo`), only to know which host and repo a bare `#123` / `!123` belongs to.
- **Observes** Bash tool calls whose command mentions `gh` or `glab`, from the main session and from subagents alike: the command text and its output, to find PR/MR references. It reads nothing from other Bash calls. From the output it takes only the first PR/MR URL, and only when the command named no PR (`gh pr create`, a bare `gh pr view`).
- **Observes** `Write` and `Edit` calls (main session only), to re-read the plan when its file is the one written.
- **Observes** `ExitPlanMode` calls (main session only), to pick up the plan file the call names.
- **Observes** the plan-mode attachments (`plan_mode`, `plan_mode_reentry`, `plan_mode_exit`; main session only), for the plan file path and whether plan mode is on.
- **Observes** turn completion (main session only), to re-check the plan file's modification time.
- **Runs** read-only `gh pr view --json` and `glab mr view -F json`, using your existing logins: every `pollSeconds`, 750 ms after a new PR/MR is discovered, and on `/waypoint refresh`.
- **Adds** a short section to the system prompt while a plan is tracked or in plan mode. It asks the model to keep the step markers current: "A step is a heading whose text starts with a marker: `### [ ] WP1 — Title` pending, `[~]` in progress, `[x]` done, `[!]` blocked on the user", to edit a heading to `[~]` when starting and `[x]` when finished, and to add `- PR: <url>` under a step when it opens a PR.
- **Writes** to the clipboard only when you press `p` (plan path) or `copy` (PR URL).
- **Notifies** with native system notifications only when the `notify` option is on; toasts show otherwise.
- **Stores**, in the plugin's own store: `layout` (your `/waypoint layout` choice); `last:<cwd>` = `{ path, title, at, percent, sessionId }` (to resume the plan in that directory); `waypoint:prs:plan/<plan path>` and `waypoint:prs:session/<session id>` = the tracked PR/MR entries (id, URL, title, branch, state, CI/review/merge status, when seen and polled). Closed PRs older than 7 days are pruned on every write; at session start other sessions' session keys with no activity in the last day, and plan keys with no open PR and nothing newer than 7 days, are deleted.
- **Sends** nothing itself: it makes no network requests of its own (gh/glab do, with your logins).
- **Never** writes to repositories or to the plan file.

## Troubleshooting

- **Pane does not appear.** It opens automatically only at 144 columns or wider. Run `/waypoint` to open it at any width; below that width the band above the prompt shows the summary.
- **Hotkeys do nothing.** They work only while the pane is focused (ctrl+x, then tab).
- **No PR status, or an error note.** Check `gh auth status` / `glab auth status`. The pane shows the error class and retries with backoff.
- **Non-gitlab.com GitLab host.** Support is untested; only gitlab.com has been verified.
- **A PR appears that is not yours.** A `#123` in plan text can be a false positive. Run `/waypoint untrack <ref>`.
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
