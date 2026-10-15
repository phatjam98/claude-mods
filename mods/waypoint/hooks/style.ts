// waypoint: the Plan Style Guide and a pure linter for plan files. No `$`, no I/O.
import type { PlanMode } from '../types'
import { hashText, isNonStep, isStepLike, normalize, parsePlan, scanHeadings, type Heading } from './plan'

export const PLAN_STYLE_GUIDE = `# Waypoint: plan style
A pane reads this plan file and draws its steps, so give the file this shape. Prose is free; only step lines are structural.

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

Rules:
- Every unit of work is a \`###\` heading that starts with \`[ ]\`, numbered WP1, WP2, …; nothing else is a step. Checkbox lines are children of a step, never steps.
- Prose lives under \`## Context\`, under a step, or in a named closing section; never as a bare \`##\` heading that reads like a unit of work.
- Markers \`[ ]\` \`[~]\` \`[x]\` \`[!]\` \`[-]\` and \`- PR:\` lines are the only lines that change while the plan runs.
- Revising a plan another session may have open: add or re-mark steps; keep its prose as it is.`

export const PLAN_STYLE_RULES =
  'Plan shape: one `#` title; `## Context` for the why; each unit of work a `### [ ] WPn — Title` heading (one depth, about 45 characters, children as `- [ ]` lines); unmarked closing sections such as `## Verification`. Checkbox lines are children, never steps.'

export type LintSeverity = 'fix' | 'nit'
export interface LintFinding {
  code: string
  severity: LintSeverity
  line?: number
  message: string
  /** The heading or step title the finding is about, when there is one; keys the finding across line shifts. */
  anchor?: string
}
/** One entry per step the parser found, in order. */
export interface LintHeading { line: number; title: string; marked: boolean }
export interface LintReport { mode: PlanMode; steps: number; headings: LintHeading[]; findings: LintFinding[] }

/** The pane truncates step titles past roughly this many columns. */
export const TITLE_WIDTH = 45
const MAX_CHILDREN = 8
const NOTE_LINES = 6

/** A step label such as `WP1`, `WP6b`, `Step 2a`, `1.` or `1)`. */
const LABEL_RE = /^(?:(?:WP|Step|Phase|Part|PR|Stage|Milestone|Task|Sprint|Wave)\s?[A-Z]?\d+[a-z]?|[A-Z]{1,2}\d{1,2}[a-z]?|\d{1,3}[a-z]?[.)]|\d{1,3}\s*[—–:-])(?=[\s—–:.)/-]|$)/i
export const hasStepLabel = (heading: string): boolean => LABEL_RE.test(heading.trim()) || isStepLike(heading)

