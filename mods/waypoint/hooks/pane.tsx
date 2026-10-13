// waypoint: JSX only. Draws a precomputed PaneModel / BandModel; no I/O, no
// state writes, no `$`. Presses call the plain callbacks the wiring hands in.

import type { EngineInterface, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

import { childProgress, colorOf, glyph, shorten } from './view'
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
  const W = model.width
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
    lines.push(drawRow(kit, row, wide, mergedMore, model.shortWidth, W))
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
    const indent = wide ? '  ' : ''
    const noteLine =
      note === '' ? null : (
        <Box key="prs-note" flexDirection="row">
          <Text color="warning" dimColor wrap={T}>{indent}⚠ {note}</Text>
        </Box>
      )
    if (!model.prSection.compact) {
      if (gaps) lines.push(gap('gap-prs'))
      lines.push(
        <Box key="prs-head" flexDirection="row">
          <Text dimColor={!head.hot} wrap={T}>  Pull requests{head.before}</Text>
          <Text color={head.hot ? 'warning' : undefined} dimColor={!head.hot} bold={head.hot} wrap={T}>{head.need}</Text>
          <Text dimColor wrap={T}>{head.after}</Text>
        </Box>,
      )
      if (noteLine !== null) lines.push(noteLine)
      for (const pr of [...hot, ...others]) lines.push(drawPrWide(kit, pr, actions, W, others.includes(pr)))
    } else {
      const pr = hot[0] ?? others[0]
      if (pr !== undefined) {
        const lead = count > 0 ? `${count} PR${count === 1 ? ' needs' : 's need'} you` : 'PRs tracked'
        lines.push(
          <Box key={`pr-${pr.id}`} flexDirection="row">
            <Text color={pr.color} dimColor={pr.color === undefined} wrap={T}>{indent}{pr.glyph} {lead} · </Text>
            <Link href={pr.url} label={pr.label} />
            <Text color={pr.color} dimColor={pr.color === undefined} wrap={T}> {pr.status}</Text>
            {polledPart !== '' && <Text dimColor wrap={T}>{polledPart}</Text>}
          </Box>,
        )
      }
      if (noteLine !== null) lines.push(noteLine)
    }
  }

  if (ho !== null && ho.compact && wide) {
    lines.push(
      <Box key="handoff" flexDirection="row">
        <Text color="warning" bold wrap={T}>  {ho.line}</Text>
      </Box>,
    )
  }

  if (ho !== null && !ho.compact) {
    if (gaps) lines.push(gap('gap-handoff'))
    lines.push(
      <Box key="handoff-head" flexDirection="row">
        <Text color="warning" bold wrap={T}>  Waiting on you · {ho.fromEarlier ? 'from an earlier session · ' : ''}{ho.ago}</Text>
      </Box>,
    )
    ho.summary.forEach((s, i) =>
      lines.push(
        <Box key={`handoff-summary-${i}`} flexDirection="row">
          <Text wrap={T}>  {s}</Text>
        </Box>,
      ),
    )
    ho.items.forEach((it, i) =>
      lines.push(
        <Box key={`handoff-item-${i}`} flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={2}>
            <Text color={it.blocking ? 'warning' : undefined} dimColor={!it.blocking} bold={it.blocking}>  {it.blocking ? '!' : '·'}</Text>
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
          <Text dimColor wrap={T}>     +{ho.more} more</Text>
        </Box>,
      )
    }
  }

  if (wide) {
    const f = model.footer
    if (gaps) lines.push(gap('gap-footer'))
    lines.push(
      <Box key="footer" flexDirection="row" justifyContent="space-between">
        {f.error !== null ? (
          <Text color="warning" wrap={T}>  ⚠ {f.error}</Text>
        ) : (
          <Text dimColor wrap={T}>  {shorten(f.path, Math.max(8, W - 50))} · changed {f.changedAgo}</Text>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="refresh" hotkey="r" plain onPress={actions.refresh} />
          <Text dimColor>·</Text>
          <Button key="copy-path" label="path" hotkey="p" plain onPress={actions.copyPath} />
          <Text dimColor>·</Text>
          <Button key="close" label="close" hotkey="c" plain onPress={actions.close} />
        </Box>
      </Box>,
    )
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

function drawRow(kit: Kit, row: Row, wide: boolean, mergedMore: number, shortWidth: number, width: number): RenderElement {
  const { Box, Text } = kit
  const indent = wide ? '  ' : ''

  if (row.kind === 'done-summary') {
    const shorts = row.shorts.slice(0, 6).join(' ') + (row.shorts.length > 6 ? ' …' : '')
    return (
      <Box key="done-summary" flexDirection="row">
        <Text color="success" wrap={T}>{indent}✓{wide ? '  ' : ' '}{row.count} done · {shorts}</Text>
      </Box>
    )
  }

  if (row.kind === 'more') {
    const text = row.position === 'before' ? `↑ ${row.count} earlier` : `+${row.count} more`
    return (
      <Box key={`more-${row.position}`} flexDirection="row">
        <Text dimColor wrap={T}>{wide ? '     ' : ''}{text}</Text>
      </Box>
    )
  }

  if (row.kind === 'children') {
    return (
      <Box key="children" flexDirection="row" gap={3} paddingLeft={wide ? 5 + shortWidth + 2 : 2}>
        {row.items.slice(0, 6).map((c, i) => (
          <Text key={`child-${i}`} color={colorOf(c.status)} dimColor={c.status === 'pending'} wrap={T}>
            {glyph(c.status)} {shorten(c.text, 24)}
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
  if (st === 'blocked') notes.push(wide ? 'waiting on you' : 'needs you')
  if (mergedMore > 0) notes.push(`+${mergedMore} more`)
  const noteText = notes.length > 0 ? `  ${notes.join('  ')}` : ''

  const label = wide ? step.short.padEnd(shortWidth) : step.short
  const sep = wide ? '  ' : ' '
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
