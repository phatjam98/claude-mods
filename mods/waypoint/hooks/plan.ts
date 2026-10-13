// waypoint: pure plan parser, markdown -> PlanSnapshot. No `$`, no I/O.
import type { PlanCounts, PlanLink, PlanMode, PlanSnapshot, Step, StepStatus, SubItem } from '../types'

export const MAX_BYTES = 512 * 1024

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const MARKER_RE = /^\[([ xX~!\-])\][ \t]*(.*)$/
const CHILD_RE = /^(?: {0,8}|\t{0,2})(?:[-*+]|\d{1,3}[.)])[ \t]+\[([ xX~!\-])\][ \t]+(.*)$/
const TOP_CHECKBOX_RE = /^(?:[-*+]|\d{1,3}[.)])[ \t]+\[([ xX~!\-])\][ \t]+(.*)$/
const ORDERED_RE = /^ {0,3}\d{1,3}[.)][ \t]+(.+)$/
const STEP_LIKE_RE =
  /^(?:WP|Step|Phase|Part|PR|Stage|Milestone|Task|Sprint|Wave)\s?[A-Z]?\d|^[A-Z]{1,2}\d{1,2}\b|^\d{1,2}[.)](?:\s|$)|^\d{1,2}\s*[—–:-]\s/i
const SHORT_RE =
  /^(?:((?:WP|Step|Phase|Part|PR|Stage|Milestone|Task|Sprint|Wave)\s?[A-Z]?\d+[a-z]?|[A-Z]{1,2}\d{1,2}[a-z]?)\b|(\d{1,2})(?:[.)]|\s*[—–:-]))/i
const NON_STEP_RE = new RegExp(
  '^(?:' +
    [
      'context', 'background', 'summary', 'overview', 'tl;dr', 'goals', 'objectives', 'motivation',
      'scope', 'out of scope', 'non-goals', 'decisions', 'assumptions', 'constraints',
      'execution model', 'ground rules', 'principles', 'architecture', 'design notes',
      'verification', 'verify', 'validation', 'acceptance', 'risks', 'open questions', 'notes',
      'references', 'related', 'appendix', 'addendum', 'files', 'critical files', 'follow-ups',
      'source material', 'effort', 'estimates', 'needs\\b.*?\\b(?:call|decision|input)s?',
      'known blockers', 'prerequisites', 'inputs checklist', 'coordination', 'rollback', 'glossary',
    ].join('|') +
    ')(?![\\w-])',
  'i',
)

const MARK_STATUS: Record<string, StepStatus> = {
  ' ': 'pending', x: 'done', X: 'done', '~': 'active', '!': 'blocked', '-': 'skipped',
}
const statusOf = (ch: string | undefined): StepStatus => MARK_STATUS[ch ?? ' '] ?? 'pending'

// ---------- normalize / hash ----------

const utf8Len = (s: string, upTo = s.length): number => {
  let n = 0
  for (let i = 0; i < upTo; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) n += 4, i++
    else n += 3
  }
  return n
}

/** Strip BOM, CRLF/CR -> LF, cut at the last newline before MAX_BYTES. `bytes` is the UTF-8 size before the cut. */
export function normalize(raw: string, maxBytes = MAX_BYTES): { text: string; bytes: number; truncated: boolean } {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const bytes = utf8Len(text)
  if (bytes <= maxBytes) return { text, bytes, truncated: false }
  let n = 0
  let k = 0
  for (; k < text.length; k++) {
    const c = text.charCodeAt(k)
    const w = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : 3
    if (n + w > maxBytes) break
    n += w
    if (w === 4) k++
  }
  const nl = text.lastIndexOf('\n', k - 1)
  return { text: nl >= 0 ? text.slice(0, nl + 1) : text.slice(0, k), bytes, truncated: true }
}

/** FNV-1a 32-bit over UTF-16 code units, 8 hex chars. */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ---------- titles ----------

export type TitleLink = { label: string; href: string }

