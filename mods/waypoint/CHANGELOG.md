# Changelog

## 0.1.0 — 2026-10-12

- Plan pane, band above the prompt and status-line segment for the plan the session is working through.
- Plan parser for `[ ]` `[~]` `[x]` `[!]` `[-]` step markers, with pattern-based fallback for unmarked plans.
- PR/MR tracking for GitHub and GitLab: found from `gh`/`glab` Bash calls and plan refs, polled read-only, with an attention status per PR.
- `/waypoint` commands: close, refresh, use, track, untrack, reset, layout, status.
- Short system-prompt section asking the model to keep step markers current.
