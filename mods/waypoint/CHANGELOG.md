# Changelog

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
- The docked pane asks for 48 columns (`paneColumns`) and the sectioned layout adapts from 44 columns up (one-space indents, PR rows without buttons, a two-row footer); compact is for inline and narrower.

## 0.1.0 — 2026-10-12

- Plan pane, band above the prompt and status-line segment for the plan the session is working through.
- Plan parser for `[ ]` `[~]` `[x]` `[!]` `[-]` step markers, with pattern-based fallback for unmarked plans.
- PR/MR tracking for GitHub and GitLab: found from `gh`/`glab` Bash calls and plan refs, polled read-only, with an attention status per PR.
- `/waypoint` commands: close, refresh, use, track, untrack, reset, layout, status.
- Short system-prompt section asking the model to keep step markers current.