const ANY_CHECKBOX_RE = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+\[[ xX~!\-]\](?:[ \t]|$)/
const len = (s: string): number => Array.from(s).length
const hashes = (h: Heading): string => '#'.repeat(h.depth)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export function lintPlan(text: string): LintReport {
  const snap = parsePlan(text, { path: 'plan.md', mtimeMs: 0, now: 0 })
  const scan = scanHeadings(normalize(text).text)
  const mode = snap.mode
  const steps = snap.steps
  const fix: LintFinding[] = []
  const nit: LintFinding[] = []
  const headingAt = (line: number): Heading | undefined => scan.headings.find(h => h.idx === line - 1)

  // ---- fix ----
  if (steps.length === 0) {
    fix.push({ code: 'no-steps', severity: 'fix', message: 'No steps found; add a `### [ ] WP1 — Title` heading for each unit of work.' })
  } else if (mode !== 'marked') {
    fix.push({ code: 'heuristic-steps', severity: 'fix', message: heuristicMessage(mode, steps.length) })
  }

  if (mode === 'marked') {
    const loose: number[] = []
    scan.lines.forEach((l, i) => {
      if (scan.fenced[i] || !ANY_CHECKBOX_RE.test(l)) return
      const line = i + 1
      if (!steps.some(s => line > s.line && line <= s.endLine)) loose.push(line)
    })
    if (loose.length > 0)
      fix.push({
        code: 'loose-checkboxes',
        severity: 'fix',
        line: loose[0],
        message: `${plural(loose.length, 'checkbox line')} ${loose.length === 1 ? 'sits' : 'sit'} outside any step; move ${loose.length === 1 ? 'it' : 'them'} under a step heading or make ${loose.length === 1 ? 'it a plain bullet' : 'them plain bullets'}.`,
      })
  }

  const marked = scan.headings.filter(h => h.depth >= 2 && h.marker !== null)
  const depths = [...new Set(marked.map(h => h.depth))].sort((a, b) => a - b)
  if (depths.length > 1) {
    const main = snap.stepDepth ?? depths[0] ?? 3
    const odd = marked.find(h => h.depth !== main)
    fix.push({
      code: 'mixed-depth',
      severity: 'fix',
      line: odd ? odd.idx + 1 : undefined,
      anchor: odd?.text,
      message: `Marked headings sit at ${depths.map(d => '#'.repeat(d)).join(' and ')}; put every step at one depth (\`###\` in the guide) and turn the others into \`- [ ]\` children.`,
    })
  }

  if (mode === 'marked' && snap.stepDepth !== null) {
    const stepHeadings = steps.map(s => headingAt(s.line)).filter((h): h is Heading => h !== undefined)
    const stepParents = new Set(stepHeadings.map(h => h.parent))
    for (const h of scan.headings) {
      if (h.depth !== snap.stepDepth || h.marker !== null || isNonStep(h.text)) continue
      // A prose sub-heading under a prose section (e.g. `### Reuse` under `## Context`) is fine,
      // unless the steps themselves live under that section.
      if (h.underNonStep && !stepParents.has(h.parent)) continue
      nit.push({
        code: 'unmarked-step',
        severity: 'nit',
        line: h.idx + 1,
        anchor: h.text,
        message: `Add \`[ ]\` to "${hashes(h)} ${h.text}" or move it under a closing section.`,
      })
    }
  }

  // ---- nit ----
  const h1 = scan.headings.find(h => h.depth === 1)
  if (!h1) nit.push({ code: 'no-title', severity: 'nit', message: 'No `#` title; start the file with `# <what this plan delivers>`.' })
  else if (/^plan:/i.test(h1.text))
    nit.push({ code: 'title-prefix', severity: 'nit', line: h1.idx + 1, anchor: h1.text, message: 'Drop the `Plan:` prefix from the title; the pane already says it is a plan.' })

  for (const s of mode === 'marked' ? steps : []) {
    const n = len(s.title)
    if (n > TITLE_WIDTH)
      nit.push({ code: 'long-title', severity: 'nit', line: s.line, anchor: s.title, message: `"${s.title}" is ${n} characters; shorten it, the pane truncates past ${TITLE_WIDTH}.` })
  }
  for (const s of steps) {
    if (s.children.length > MAX_CHILDREN)
      nit.push({
        code: 'many-children',
        severity: 'nit',
        line: s.line,
        anchor: s.title,
        message: `Step ${s.short} has ${s.children.length} checkbox children; split it into smaller steps or keep at most ${MAX_CHILDREN}.`,
      })
  }
  const active = steps.filter(s => s.status === 'active')
  if (active.length > 1)
    nit.push({
      code: 'multiple-active',
      severity: 'nit',
      line: active[1]?.line,
      anchor: active.map(s => s.title).join(' | '),
      message: `${active.length} steps are marked \`[~]\`; keep one in progress and set the others to \`[ ]\` or \`[x]\`.`,
    })
  if (mode === 'marked' && steps.length > 0 && !steps.some(s => hasStepLabel(headingAt(s.line)?.text ?? '')))
    nit.push({ code: 'unnumbered', severity: 'nit', message: 'No step carries a number; label them `WP1 — `, `WP2 — `, … so they can be referred to.' })

  const headings = steps.map(s => ({ line: s.line, title: s.title, marked: s.marked }))
  return { mode, steps: steps.length, headings, findings: sortFindings([...fix, ...nit]) }
}

/** By line, findings without a line first; stable otherwise. */
function sortFindings(fs: LintFinding[]): LintFinding[] {
  return fs
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.line ?? 0) - (b.f.line ?? 0) || a.i - b.i)
    .map(x => x.f)
}

function heuristicMessage(mode: PlanMode, n: number): string {
  const steps = plural(n, 'step')
  switch (mode) {
    case 'pattern':
      return `Mode pattern: the ${steps} were guessed from heading names; start every step heading with \`[ ]\`.`
    case 'sections':
      return `Mode sections: every \`##\` heading was read as a step (${steps}); mark the real steps \`### [ ] WPn — Title\` and keep prose under \`## Context\`.`
    case 'checkboxes':
      return `Mode checkboxes: top-level checkboxes were read as steps (${steps}); put them under \`### [ ] WPn — Title\` step headings.`
    case 'ordered':
      return `Mode ordered: a numbered list was read as steps (${steps}); turn each item into a \`### [ ] WPn — Title\` heading.`
    default:
      return `Mode ${mode}: steps were found without markers (${steps}); start every step heading with \`[ ]\`.`
  }
}

/** "5 steps from markers", "5 steps from ## sections, none marked", "0 steps found". */
export function summaryOf(r: LintReport): string {
  if (r.steps === 0) return '0 steps found'
  const n = plural(r.steps, 'step')
  switch (r.mode) {
    case 'marked': return `${n} from markers`
    case 'pattern': return `${n} guessed from heading names, none marked`
    case 'sections': return `${n} from ## sections, none marked`
    case 'checkboxes': return `${n} from top-level checkboxes`
    case 'ordered': return `${n} from a numbered list, none marked`
    default: return `${n} found`
  }
}

const CODE_WIDTH = 18
const LOC_WIDTH = 9
const row = (f: LintFinding): string =>
  `  ${(f.line === undefined ? '' : `line ${f.line}`).padEnd(LOC_WIDTH)}${f.code.padEnd(CODE_WIDTH)}${f.message}`

