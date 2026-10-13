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
- a "PRs needing attention" section when any tracked PR/MR needs action (failing CI, requested changes, conflicts, ready to merge), with `copy` and `untrack` buttons per row;
- a footer with the plan path and when it was last read.

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
| `/waypoint track <url\|#n\|!n>` | Track a PR/MR by URL or number |
| `/waypoint untrack <ref>` | Stop tracking a PR/MR |
| `/waypoint reset` | Forget the tracked plan |
| `/waypoint layout auto\|compact\|wide` | Choose the pane layout |
| `/waypoint status` | One-line summary |

## Keys

The pane hotkeys `r` (refresh), `p` (copy path) and `c` (close) work only while the pane is focused (ctrl+x, then tab). The pane opens automatically only at 144 columns or wider; `/waypoint` opens it at any width.

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

- Reads the tracked plan file.
- Observes Bash tool calls to `gh` and `glab` (the command and its output) to find PR/MR references.
- Runs read-only `gh pr view --json` and `glab mr view -F json` every `pollSeconds`, using your existing logins.
- Keeps tracked PR ids, titles and status, and the last plan path, in the plugin store across sessions.
- Makes no network requests of its own.
- Never writes to repositories or to the plan file.

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