/** Markdown links keep their label; autolinks and bare URLs are dropped. All hrefs are collected. */
export function cleanTitle(s: string): { text: string; links: TitleLink[] } {
  const links: TitleLink[] = []
  let t = s.replace(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, href: string) => {
    links.push({ label: label.trim() || href, href })
    return label
  })
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, href: string) => {
    links.push({ label: href, href })
    return ''
  })
  t = t.replace(/https?:\/\/[^\s)>\]]+/g, href => {
    links.push({ label: href, href })
    return ''
  })
  t = t.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
  t = t.replace(/[\s—–:|,-]+$/, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()
  return { text: t, links }
}

export const isNonStep = (title: string): boolean => NON_STEP_RE.test(title.trim())
export const isStepLike = (title: string): boolean => STEP_LIKE_RE.test(title.trim())

/** `WP2`, `Step 3`, `PR 1`, `D0`, `1`, else `${index+1}`; title is the rest after the label and its separator. */
export function shortLabel(text: string, index: number): { short: string; title: string } {
  const m = SHORT_RE.exec(text)
  if (!m) return { short: String(index + 1), title: text }
  const short = (m[1] ?? m[2] ?? '').trim()
  const rest = text.slice(m[0].length).replace(/^[\s—–:\-.)/]+/, '')
  return { short, title: rest || text }
}

// ---------- scanning ----------

export type Heading = {
  /** 0-based line index */
  idx: number
  depth: number
  marker: StepStatus | null
  text: string
  links: TitleLink[]
  /** index into the headings array of the nearest preceding shallower heading of depth >= 2 */
  parent: number | null
  /** a non-step ancestor (not counting itself) */
  underNonStep: boolean
  nonStep: boolean
}

export type Scan = { lines: string[]; fenced: boolean[]; headings: Heading[] }

export function scanHeadings(text: string): Scan {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const fenced: boolean[] = []
  const headings: Heading[] = []
  let open: { ch: string; len: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const f = FENCE_RE.exec(line)
    if (open) {
      fenced.push(true)
      const fc = f?.[1]
      if (fc && fc[0] === open.ch && fc.length >= open.len && line.trim() === fc) open = null
      continue
    }
    if (f?.[1]) {
      fenced.push(true)
      open = { ch: f[1][0] ?? '`', len: f[1].length }
      continue
    }
    fenced.push(false)
    const h = HEADING_RE.exec(line)
    if (!h) continue
    const depth = (h[1] ?? '').length
    let rest = h[2] ?? ''
    let marker: StepStatus | null = null
    const mk = MARKER_RE.exec(rest)
    if (mk) {
      marker = statusOf(mk[1])
      rest = mk[2] ?? ''
    }
    const { text: clean, links } = cleanTitle(rest)
    let parent: number | null = null
    if (depth >= 2) {
      for (let j = headings.length - 1; j >= 0; j--) {
        const p = headings[j]
        if (p && p.depth >= 2 && p.depth < depth) {
          parent = j
          break
        }
      }
    }
    const par = parent === null ? undefined : headings[parent]
    const underNonStep = par ? par.nonStep : false
    headings.push({ idx: i, depth, marker, text: clean, links, parent, underNonStep, nonStep: underNonStep || isNonStep(clean) })
  }
  return { lines, fenced, headings }
}

// ---------- selection ----------

export type Selection =
  | { mode: 'marked' | 'pattern' | 'sections'; depth: number; headings: Heading[] }
  | { mode: 'checkboxes' | 'ordered'; depth: null; items: number[] }
  | { mode: 'none'; depth: null }

