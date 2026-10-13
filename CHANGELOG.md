# Changelog

## waypoint 0.2.2 — 2026-10-13

Fix: the plan is re-read after a plugin reload, so a parser change shows without an edit to the file.

## waypoint 0.2.1 — 2026-10-13

Fix: marked step headings under a prose section (no `## Work packages` heading) were ignored and the plan fell through to its checkbox lines.

## waypoint 0.2.0 — 2026-10-13

Visual redesign of the pane (place-in-plan bar, titled PR rows, section spacing) and a "Waiting on you" handoff note the model leaves through `mcp__waypoint__handoff`.

## waypoint 0.1.0 — 2026-10-12

First release: plan progress pane with PR/MR attention tracking for GitHub and GitLab.
