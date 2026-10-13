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

  if (model.kind === 'planning') {
    return (
      <Box flexDirection="column">
        <Text color="planMode" wrap={T}>⚑ planning… the plan file appears here when written</Text>
      </Box>
    )
  }

  if (model.kind === 'none-tracked') {
    return (
      <Box flexDirection="column">
        <Text wrap={T}>No plan tracked. Enter plan mode, or pick a recent plan:</Text>
        {model.recent.length === 0 && <Text dimColor wrap={T}>No plans found in ~/.claude/plans.</Text>}
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
        <Text color="warning" wrap={T}>⚠ plan file missing: {model.path}</Text>
        {c !== null && <Text dimColor wrap={T}>last seen: {c.done + c.skipped}/{c.total} done</Text>}
        <Text dimColor wrap={T}>/waypoint reset to stop tracking it, or /waypoint use &lt;path&gt;</Text>
      </Box>
    )
  }

  if (model.kind === 'no-steps') {
    return (
      <Box flexDirection="column">
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
  const lines: RenderElement[] = []

  lines.push(
    <Box key="header" flexDirection="row" justifyContent="space-between">
      <Text bold wrap={T}>{model.header.title}</Text>
      <Text>  {model.header.right}</Text>
    </Box>,
  )
  lines.push(
    <Box key="bar" flexDirection="row">
      <Text color="planMode" wrap={T}>{model.bar.on}</Text>
      <Text color="inactive" wrap={T}>{model.bar.off}</Text>
    </Box>,
  )
  if (wide) lines.push(<Box key="gap" flexDirection="row"><Text> </Text></Box>)

  const rows = model.rows
  rows.forEach((row, i) => {
    const next = rows[i + 1]
    // In compact a trailing `+n more` shares the last step's line.
    if (!wide && row.kind === 'more' && row.position === 'after' && rows[i - 1]?.kind === 'step') return
    const mergedMore = !wide && row.kind === 'step' && next?.kind === 'more' && next.position === 'after' ? next.count : 0
    lines.push(drawRow(kit, row, wide, mergedMore))
  })

  if (model.prSection !== null) {
    const { count, rows: prs } = model.prSection
    if (wide) {
      const head = `── PRs needing attention (${count}) `
      lines.push(
        <Box key="prs-head" flexDirection="row">
          <Text dimColor wrap={T}>{head + '─'.repeat(Math.max(0, model.width - head.length))}</Text>
        </Box>,
      )
      for (const pr of prs) lines.push(drawPrWide(kit, pr, actions))
    } else {
      const pr = prs[0]
      if (pr !== undefined) {
        const lead = count > 0 ? `${count} PR${count === 1 ? ' needs' : 's need'} you` : 'PRs tracked'
        lines.push(
          <Box key={`pr-${pr.id}`} flexDirection="row">
            <Text color={pr.color} wrap={T}>{pr.glyph} {lead} · </Text>
            <Link href={pr.url} label={pr.label} />
            <Text color={pr.color} wrap={T}> {pr.status}</Text>
          </Box>,
        )
      }
    }
  }

  if (wide) {
    const f = model.footer
    lines.push(
      <Box key="footer" flexDirection="row" justifyContent="space-between">
        {f.error !== null ? (
          <Text color="warning" wrap={T}>⚠ {f.error}</Text>
        ) : (
          <Text dimColor wrap={T}>{f.path} · read {f.readAgo}</Text>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="refresh" hotkey="r" plain onPress={actions.refresh} />
          <Button key="copy-path" label="path" hotkey="p" plain onPress={actions.copyPath} />
          <Button key="close" label="close" hotkey="c" plain onPress={actions.close} />
        </Box>
      </Box>,
    )
  }

  return <Box flexDirection="column">{lines}</Box>
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

function drawRow(kit: Kit, row: Row, wide: boolean, mergedMore: number): RenderElement {
  const { Box, Text } = kit

  if (row.kind === 'done-summary') {
    const shorts = row.shorts.slice(0, 6).join(' ') + (row.shorts.length > 6 ? ' …' : '')
    return (
      <Box key="done-summary" flexDirection="row">
        <Text color="success" wrap={T}>{wide ? '  ' : ''}✓ {row.count} done · {shorts}</Text>
      </Box>
    )
  }

  if (row.kind === 'more') {
    const text = row.position === 'before' ? `↑ ${row.count} earlier` : `+${row.count} more`
    return (
      <Box key={`more-${row.position}`} flexDirection="row">
        <Text dimColor wrap={T}>{wide ? '    ' : ''}{text}</Text>
      </Box>
    )
  }

  if (row.kind === 'children') {
    return (
      <Box key="children" flexDirection="row" gap={3} paddingLeft={wide ? 10 : 2}>
        {row.items.slice(0, 6).map(c => (
          <Text color={colorOf(c.status)} dimColor={c.status === 'pending'} wrap={T}>
            {glyph(c.status)} {shorten(c.text, 24)}
          </Text>
        ))}
      </Box>
    )
  }

  const { step, isCurrent } = row
  const color = isCurrent ? 'planMode' : colorOf(step.status)
  const label = wide ? step.short.padEnd(5) : step.short
  const notes: string[] = []
  if (isCurrent) {
    const kids = childProgress(step)
    if (kids !== '') notes.push(kids)
  }
  if (step.status === 'blocked') notes.push(wide ? 'waiting on you' : 'needs you')
  if (mergedMore > 0) notes.push(`+${mergedMore} more`)

  return (
    <Box key={`step-${step.id}`} flexDirection="row" justifyContent="space-between">
      <Text
        color={color}
        bold={isCurrent}
        dimColor={!isCurrent && step.status === 'pending'}
        strikethrough={step.status === 'skipped'}
        wrap={T}
      >
        {wide ? (isCurrent ? '▶ ' : '  ') : ''}
        {glyph(step.status)} {label} {step.title}
      </Text>
      {notes.length > 0 && (
        <Text color={step.status === 'blocked' ? 'warning' : color} dimColor={mergedMore > 0 && notes.length === 1}>
          {'  '}
          {notes.join('  ')}
        </Text>
      )}
    </Box>
  )
}

function drawPrWide(kit: Kit, pr: PrLine, actions: PaneActions): RenderElement {
  const { Box, Text, Button, Link } = kit
  return (
    <Box key={`pr-${pr.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" gap={2}>
        <Text color={pr.color}>  {pr.glyph}</Text>
        <Link href={pr.url} label={pr.label} />
        <Text dimColor>{pr.stepShort}</Text>
        <Text wrap={T}>{shorten(pr.branch || pr.repoName, 32)}</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        <Text color={pr.color}>{pr.status}</Text>
        <Button key={`copy-${pr.id}`} label="copy" plain dimColor onPress={p => actions.copyUrl(pr.url, p)} />
        <Button key={`untrack-${pr.id}`} label="untrack" plain dimColor onPress={p => actions.untrack(pr.id, p)} />
      </Box>
    </Box>
  )
}
