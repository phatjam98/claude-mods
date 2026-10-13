// waypoint: JSX only. Draws a precomputed PaneModel / BandModel; no I/O, no
// state writes, no `$`. Presses call the plain callbacks the wiring hands in.

import type { EngineInterface, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

import { childProgress, colorOf, glyph, MAX_CHILD_LINES, ruleTail, shorten } from './view'
import type { SubItem } from '../types'
import type { BandModel, PaneModel, PrLine, Row } from './view'

export type PaneActions = {
  refresh: (press: UiPressArgument) => void
  copyPath: (press: UiPressArgument) => void
  close: (press: UiPressArgument) => void
  open: (press: UiPressArgument) => void
  pick: (path: string, press: UiPressArgument) => void
  copyUrl: (url: string, press: UiPressArgument) => void
  untrack: (id: string, press: UiPressArgument) => void
}

type PaneEvent = RenderInput<'Pane'>
type BandEvent = RenderInput<'AbovePrompt'>
/** The surface's element table: the wiring resolves it (`$.ui.resolve(e)`) and hands it in. */
export type Kit = ReturnType<EngineInterface['ui']['resolve']>

const T = 'truncate-end' as const

/** The wide footer's hotkeys as the engine draws them: `r: refresh · p: path · c: close`. */
export const FOOTER_KEYS_WIDTH = 31
/** The least blank between the wide footer's left text and its hotkeys. */
export const FOOTER_GAP = 2

export function drawPane(kit: Kit, _e: PaneEvent, model: PaneModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link } = kit

  // Every state but the plan's leads with the handoff note, when there is one.
  const handoffLead =
    model.kind !== 'plan' && model.handoffLine !== null ? (
      <Box key="handoff" flexDirection="row">
        <Text color="warning" bold wrap={T}>{model.handoffLine}</Text>
      </Box>
    ) : null

  if (model.kind === 'planning') {
    return (
      <Box flexDirection="column">
        {handoffLead}
        <Text color="planMode" wrap={T}>⚑ planning… the plan file appears here when written</Text>
      </Box>
    )
  }

  if (model.kind === 'none-tracked') {
    return (
      <Box flexDirection="column">
        {handoffLead}
        <Text wrap={T}>No plan tracked. Enter plan mode, or pick a recent plan:</Text>
        {model.recent.length === 0 && <Text dimColor wrap={T}>No plans found in {model.planDir}.</Text>}
        {model.recent.map((r, i) => (
          <Box key={`recent-${r.path}`} flexDirection="row">
            <Button key={`pick-${r.path}`} label={`${r.name} · ${r.ago}`} hotkey={String(i + 1)} plain onPress={p => actions.pick(r.path, p)} />
          </Box>
        ))}
      </Box>
    )
  }

  if (model.kind === 'missing') {
    const c = model.lastCounts
    return (
      <Box flexDirection="column">
        {handoffLead}
        <Text color="warning" wrap={T}>⚠ plan file missing: {model.path}</Text>
        {c !== null && <Text dimColor wrap={T}>last seen: {c.done + c.skipped}/{c.total} done</Text>}
        <Text dimColor wrap={T}>/waypoint reset to stop tracking it, or /waypoint use &lt;path&gt;</Text>
      </Box>
    )
  }

  if (model.kind === 'no-steps') {
    return (
      <Box flexDirection="column">
        {handoffLead}
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap={T}>⚑ {model.title}</Text>
          <Text dimColor>  no steps found</Text>
        </Box>
        <Text dimColor wrap={T}>No step headings recognised. Mark them</Text>
        <Text dimColor wrap={T}>`### [ ] WP1 — Title`, or /waypoint use &lt;path&gt;.</Text>
      </Box>
    )
  }

  const wide = model.layout === 'wide'
  const narrow = model.narrow
  const W = model.width
  /** The wide layouts' left indent: two spaces, one when narrow. */
  const ind = narrow ? ' ' : '  '
  const lines: RenderElement[] = []
  const gap = (key: string) => (
    <Box key={key} flexDirection="row">
      <Text> </Text>
    </Box>
  )

  lines.push(
    <Box key="header" flexDirection="row" justifyContent="space-between">
      <Text bold wrap={T}>{model.header.title}</Text>
      <Box flexDirection="row">
        <Text dimColor={!wide}>  {model.header.lead}</Text>
        <Text bold color="planMode">{model.header.pct}</Text>
      </Box>
    </Box>,
  )
  const b = model.bar
  lines.push(
    <Box key="bar" flexDirection="row">
      {b.done !== '' && <Text color="success" wrap={T}>{b.done}</Text>}
      {b.current !== '' && <Text color={b.currentColor} wrap={T}>{b.current}</Text>}
      {b.rest !== '' && <Text color="inactive" wrap={T}>{b.rest}</Text>}
    </Box>,
  )
  const gaps = wide && model.gaps
  if (gaps) lines.push(gap('gap-steps'))

  const rows = model.rows
  rows.forEach((row, i) => {
    const next = rows[i + 1]
    // In compact a trailing `+n more` shares the last step's line.
    if (!wide && row.kind === 'more' && row.position === 'after' && rows[i - 1]?.kind === 'step') return
    const mergedMore = !wide && row.kind === 'step' && next?.kind === 'more' && next.position === 'after' ? next.count : 0
    if (row.kind === 'children' && row.perLine) lines.push(...drawChildLines(kit, row.items, titleColumn(narrow, model.shortWidth), W))
    else lines.push(drawRow(kit, row, wide, narrow, mergedMore, model.shortWidth, W))
  })

  const ho = model.handoff
  if (ho !== null && ho.compact && !wide) {
    lines.push(
      <Box key="handoff" flexDirection="row">
        <Text color="warning" bold wrap={T}>{ho.line}</Text>
      </Box>,
    )
  }

  if (model.prSection !== null) {
    const { count, rows: hot, others, polled, note, head } = model.prSection
    const polledPart = polled === null ? '' : ` · polled ${polled}`
    const indent = wide ? ind : ''
    const noteLine =
      note === '' ? null : (
        <Box key="prs-note" flexDirection="row">
          <Text color="warning" dimColor wrap={T}>{indent}⚠ {narrow ? shorten(note, W - 3) : note}</Text>
        </Box>
      )
    if (!model.prSection.compact) {
      if (gaps) lines.push(gap('gap-prs'))
      // A rule carrying the header: `── Pull requests · … ───…` to exactly the width.
      const tail = ruleTail(`── Pull requests${head.before}${head.need}${head.after}`, W)
      lines.push(
        <Box key="prs-head" flexDirection="row">
          <Text dimColor>── </Text>
          <Text dimColor={!head.hot} wrap={T}>Pull requests{head.before}</Text>
          <Text color={head.hot ? 'warning' : undefined} dimColor={!head.hot} bold={head.hot} wrap={T}>{head.need}</Text>
          <Text dimColor wrap={T}>{head.after}</Text>
          {tail !== '' && <Text dimColor wrap={T}>{tail}</Text>}
        </Box>,
      )
      if (noteLine !== null) lines.push(noteLine)
      for (const pr of [...hot, ...others]) lines.push(narrow ? drawPrNarrow(kit, pr, W, others.includes(pr)) : drawPrWide(kit, pr, actions, W, others.includes(pr)))
    } else {
      const pr = hot[0] ?? others[0]
      if (pr !== undefined) {
        const lead = count > 0 ? `${count} PR${count === 1 ? ' needs' : 's need'} you` : 'PRs tracked'
        const used = Array.from(`${indent}${pr.glyph} ${lead} · ${pr.label} ${pr.status}${polledPart}`).length
        const showPolled = polledPart !== '' && (!narrow || used <= W)
        lines.push(
          <Box key={`pr-${pr.id}`} flexDirection="row">
            <Text color={pr.color} dimColor={pr.color === undefined} wrap={T}>{indent}{pr.glyph} {lead} · </Text>
            <Link href={pr.url} label={pr.label} />
            <Text color={pr.color} dimColor={pr.color === undefined} wrap={T}> {pr.status}</Text>
            {showPolled && <Text dimColor wrap={T}>{polledPart}</Text>}
          </Box>,
        )
      }
      if (noteLine !== null) lines.push(noteLine)
    }
  }

  if (ho !== null && ho.compact && wide) {
    lines.push(
      <Box key="handoff" flexDirection="row">
        <Text color="warning" bold wrap={T}>{ind}{ho.line}</Text>
      </Box>,
    )
  }

  if (ho !== null && !ho.compact) {
    if (gaps) lines.push(gap('gap-handoff'))
    const head = `Waiting on you · ${ho.fromEarlier ? (narrow ? 'earlier · ' : 'from an earlier session · ') : ''}${ho.ago}`
    const tail = ruleTail(`── ${head}`, W)
    lines.push(
      <Box key="handoff-head" flexDirection="row">
        <Text dimColor>── </Text>
        <Text color="warning" bold wrap={T}>{head}</Text>
        {tail !== '' && <Text dimColor wrap={T}>{tail}</Text>}
      </Box>,
    )
    ho.summary.forEach((s, i) =>
      lines.push(
        <Box key={`handoff-summary-${i}`} flexDirection="row">
          <Text wrap={T}>{ind}{s}</Text>
        </Box>,
      ),
    )
    ho.items.forEach((it, i) =>
      lines.push(
        <Box key={`handoff-item-${i}`} flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={narrow ? 1 : 2}>
            <Text color={it.blocking ? 'warning' : undefined} dimColor={!it.blocking} bold={it.blocking}>{ind}{it.blocking ? '!' : '·'}</Text>
            <Text dimColor>{it.kind}</Text>
            <Text wrap={T}>{it.title}</Text>
          </Box>
          {it.ref !== null &&
            (it.ref.href !== null ? (
              <Box flexDirection="row">
                <Text>  </Text>
                <Link href={it.ref.href} label={it.ref.text} />
              </Box>
            ) : (
              <Text dimColor>  {it.ref.text}</Text>
            ))}
        </Box>,
      ),
    )
    if (ho.more > 0) {
      lines.push(
        <Box key="handoff-more" flexDirection="row">
          <Text dimColor wrap={T}>{narrow ? '   ' : '     '}+{ho.more} more</Text>
        </Box>,
      )
    }
  }

  if (wide) {
    const f = model.footer
    if (gaps) {
      lines.push(gap('gap-footer'))
      lines.push(
        <Box key="footer-rule" flexDirection="row">
          <Text dimColor wrap={T}>{'─'.repeat(W)}</Text>
        </Box>,
      )
    }
    const hotkeys = (
      <Box key="footer-keys" flexDirection="row" gap={1} paddingLeft={narrow ? 1 : 0}>
        <Button key="refresh" label="refresh" hotkey="r" plain onPress={actions.refresh} />
        <Text dimColor>·</Text>
        <Button key="copy-path" label="path" hotkey="p" plain onPress={actions.copyPath} />
        <Text dimColor>·</Text>
        <Button key="close" label="close" hotkey="c" plain onPress={actions.close} />
      </Box>
    )
    if (narrow) {
      // Two rows: the path (or the error), then the hotkeys.
      lines.push(
        <Box key="footer" flexDirection="row">
          {f.error !== null ? (
            <Text color="warning" wrap={T}> {shorten(`⚠ ${f.error}`, W - 1)}</Text>
          ) : (
            <Text dimColor wrap={T}> {shorten(`${f.path} · changed ${f.changedAgo}`, W - 1)}</Text>
          )}
        </Box>,
        hotkeys,
      )
    } else {
      // One row: the left text, a spacer of at least FOOTER_GAP, then the hotkeys
      // (FOOTER_KEYS_WIDTH as the engine draws them). The left text is cut to fit.
      const left = W - FOOTER_KEYS_WIDTH - FOOTER_GAP - 2
      const suffix = ` · changed ${f.changedAgo}`
      const text = f.error !== null ? shorten(`⚠ ${f.error}`, Math.max(4, left)) : `${shorten(f.path, Math.max(4, left - Array.from(suffix).length))}${suffix}`
      const pad = Math.max(FOOTER_GAP, W - 2 - Array.from(text).length - FOOTER_KEYS_WIDTH)
      lines.push(
        <Box key="footer" flexDirection="row">
          {f.error !== null ? <Text color="warning" wrap={T}>  {text}</Text> : <Text dimColor wrap={T}>  {text}</Text>}
          <Text wrap={T}>{' '.repeat(pad)}</Text>
          {hotkeys}
        </Box>,
      )
    }
  }

  return <Box flexDirection="column">{lines}</Box>
}