export function selectSteps(scan: Scan): Selection {
  const cands = scan.headings.filter(h => h.depth >= 2 && h.depth <= 4)

  const marked = cands.filter(h => h.marker !== null)
  if (marked.length > 0) {
    const depth = Math.min(...marked.map(h => h.depth))
    const parents = new Set(marked.filter(h => h.depth === depth).map(h => h.parent))
    const hs = cands.filter(
      h => h.depth === depth && !h.underNonStep && (h.marker !== null || (isStepLike(h.text) && parents.has(h.parent))),
    )
    if (hs.length > 0) return { mode: 'marked', depth, headings: hs }
  }

  for (const depth of [3, 2]) {
    const c = cands.filter(h => h.depth === depth && !h.nonStep)
    const like = c.map(h => isStepLike(h.text))
    if (like.filter(Boolean).length < 2) continue
    const hs = c.filter((h, i) => {
      if (like[i]) return true
      if (h.marker !== null) return false
      const before = c.some((o, j) => j < i && like[j] && o.parent === h.parent)
      const after = c.some((o, j) => j > i && like[j] && o.parent === h.parent)
      return before && after
    })
    return { mode: 'pattern', depth, headings: hs }
  }

  const sections = cands.filter(h => h.depth === 2 && !h.nonStep)
  if (sections.length >= 2) return { mode: 'sections', depth: 2, headings: sections }

  const boxes: number[] = []
  scan.lines.forEach((l, i) => {
    if (!scan.fenced[i] && TOP_CHECKBOX_RE.test(l)) boxes.push(i)
  })
  if (boxes.length > 0) return { mode: 'checkboxes', depth: null, items: boxes }

  const ordered = firstOrderedList(scan)
  if (ordered.length >= 2) return { mode: 'ordered', depth: null, items: ordered }

  return { mode: 'none', depth: null }
}

function firstOrderedList(scan: Scan): number[] {
  let items: number[] = []
  for (let i = 0; i < scan.lines.length; i++) {
    const l = scan.lines[i] ?? ''
    const isHeading = scan.headings.some(h => h.idx === i)
    if (!scan.fenced[i] && !isHeading && ORDERED_RE.test(l)) {
      items.push(i)
      continue
    }
    if (items.length === 0) continue
    // a list continues across blank and indented lines (fenced lines count as indented content)
    if (!isHeading && (l.trim() === '' || /^[ \t]/.test(l) || scan.fenced[i])) continue
    if (items.length >= 2) return items
    items = []
  }
  return items
}

// ---------- step building ----------

const isHeadingLine = (scan: Scan, i: number): Heading | undefined => scan.headings.find(h => h.idx === i)

function childrenOf(scan: Scan, from: number, to: number): SubItem[] {
  const out: SubItem[] = []
  for (let i = from; i <= to; i++) {
    if (scan.fenced[i]) continue
    const m = CHILD_RE.exec(scan.lines[i] ?? '')
    if (m) out.push({ text: cleanTitle(m[2] ?? '').text, status: statusOf(m[1]), line: i + 1 })
  }
  return out
}

function linksOf(scan: Scan, from: number, to: number): PlanLink[] {
  const out: PlanLink[] = []
  for (let i = from; i <= to; i++) {
    if (scan.fenced[i]) continue
    for (const l of cleanTitle(scan.lines[i] ?? '').links) out.push({ ...l, line: i + 1 })
  }
  return out
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'step'

type Draft = Omit<Step, 'index' | 'id'>

function headingDrafts(scan: Scan, hs: Heading[]): Draft[] {
  return hs.map((h, k) => {
    const next = scan.headings.find(o => o.idx > h.idx && o.depth <= h.depth)
    const end = (next ? next.idx : scan.lines.length) - 1
    const { short, title } = shortLabel(h.text, k)
    return {
      short,
      title,
      status: h.marker ?? 'pending',
      marked: h.marker !== null,
      depth: h.depth,
      line: h.idx + 1,
      endLine: Math.max(end, h.idx) + 1,
      body: scan.lines.slice(h.idx + 1, end + 1).join('\n'),
      children: childrenOf(scan, h.idx + 1, end),
      links: [...h.links.map(l => ({ ...l, line: h.idx + 1 })), ...linksOf(scan, h.idx + 1, end)],
    }
  })
}

function listDrafts(scan: Scan, items: number[], checkbox: boolean): Draft[] {
  return items.map((idx, k) => {
    const nextItem = items[k + 1]
    let end = idx
    for (let i = idx + 1; i < scan.lines.length; i++) {
      if (i === nextItem || isHeadingLine(scan, i)) break
      const l = scan.lines[i] ?? ''
      if (!scan.fenced[i] && l.trim() !== '' && !/^[ \t]/.test(l)) break
      end = i
    }
    while (end > idx && (scan.lines[end] ?? '').trim() === '') end--
    const line = scan.lines[idx] ?? ''
    const m = checkbox ? TOP_CHECKBOX_RE.exec(line) : ORDERED_RE.exec(line)
    const raw = (checkbox ? m?.[2] : m?.[1]) ?? line
    const { text, links } = cleanTitle(raw)
    return {
      short: String(k + 1),
      title: text,
      status: checkbox ? statusOf(m?.[1]) : 'pending',
      marked: checkbox,
      depth: 0,
      line: idx + 1,
      endLine: end + 1,
      body: scan.lines.slice(idx + 1, end + 1).join('\n'),
      children: childrenOf(scan, idx + 1, end),
      links: [...links.map(l => ({ ...l, line: idx + 1 })), ...linksOf(scan, idx + 1, end)],
    }
  })
}

function withIds(drafts: Draft[]): Step[] {
  const seen = new Map<string, number>()
  return drafts.map((d, index) => {
    const base = slug(`${d.short} ${d.title}`)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...d, index, id: n === 1 ? base : `${base}-${n}` }
  })
}