/** Plain-text report for `/waypoint lint`. */
export function lintText(report: LintReport, opts: { title: string; file: string }): string {
  const out = [`${opts.title} (${opts.file}): ${summaryOf(report)}`]
  const fixes = report.findings.filter(f => f.severity === 'fix')
  const nits = report.findings.filter(f => f.severity === 'nit')
  if (fixes.length > 0) out.push('Fix', ...fixes.map(row))
  if (nits.length > 0) out.push('Nits', ...nits.map(row))
  if (report.findings.length === 0) out.push('Looks fine.')
  else out.push('Run /waypoint conform to apply the guide without touching prose, or /waypoint conform rewrite to reshape headings too.')
  return out.join('\n')
}

const bullet = (f: LintFinding): string => `- ${f.message}${f.line === undefined ? '' : ` (line ${f.line})`}`

/** Hidden context after the model writes (all findings) or edits (fixes only) a plan file; undefined when clean. */
export function writeNote(report: LintReport, opts: { file: string; kind: 'write' | 'edit'; inPlanMode: boolean }): string | undefined {
  const shown = opts.kind === 'edit' ? report.findings.filter(f => f.severity === 'fix') : report.findings
  if (shown.length === 0) return undefined
  const lines = shown.slice(0, NOTE_LINES).map(bullet)
  if (shown.length > NOTE_LINES) lines.push(`… and ${shown.length - NOTE_LINES} more`)
  return [
    `Waypoint read ${opts.file} after that ${opts.kind}: ${summaryOf(report)}.`,
    ...lines,
    opts.inPlanMode
      ? 'Fix the shape now while the plan is in hand; /waypoint lint repeats this report.'
      : 'If this shape is intentional, ignore this note. /waypoint conform applies the guide without touching prose; /waypoint lint repeats this report.',
    '',
    PLAN_STYLE_RULES,
  ].join('\n')
}

/** Hidden context for `/waypoint conform` (additive) and `/waypoint conform rewrite`. */
export function conformInstruction(report: LintReport, opts: { path: string; title: string; rewrite: boolean }): string {
  const headingMode = report.mode === 'marked' || report.mode === 'pattern' || report.mode === 'sections'
  const listed =
    report.headings.length === 0
      ? ['- none']
      : report.headings.map(h => `- line ${h.line}: ${h.title} (${h.marked ? 'marked' : 'unmarked'})`)
  const how = opts.rewrite
    ? [
        'Rewrite mode: you may reshape headings into the guide skeleton.',
        '- Put every step at one depth (`###`), labelled `WP1 — `, `WP2 — `, … with titles of about 45 characters.',
        '- Move checkbox lines under the step they belong to.',
        '- You may drop a `Plan:` prefix from the `#` title.',
        '- Reword and move headings as needed, but never delete a line of prose.',
      ]
    : [
        'Additive mode: change as little as possible. Keep every existing prose line and its order.',
        headingMode && report.headings.length > 0
          ? report.mode === 'marked'
            ? '- Only add a marker to these existing step headings (the lines listed above); do not reword or move them.'
            : '- Only add a marker to these existing step headings (the lines listed above), or, if these headings are not units of work, leave them alone and add a `## Steps` section before any closing section whose `### [ ] WPn — Title` entries name the sections or paragraphs they execute. Do not reword or move them.'
          : '- There are no step headings: add a `## Steps` section before any closing section, whose `### [ ] WPn — Title` entries name the sections or paragraphs they execute.',
        '- Add new `- [ ]` lines only where the prose lists outcomes, and leave every existing bullet exactly as it is.',
        '- Do not change the title.',
      ]
  const findings =
    report.findings.length === 0
      ? ['- none']
      : report.findings.map(f => `- ${f.line === undefined ? '' : `line ${f.line} `}${f.code}: ${f.message}`)
  return [
    `/waypoint conform${opts.rewrite ? ' rewrite' : ''}: bring the plan "${opts.title}" at ${opts.path} into the Waypoint plan style.`,
    'Change it with the Edit tool, one edit at a time; never rewrite the file with Write.',
    `The parser took these as steps (${summaryOf(report)}):`,
    ...listed,
    ...how,
    'In both modes:',
    '- Mark steps the prose already says are done as `[x]`.',
    '- Mark at most one step `[~]`.',
    '- Leave excluded closing sections (Context, Decisions, Open questions, Verification and the like) unmarked.',
    PLAN_STYLE_RULES,
    'Lint findings:',
    ...findings,
    'Show the diff of your edits in the reply. After the edit the pane re-reads the file by itself.',
  ].join('\n')
}

/**
 * A short stable key over mode, step count and sorted `code@anchor` (or `code`), so the caller can
 * skip an identical note. Line numbers are left out: a `- PR:` line above a heading keeps the key.
 */
export function findingsKey(report: LintReport): string {
  const parts = report.findings.map(f => (f.anchor === undefined ? f.code : `${f.code}@${f.anchor}`)).sort()
  return hashText(`${report.mode}:${report.steps}|${parts.join(',')}`)
}

