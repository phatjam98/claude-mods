// The system-prompt section waypoint appends (id `waypoint:plan`, scope `session`).
// Static per (path, mode): never interpolate counts or progress, or every edit
// to the plan file would bust the prompt cache.

export const SECTION_ID = 'waypoint:plan'

export function planSection(path: string, inPlanMode: boolean): string {
  return inPlanMode ? planningText() : executingText(path)
}

function executingText(path: string): string {
  return [
    '# Waypoint: plan progress',
    `A pane tracks the plan at ${path} and draws its steps. Keep the file's status markers current:`,
    '- A step is a heading whose text starts with a marker: `### [ ] WP1 — Title` pending, `[~]` in progress, `[x]` done, `[!]` blocked on the user. An unmarked step heading counts as pending.',
    '- When you start a step, Edit its heading to `[~]`; when it is finished, `[x]`; if you need the user, `[!]`. Keep one `[~]` at a time. Child `- [ ]` items under a step may be ticked `- [x]` as you go.',
    '- When you open or wait on a PR/MR for a step, add a line `- PR: <url>` under that step.',
    'Change only markers and such lines; do not restructure the plan file.',
  ].join('\n')
}

function planningText(): string {
  return [
    '# Waypoint: plan progress',
    'A pane will draw the plan file\'s steps as progress. When you write the plan, give each unit of work its own heading at one depth (`### WP1 — Title` or `### Step 1: Title`; `##` is fine for a short plan) and start the heading text with `[ ]`, e.g. `### [ ] WP1 — Title`. Leave Context, Decisions, Verification and other prose sections unmarked. During execution the marker becomes `[~]` (in progress), `[x]` (done) or `[!]` (blocked on the user).',
  ].join('\n')
}