/** The first `#` heading outside fences, else the first short (≤ 80) non-heading line before any other text; null when neither. */
function scanTitle(scan: Scan): string | null {
  const h1 = scan.headings.find(h => h.depth === 1)
  if (h1 && h1.text) return h1.text
  for (let i = 0; i < scan.lines.length; i++) {
    const l = (scan.lines[i] ?? '').trim()
    if (scan.fenced[i] || l === '' || isHeadingLine(scan, i)) continue
    const t = cleanTitle(l).text
    if (t && t.length <= 80) return t
    break
  }
  return null
}

const displayOf = (title: string): string => title.replace(/^plan:\s*/i, '') || title

/** A plan file's title as the parser takes it (`displayTitle` without a `Plan:` prefix); null when the text has none. */
export function planTitle(raw: string): { title: string; displayTitle: string } | null {
  const title = scanTitle(scanHeadings(normalize(raw).text))
  return title === null ? null : { title, displayTitle: displayOf(title) }
}

function titleOf(scan: Scan, path: string): string {
  const t = scanTitle(scan)
  if (t !== null) return t
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/i, '') || path
}

export function parsePlan(raw: string, opts: { path: string; mtimeMs: number; now: number }): PlanSnapshot {
  const { text, bytes, truncated } = normalize(raw)
  const warnings: string[] = []
  if (truncated) warnings.push(`plan larger than ${MAX_BYTES / 1024} KiB; parsed the first part only`)
  const scan = scanHeadings(text)
  const sel = selectSteps(scan)

  let drafts: Draft[] = []
  if (sel.mode === 'marked' || sel.mode === 'pattern' || sel.mode === 'sections') drafts = headingDrafts(scan, sel.headings)
  else if (sel.mode === 'checkboxes' || sel.mode === 'ordered') drafts = listDrafts(scan, sel.items, sel.mode === 'checkboxes')
  const mode: PlanMode = sel.mode
  if (mode === 'none') warnings.push('no steps found: mark step headings with [ ], [~], [x]')

  const steps = withIds(drafts)
  const counts: PlanCounts = { total: steps.length, done: 0, active: 0, blocked: 0, pending: 0, skipped: 0 }
  for (const s of steps) counts[s.status]++
  // floor: 100% only when every step is finished (199 of 200 is 99%, not a rounded 100%).
  const percent = counts.total === 0 ? 0 : Math.floor((100 * (counts.done + counts.skipped)) / counts.total)
  const first = (st: StepStatus): number | null => steps.find(s => s.status === st)?.index ?? null
  const currentIndex = first('active') ?? first('blocked') ?? first('pending')

  const title = titleOf(scan, opts.path)
  return {
    path: opts.path,
    title,
    displayTitle: displayOf(title),
    steps,
    mode,
    stepDepth: sel.depth,
    counts,
    percent,
    currentIndex,
    mtimeMs: opts.mtimeMs,
    bytes,
    truncated,
    hash: hashText(text),
    parsedAt: opts.now,
    warnings,
  }
}