/** One line in place of the pane when building it failed. */
export function drawError(kit: Kit, text: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column">
      <Text color="warning" wrap={T}>⚠ {text}</Text>
    </Box>
  )
}

export function drawBand(kit: Kit, _e: BandEvent, model: BandModel, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row">
      <Text color={model.color} wrap={T}>{model.text} </Text>
      <Button key="open" label="open" plain onPress={actions.open} />
    </Box>
  )
}

/** Where a wide step's title starts: indent, glyph, gap, the padded short, gap. Children line up with it. */
const titleColumn = (narrow: boolean, shortWidth: number): number => (narrow ? 1 + 1 + 1 + shortWidth + 1 : 2 + 1 + 2 + shortWidth + 2)

function drawRow(kit: Kit, row: Row, wide: boolean, narrow: boolean, mergedMore: number, shortWidth: number, width: number): RenderElement {
  const { Box, Text } = kit
  const indent = !wide ? '' : narrow ? ' ' : '  '

  if (row.kind === 'done-summary') {
    const shorts = row.shorts.slice(0, 6).join(' ') + (row.shorts.length > 6 ? ' …' : '')
    return (
      <Box key="done-summary" flexDirection="row">
        <Text color="success" wrap={T}>{indent}✓{wide && !narrow ? '  ' : ' '}{row.count} done · {narrow ? shorten(shorts, width - 13) : shorts}</Text>
      </Box>
    )
  }

  if (row.kind === 'more') {
    const text = row.position === 'before' ? `↑ ${row.count} earlier` : `+${row.count} more`
    return (
      <Box key={`more-${row.position}`} flexDirection="row">
        <Text dimColor wrap={T}>{!wide ? '' : narrow ? '   ' : '     '}{text}</Text>
      </Box>
    )
  }

  if (row.kind === 'children') {
    const pad = wide ? titleColumn(narrow, shortWidth) : 2
    return (
      <Box key="children" flexDirection="row" gap={3} paddingLeft={pad}>
        {(narrow ? fitInline(row.items, width - pad) : row.items.slice(0, 6).map(c => ({ c, text: shorten(c.text, 24) }))).map(({ c, text }, i) => (
          <Text key={`child-${i}`} color={colorOf(c.status)} dimColor={c.status === 'pending'} wrap={T}>
            {glyph(c.status)} {text}
          </Text>
        ))}
      </Box>
    )
  }

  const { step, isCurrent } = row
  const st = step.status
  const notes: string[] = []
  if (isCurrent) {
    const kids = childProgress(step)
    if (kids !== '') notes.push(kids)
  }
  if (st === 'blocked') notes.push(wide && !narrow ? 'waiting on you' : 'needs you')
  if (mergedMore > 0) notes.push(`+${mergedMore} more`)
  const noteText = notes.length > 0 ? `  ${notes.join('  ')}` : ''

  const label = wide ? step.short.padEnd(shortWidth) : step.short
  const sep = wide && !narrow ? '  ' : ' '
  const lead = `${indent}${glyph(st)}${sep}`
  const room = width - Array.from(lead).length - Array.from(label).length - sep.length - Array.from(noteText).length
  const title = shorten(step.title, Math.max(4, room))

  const glyphColor = isCurrent && st !== 'blocked' ? 'planMode' : colorOf(st)
  const strong = isCurrent || st === 'blocked'
  const textColor = st === 'blocked' ? 'warning' : isCurrent ? 'planMode' : st === 'skipped' ? 'subtle' : undefined
  const dim = st === 'pending' && !isCurrent

  return (
    <Box key={`step-${step.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row">
        <Text color={glyphColor} bold={strong} dimColor={dim}>{lead}</Text>
        <Text color={textColor} bold={strong} dimColor={dim} strikethrough={st === 'skipped'}>{label}{sep}</Text>
        <Text color={textColor} bold={strong} dimColor={dim} strikethrough={st === 'skipped'} wrap={T}>{title}</Text>
      </Box>
      {noteText !== '' && (
        <Text color={st === 'blocked' ? 'warning' : isCurrent ? 'planMode' : undefined} dimColor={mergedMore > 0 && notes.length === 1}>
          {noteText}
        </Text>
      )}
    </Box>
  )
}

/** Narrow: as many children as fit in one row of `room` cells, each cut to 16, three cells apart (at least the first). */
function fitInline(items: SubItem[], room: number): { c: SubItem; text: string }[] {
  const out: { c: SubItem; text: string }[] = []
  let used = 0
  for (const c of items.slice(0, 6)) {
    const text = shorten(c.text, 16)
    const cost = (out.length > 0 ? 3 : 0) + 2 + Array.from(text).length
    if (used + cost > room) break
    out.push({ c, text })
    used += cost
  }
  const first = items[0]
  if (out.length === 0 && first !== undefined) out.push({ c: first, text: shorten(first.text, Math.max(4, room - 2)) })
  return out
}

/** Wide: the current step's children one per line under its title (`pad` cells in), up to 8, then `+n more`. */
function drawChildLines(kit: Kit, items: SubItem[], pad: number, width: number): RenderElement[] {
  const { Box, Text } = kit
  const out = items.slice(0, MAX_CHILD_LINES).map((c, i) => (
    <Box key={`child-${i}`} flexDirection="row" paddingLeft={pad}>
      <Text color={colorOf(c.status)} dimColor={c.status === 'pending'} strikethrough={c.status === 'skipped'} wrap={T}>
        {glyph(c.status)} {shorten(c.text, Math.max(4, width - pad - 2))}
      </Text>
    </Box>
  ))
  if (items.length > MAX_CHILD_LINES) {
    out.push(
      <Box key="child-more" flexDirection="row" paddingLeft={pad}>
        <Text dimColor wrap={T}>+{items.length - MAX_CHILD_LINES} more</Text>
      </Box>,
    )
  }
  return out
}

/** `  ○  #1  <title>   WP5    draft   copy · untrack`, the title cut to what is left. */
function drawPrWide(kit: Kit, pr: PrLine, actions: PaneActions, width: number, quiet: boolean): RenderElement {
  const { Box, Text, Button, Link } = kit
  const name = pr.title || pr.branch || pr.repoName
  const fixed = 2 + 1 + 2 + Array.from(pr.label).length + 2 + 3 + Array.from(pr.stepShort).length + 2 + Array.from(pr.status).length + 2 + 14
  const color = quiet ? undefined : pr.color
  return (
    <Box key={`pr-${pr.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={2}>
        <Text color={color} dimColor={color === undefined}>  {pr.glyph}</Text>
        <Link href={pr.url} label={pr.label} />
        <Text dimColor={quiet} wrap={T}>{shorten(name, Math.max(8, width - fixed))}</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>{pr.stepShort}</Text>
        <Text color={pr.color} dimColor={pr.color === undefined || quiet}>{pr.status}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key={`copy-${pr.id}`} label="copy" plain dimColor onPress={p => actions.copyUrl(pr.url, p)} />
          <Text dimColor>·</Text>
          <Button key={`untrack-${pr.id}`} label="untrack" plain dimColor onPress={p => actions.untrack(pr.id, p)} />
        </Box>
      </Box>
    </Box>
  )
}

/** Narrow: ` ○ #1 <title>  draft`; no step short and no buttons (the link opens it; `/waypoint untrack` remains). */
function drawPrNarrow(kit: Kit, pr: PrLine, width: number, quiet: boolean): RenderElement {
  const { Box, Text, Link } = kit
  const name = pr.title || pr.branch || pr.repoName
  // indent 1, glyph 1, gap 1, label, gap 1, title, at least 2, status
  const fixed = 1 + 1 + 1 + Array.from(pr.label).length + 1 + 2 + Array.from(pr.status).length
  const color = quiet ? undefined : pr.color
  return (
    <Box key={`pr-${pr.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={1}>
        <Text color={color} dimColor={color === undefined}> {pr.glyph}</Text>
        <Link href={pr.url} label={pr.label} />
        <Text dimColor={quiet} wrap={T}>{shorten(name, Math.max(4, width - fixed))}</Text>
      </Box>
      <Text color={pr.color} dimColor={pr.color === undefined || quiet}>{pr.status}</Text>
    </Box>
  )
}
