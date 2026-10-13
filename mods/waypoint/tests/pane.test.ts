// WP3 mounts: the pane at 40/80/120 columns on terminal and desktop, special states, the PR section, the band.
import { test, expect, mock } from 'claude-code/testing'
import { ZERO_STEPS } from './fixtures'
import { gh, stderr } from './fixtures/prs'

const HOME = '/home/t'
const PLAN = `${HOME}/.claude/plans/purring-origami.md`
const NOW = 1_800_000_000_000
const SURFACES = ['terminal', 'desktop'] as const

const NINE = [
  '# Plan: ship the widget',
  '',
  '## Work packages',
  '',
  ...Array.from({ length: 9 }, (_, i) => {
    const m = i < 3 ? 'x' : i === 3 ? '~' : ' '
    const title = i === 3 ? 'Draw the pane' : `Step number ${i}`
    const kids = i === 3 ? '\n- [x] alpha-child\n- [ ] beta-child\n' : ''
    return `### [${m}] WP${i} — ${title}\n${kids}`
  }),
  '## Verification',
  '- run it',
].join('\n')

function world(on: any, files: Record<string, string> = {}, run?: () => { exitCode: number; stdout: string; stderr: string }) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  const fs: Record<string, string> = { ...files }
  const copies: string[] = []
  const closes: string[] = []
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.repo', () => ({ value: { root: '/work', remote: 'git@github.com:phatjam98/eventhorizon.git', internal: false, name: null } }))
  on('fs.stat', (_: any, e: any) =>
    e.path in fs ? { value: { kind: 'file', size: fs[e.path]!.length, mtimeMs: NOW - 1000, isLink: false } } : { deny: 'ENOENT' },
  )
  on('fs.read', (_: any, e: any) => (e.path in fs ? { value: fs[e.path] } : { deny: 'ENOENT' }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path in fs }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { ...(run ? run() : { exitCode: 0, stdout: JSON.stringify(gh.failing), stderr: '' }), isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_: any, e: any) => {
    closes.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.copy', (_: any, e: any) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }))
  on('command.register', () => ({ value: { command: 'waypoint' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('tool.call', (_: any, e: any) => ({ ref: 1, result: {}, text: e.tool === 'Bash' ? 'https://github.com/phatjam98/eventhorizon/pull/13' : 'ok' }))
  return { clock, fs, copies, closes }
}

const planMode = ($: any) =>
  $.prompt.attachment({ type: 'plan_mode', text: 'r', origin: { kind: 'engine' }, detail: { reminder: 'full', planFilePath: PLAN, hasPlan: true } })
const command = ($: any, args: string) => $.command.run({ command: 'waypoint', args, origin: { kind: 'person' }, presentation: 'text' })

/** 40 columns draws inline (compact) in 6 rows; 80 and 120 dock (wide) with room to spare. */
const mountPane = ($: any, surface: (typeof SURFACES)[number], cols: number) =>
  $.ui.mount({
    plugin: 'waypoint',
    surface,
    component: 'Pane',
    requestId: 'waypoint',
    props: { bodyColumns: cols, placement: cols < 60 ? 'inline' : 'dock', scroll: { bodyRows: cols < 60 ? 6 : 20 } } as any,
  })

const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100 }
const mountBand = ($: any, surface: (typeof SURFACES)[number], props: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: { ...BAND, ...props } as any })

for (const cols of [40, 80, 120]) {
  test(`pane at ${cols} columns: progress, current step, ${cols < 60 ? '+n more, no children' : 'children'}`, async ($, on) => {
    world(on, { [PLAN]: NINE })
    await planMode($)
    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, cols)
      expect(await ui.find({ type: 'Text', text: cols < 60 ? /3\/9 33%/ : /3 of 9 · 33%/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Draw the pane/ })).toBeDefined()
      if (cols < 60) {
        expect(await ui.find({ type: 'Text', text: /\+\d+ more/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /alpha-child/ })).toBeUndefined()
      } else {
        expect(await ui.find({ type: 'Text', text: /alpha-child/ })).toBeDefined()
        expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()
      }
      await ui.unmount()
    }
  })
}

test('pane footer buttons: copy the path, close the pane', async ($, on) => {
  const w = world(on, { [PLAN]: NINE })
  await planMode($)
  const ui = await mountPane($, 'terminal', 100)
  await ui.press({ key: 'copy-path' })
  expect(w.copies).toEqual([PLAN])
  await ui.press({ key: 'close' })
  expect(w.closes).toEqual(['waypoint'])
  await ui.unmount()
})

test('zero steps: the marking hint', async ($, on) => {
  world(on, { [PLAN]: ZERO_STEPS })
  await planMode($)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 80)
    expect(await ui.find({ type: 'Text', text: /No step headings recognised/ })).toBeDefined()
    await ui.unmount()
  }
})

