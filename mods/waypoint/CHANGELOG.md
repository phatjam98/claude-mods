# Changelog

## 0.3.0 — 2026-10-15

- Plan Style Guide (`PLAN-STYLE.md`): a one-page skeleton and four rules for writing a plan, applied in four places. Of 21 plans checked, 19 had no status markers and the parser fell back to guessing.
- Plan mode: the guide is appended to the engine's full plan-mode reminder (first request of a planning session and after a compaction, not the sparse repeats), so the model sees it while writing a plan and nowhere else; the one-paragraph rules ride in the compose section meanwhile.
- After the model writes or edits a file under the plan directory, waypoint lints it and leaves a short hidden note the model reads: what the parser saw and what to fix. Nits are reported after a full write, only fix-level problems after an edit, and an identical note is not repeated. After an edit outside plan mode the note is a pointer, not an order. What was written is never changed.
- `/waypoint lint [path|slug|n]` prints the report for the tracked plan, or the named one.
- `/waypoint conform [rewrite] [path|slug|n]` submits an instruction as a prompt from the plugin (shown in the transcript); once the session is idle the model applies the guide with the Edit tool and shows the diff. If the submit fails, it rides along with the next prompt. Additive by default (markers on existing step headings, a `## Steps` section when there are none, no prose deleted or reordered, title unchanged); `rewrite` may also reshape headings and move checkbox lines under steps.
- New option `styleGuide` (default on) gates the plan-mode text and the lint note; the commands always work.
- No parser change: plans already tracked keep their snapshots.

## 0.2.2 — 2026-10-13

- Fix: a forced re-read (`/waypoint refresh`, and now every plugin reload) always re-parses the plan. Before, it returned early when the file's content hash was unchanged, so a parser change never showed until the file was edited. The hash now carries a parser version too.

## 0.2.1 — 2026-10-13

- Fix: a marked step heading (`### [x] WP1 — …`) directly under a prose section such as `## Context` was treated as prose, so a plan with no `## Work packages` heading fell through to its checkbox lines (`0 of 17`). A marker now always makes the heading a step; only unmarked siblings need a step-like name outside prose.

## 0.2.0 — 2026-10-13

- Handoff note: the mod registers the tool `mcp__waypoint__handoff`, which the model calls when it stops waiting on you, with a short summary and the decisions, actions or answers it needs (or `clear: true` when work resumes). Toasts on set (and a native notification with `notify` on).
- The note is stored per plan (`waypoint:handoff:plan/<path>`, or per session until a plan is tracked), comes back when the plan is resumed, and is dropped after 30 days untouched.
- `/waypoint handoff` prints the note; `/waypoint handoff clear` clears it; `/waypoint reset` clears it too.
- The executing system-prompt section asks the model to call the handoff tool before stopping on the person, and to clear it on resuming.
- Pane redesign: the header shows the current step, `done of total` and the percentage; the bar spans the full width in three parts (finished `█`, the current step's share `▓`, remaining `░`) so it shows where the session is, not only how far along.
- Step rows carry one glyph each (no more `▶ ▶`); in the wide layout the current step's checkboxes are drawn one per line under its title (8 at most, then `+n more`) when the rows allow, else in one row, with shorts padded into a column and a clear hierarchy: current bold in the plan-mode colour, pending dim, blocked in warning, skipped struck through. In the wide layout, a blank line and a rule separate the sections: each section's header is drawn on its rule (`── Pull requests · … ───`, `── Waiting on you · … ───`, full width) and a plain full-width rule sits above the footer; the blank lines and the footer rule go first when rows are short.
- "Pull requests" section: a header counting those that need you, the other open ones and the last poll; rows lead with the PR/MR title (falling back to the branch), then step, status and `copy · untrack`. The pane rows now carry the title.
- "Waiting on you" section for the handoff note: when it was left, the summary wrapped to 6 lines at most (fewer when rows are tight), and one line per item (`!` when blocking) with a link when it names a tracked PR/MR or a URL. Compact draws it as one line; it and the PR section keep their rows before the step list gives up its own.
- The band reads `⚑ waiting on you (n) · …` in warning colour and the status line adds ` · needs you` while a handoff note is up.
- Footer shows the plan path with `~` for the home folder and when the plan file last changed (was: when it was last read).
- The recent-plans picker shows each plan's title and progress (`claude-mods repo + waypoint · 71% · 36m ago`, with `in ~/src/claude-mods` under it in the wide layout), not the file slug; `/waypoint` prints the same numbered list, `/waypoint use <n>` tracks the nth plan, `/waypoint use` with an unknown name replies with the list, and `/waypoint refresh` names the plan by its title.
- The docked pane asks for 48 columns (`paneColumns`) and the sectioned layout adapts from 44 columns up (one-space indents, PR rows without buttons, a two-row footer); compact is for inline and narrower.

## 0.1.0 — 2026-10-12

- Plan pane, band above the prompt and status-line segment for the plan the session is working through.
- Plan parser for `[ ]` `[~]` `[x]` `[!]` `[-]` step markers, with pattern-based fallback for unmarked plans.
- PR/MR tracking for GitHub and GitLab: found from `gh`/`glab` Bash calls and plan refs, polled read-only, with an attention status per PR.
- `/waypoint` commands: close, refresh, use, track, untrack, reset, layout, status.
- Short system-prompt section asking the model to keep step markers current.