test('missing file: the warning with the path and a reset hint', async ($, on) => {
  const w = world(on, { [PLAN]: NINE })
  await command($, 'use purring-origami')
  delete w.fs[PLAN]
  await command($, 'refresh')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, 80)
    expect(await ui.find({ type: 'Text', text: /plan file missing: .*purring-origami\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/waypoint reset/ })).toBeDefined()
    await ui.unmount()
  }
})

test('planning before the plan file exists', async ($, on) => {
  world(on)
  await $.prompt.attachment({ type: 'plan_mode', text: 'r', origin: { kind: 'engine' }, detail: { reminder: 'full', planFilePath: PLAN, hasPlan: false } } as any)
  const ui = await mountPane($, 'terminal', 80)
  expect(await ui.find({ type: 'Text', text: /planning… the plan file appears here/ })).toBeDefined()
  await ui.unmount()
})

test('PR section: wide lists PRs needing attention; compact shows one line', async ($, on) => {
  const w = world(on, { [PLAN]: NINE })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  for (const surface of SURFACES) {
    let ui = await mountPane($, surface, 120)
    expect(await ui.find({ type: 'Text', text: /PRs needing attention \(1\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ci failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `untrack-github.com/phatjam98/eventhorizon#13` })).toBeDefined()
    await ui.unmount()
    ui = await mountPane($, surface, 40)
    expect(await ui.find({ type: 'Text', text: /1 PR needs you/ })).toBeDefined()
    await ui.unmount()
  }
})

test('PR section: the header says when it last polled; a poll error note is drawn under it', async ($, on) => {
  const w = world(on, { [PLAN]: NINE }, () => ({ exitCode: 1, stdout: '', stderr: stderr.ghAuth }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await w.clock.advance(120_000)
  for (const cols of [120, 40]) {
    const ui = await mountPane($, 'terminal', cols)
    expect(await ui.find({ type: 'Text', text: /polled 2m ago/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /gh not logged in — run gh auth login/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band: shows the current step; quiet under a survey and once the pane is placed', async ($, on) => {
  world(on, { [PLAN]: NINE })
  await planMode($)
  for (const surface of SURFACES) {
    let ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: /⚑ WP3 of 9 · 3 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'open' })).toBeDefined()
    await ui.unmount()
    ui = await mountBand($, surface, { hasSurvey: true })
    expect(await ui.find({ type: 'Text', text: /WP3 of 9/ })).toBeUndefined()
    await ui.unmount()
  }
  await command($, '')
  const ui = await mountBand($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /WP3 of 9/ })).toBeUndefined()
  await ui.unmount()
})

test('band: quiet when nothing is tracked', async ($, on) => {
  world(on)
  const ui = await mountBand($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /⚑/ })).toBeUndefined()
  await ui.unmount()
})

test('band option off: quiet', { options: { band: false } }, async ($, on) => {
  world(on, { [PLAN]: NINE })
  await planMode($)
  const ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /WP3 of 9/ })).toBeUndefined()
  await ui.unmount()
})
