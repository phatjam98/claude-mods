// WP3 mounts: the pane at 40/80/120 columns on terminal and desktop, special states, the PR section, the band.
import { test, expect, mock } from 'claude-code/testing'
import { ZERO_STEPS } from './fixtures'
import { gh, stderr } from './fixtures/prs'

const HOME = '/home/t'
const PLAN = `${HOME}/.claude/plans/purring-origami.md`
const NOW = 1_800_000_000_000
const SURFACES = ['terminal', 'desktop'] as const
const TOOL = 'mcp__waypoint__handoff'
/** Flip on to print the plain-text renderings of the last test. */
const DUMP = false

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

function world(on: any, files: Record<string, string> = {}, run?: () => { exitCode: number; stdout: string; stderr: string }, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  const fs: Record<string, string> = { ...files }
  const copies: string[] = []
  const closes: string[] = []
  const statuses: (string | undefined)[] = []
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
  on('ui.status', (_: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
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
  return { clock, fs, copies, closes, statuses }
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
      expect(await ui.find({ type: 'Text', text: cols < 60 ? /3\/9 $/ : /WP3 · 3 of 9 · $/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /▶ ▶/ })).toBeUndefined()
      const bar = (await ui.findAll({ type: 'Text', text: /^[█▓░]+$/ })).map((t: { text: string }) => t.text).join('')
      expect(Array.from(bar).length).toBe(cols)
      expect(bar).toContain('▓')
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
    expect(await ui.find({ type: 'Text', text: /^Pull requests · $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 needs you' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^feat\(phase4\.7\+4\.8\): NAB/ })).toBeDefined()
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

// --- 0.2: handoff section, PR header, footer, and a plain-text rendering for review ---

const NOTE = {
  summary:
    'PR #1 is verified: 150 tests, strict validation, CI green on fba106a. Next: look at the pane, then mark #1 ready and merge. After the merge I tag waypoint--v0.1.0 and publish the marketplace entry so the mod installs from the validator line in the README.',
  items: [
    { kind: 'decision', title: 'Mark PR #13 ready and merge?', ref: '#13', blocking: true },
    { kind: 'action', title: 'Say how the pane looks on screen' },
  ],
}
const handoff = ($: any, input: Record<string, unknown> = NOTE) => $.tool.call({ tool: TOOL, tool_use_id: 'h1', ...input })
const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

/** A rough plain-text rendering of a drawn tree: rows join with their gap, space-between pads to the width. */
function plain(node: any, width: number): string[] {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  const kids: any[] = (Array.isArray(node.children) ? node.children : [node.children]).flat(Infinity)
  const p = node.props ?? {}
  const inline = (n: any): string => {
    if (n === null || n === undefined || n === false) return ''
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    const c: any[] = (Array.isArray(n.children) ? n.children : [n.children]).flat(Infinity)
    const q = n.props ?? {}
    if (n.type === 'Link') return q.label ?? q.href
    if (n.type === 'Button') return q.hotkey ? `${q.hotkey}: ${q.label}` : q.label
    if (n.type === 'Text') return c.map(inline).join('')
    if (n.type === 'Box') {
      const parts = c.map(inline).filter(s => s !== '')
      const pad = ' '.repeat(q.paddingLeft ?? 0)
      if (q.justifyContent === 'space-between' && parts.length === 2) {
        const room = Math.max(1, width - pad.length - Array.from(parts[0]!).length - Array.from(parts[1]!).length)
        return pad + parts[0] + ' '.repeat(room) + parts[1]
      }
      return pad + parts.join(' '.repeat(q.gap ?? 0))
    }
    return ''
  }
  if (node.type === 'Box' && p.flexDirection === 'column') return kids.flatMap(k => plain(k, width))
  return [inline(node)]
}

test('handoff: wide section with summary ≤ 6 lines and items; compact one-liner; band; status', async ($, on) => {
  const w = world(on, { [PLAN]: NINE })
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  for (const surface of SURFACES) {
    let ui = await mountPane($, surface, 92)
    expect(await ui.find({ type: 'Text', text: /^Waiting on you · 0s ago$/ })).toBeDefined()
    const summary = await ui.findAll({ type: 'Text', text: /^  (PR #1 is verified|.*merge|.*marketplace|.*README)/ })
    expect(summary.length >= 2 && summary.length <= 6).toBe(true)
    expect(summary.every((t: { text: string }) => Array.from(t.text).length <= 92)).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'Mark PR #13 ready and merge?' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^decision *$/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: '#13' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^  ~\/\.claude\/plans\/purring-origami\.md · changed 1s ago$/ })).toBeDefined()
    await ui.unmount()
    ui = await mountPane($, surface, 44)
    expect(await ui.find({ type: 'Text', text: /^! waiting on you · Mark PR #13 ready a… \(\+1\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Waiting on you ·/ })).toBeUndefined()
    await ui.unmount()
  }
  await command($, 'close')
  const band = await mountBand($, 'terminal')
  expect(await band.find({ type: 'Text', text: /^⚑ waiting on you \(2\) · WP3 of 9 · 3 done/ })).toBeDefined()
  await band.unmount()
  expect(w.statuses.at(-1)).toBe('⚑ 3/9 WP3 · needs you')
})

test('PR header with no PR needing you: `1 open · none need you`', async ($, on) => {
  const w = world(on, { [PLAN]: NINE }, () => ({ exitCode: 0, stdout: JSON.stringify(gh.inProgress), stderr: '' }))
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  const ui = await mountPane($, 'terminal', 100)
  expect(await ui.find({ type: 'Text', text: /^Pull requests · 1 open · $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'none need you' })).toBeDefined()
  await ui.unmount()
})

test('plain-text rendering at 92 (wide) and 44 (compact) columns', async ($, on) => {
  const w = world(on, { [PLAN]: NINE })
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  for (const [cols, rows] of [[92, 30], [44, 8]] as const) {
    const ui = await $.ui.mount({
      plugin: 'waypoint',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'waypoint',
      props: { bodyColumns: cols, placement: cols < 60 ? 'inline' : 'dock', scroll: { bodyRows: rows } } as any,
    })
    const text = plain(await ui.drawn(), cols)
    if (DUMP) (globalThis as any).console?.log(`--- ${cols} columns ---\n${text.join('\n')}`)
    expect(text.length <= rows).toBe(true)
    await ui.unmount()
  }
})

test('wide dock at 10..30 rows: drawn rows never exceed the budget; current step and both sections stay', async ($, on) => {
  const w = world(on, { [PLAN]: NINE }, () => ({ exitCode: 1, stdout: '', stderr: stderr.ghAuth }))
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  const summary = Array.from({ length: 3 }, (_, i) => `Sentence ${i} of the summary carries enough words to fill most of one line in the ninety-column pane.`).join(' ')
  await handoff($, { ...NOTE, summary })
  const cols = 92
  for (let rows = 10; rows <= 30; rows++) {
    const ui = await $.ui.mount({
      plugin: 'waypoint',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'waypoint',
      props: { bodyColumns: cols, placement: 'dock', scroll: { bodyRows: rows } } as any,
    })
    const text = plain(await ui.drawn(), cols)
    if (DUMP) (globalThis as any).console?.log(`--- ${rows} rows ---\n${text.join('\n')}`)
    expect({ rows, drawn: text.length <= rows }).toEqual({ rows, drawn: true })
    expect(text.some(l => /▶ +WP3/.test(l))).toBe(true)
    expect(text.some(l => /waiting on you/i.test(l))).toBe(true)
    expect(text.some(l => /#13/.test(l))).toBe(true)
    await ui.unmount()
  }
})

test('handoff with nothing tracked: the pane leads with the one-liner, the band shows in warning, status says needs you', async ($, on) => {
  const w = world(on)
  await start($)
  await handoff($)
  const ui = await mountPane($, 'terminal', 80)
  const lines = plain(await ui.drawn(), 80)
  expect(lines[0]).toBe('! waiting on you · Mark PR #13 ready and merge? (+1)')
  expect(lines[1]).toMatch(/^No plan tracked/)
  await ui.unmount()
  const band = await mountBand($, 'terminal')
  expect(await band.find({ type: 'Text', text: /^⚑ waiting on you \(2\) $/ })).toBeDefined()
  await band.unmount()
  expect(w.statuses.at(-1)).toBe('⚑ needs you')
})

test('handoff from an earlier session: the wide header says so', async ($, on) => {
  world(on, { [PLAN]: NINE }, undefined, {
    [`waypoint:handoff:plan/${PLAN}`]: { summary: 'From last time.', items: [{ kind: 'decision', title: 'Merge?', blocking: true }], at: NOW - 3_600_000, sessionId: 'OLD' },
  })
  await start($)
  await planMode($)
  const ui = await mountPane($, 'terminal', 100)
  expect(await ui.find({ type: 'Text', text: /^Waiting on you · from an earlier session · 1h ago$/ })).toBeDefined()
  await ui.unmount()
})

// --- 0.2: section rules and the current step's children one per line ---

const SIX_KIDS = [
  '- [x] README, CHANGELOG, marketplace entry',
  '- [x] CI workflow green on a clean runner',
  '- [x] draft PR opened against main',
  '- [-] a screenshot in the README',
  '- [!] mark PR #13 ready and merge (after WP6)',
  '- [ ] tag waypoint--v0.1.0 and publish',
].join('\n')
const NINE6 = NINE.replace('- [x] alpha-child\n- [ ] beta-child', SIX_KIDS)

async function mountAt($: any, cols: number, rows: number) {
  const ui = await $.ui.mount({
    plugin: 'waypoint',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'waypoint',
    props: { bodyColumns: cols, placement: 'dock', scroll: { bodyRows: rows } } as any,
  })
  return { ui, text: plain(await ui.drawn(), cols) }
}

test('wide rules: section headers are rules exactly W wide; the footer has its own rule; children one per line at 30 rows', async ($, on) => {
  const w = world(on, { [PLAN]: NINE6 })
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  const { ui, text } = await mountAt($, 92, 30)
  if (DUMP) (globalThis as any).console?.log(`--- 92 columns, 30 rows ---\n${text.join('\n')}`)
  expect(text.length <= 30).toBe(true)
  const prRule = text.find(l => l.startsWith('── Pull requests'))
  const hoRule = text.find(l => l.startsWith('── Waiting on you'))
  expect(prRule !== undefined && /─$/.test(prRule) && Array.from(prRule).length).toBe(92)
  expect(hoRule !== undefined && /─$/.test(hoRule) && Array.from(hoRule).length).toBe(92)
  const footerRule = text.findIndex(l => l === '─'.repeat(92))
  expect(footerRule).toBe(text.length - 2)
  expect(text[footerRule - 1]).toBe(' ')
  // Each child on its own row, at the title column (5 + shortWidth 3 + 2), in full.
  const pad = ' '.repeat(10)
  expect(text.filter(l => l.startsWith(pad + '✓ ') || l.startsWith(pad + '· ') || l.startsWith(pad + '! ') || l.startsWith(pad + '– ')).length).toBe(6)
  expect(text).toContain(`${pad}✓ README, CHANGELOG, marketplace entry`)
  expect(text).toContain(`${pad}! mark PR #13 ready and merge (after WP6)`)
  expect(await ui.find({ type: 'Text', text: /a screenshot in the README/ })).toBeDefined()
  await ui.unmount()
})

test('wide rules: a tight budget draws the children in one row, and drops the gaps with the footer rule', async ($, on) => {
  const w = world(on, { [PLAN]: NINE6 })
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  const { ui, text } = await mountAt($, 92, 14)
  expect(text.length <= 14).toBe(true)
  expect(text.some(l => l.includes('README, CHA') && l.includes('CI workflow'))).toBe(true)
  expect(text.includes('─'.repeat(92))).toBe(false)
  expect(text.includes(' ')).toBe(false)
  await ui.unmount()
})

test('wide footer at 76 and 92 columns: two blanks or more between the left text and the hotkeys, no row over W', async ($, on) => {
  const w = world(on, { [PLAN]: NINE6 })
  await start($)
  await planMode($)
  await w.clock.advance(7 * 60_000)
  for (const cols of [76, 92]) {
    const { ui, text } = await mountAt($, cols, 40)
    expect(text.filter(l => Array.from(l).length > cols)).toEqual([])
    const footer = text.at(-1)!
    expect(footer).toMatch(/ago {2,}r: refresh · p: path · c: close$/)
    expect(Array.from(footer).length).toBe(cols)
    await ui.unmount()
  }
  // A long path is cut, never the gap.
  const { ui, text } = await mountAt($, 64, 40)
  expect(text.at(-1)).toMatch(/^  ~\/\.claude\/.*… · changed 7m ago {2,}r: refresh/)
  expect(Array.from(text.at(-1)!).length <= 64).toBe(true)
  await ui.unmount()
})

// --- 0.2: the narrow dock (48 columns): the sectioned layout, adapted ---

test('narrow dock at 48 columns: sectioned layout, no PR buttons, two-row footer, every row ≤ 48 cells', async ($, on) => {
  const w = world(on, { [PLAN]: NINE6 })
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'waypoint',
      surface,
      component: 'Pane',
      requestId: 'waypoint',
      props: { bodyColumns: 48, placement: 'dock', scroll: { bodyRows: 40 } } as any,
    })
    const text = plain(await ui.drawn(), 48)
    if (DUMP) (globalThis as any).console?.log(`--- ${surface} 48 columns, 40 rows ---\n${text.join('\n')}`)
    expect(text.filter(l => Array.from(l).length > 48)).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^ *WP3 · 3\/9 · $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
    const prRule = text.find(l => l.startsWith('── Pull requests · 1 needs you'))
    expect(prRule !== undefined && Array.from(prRule).length).toBe(48)
    const hoRule = text.find(l => l.startsWith('── Waiting on you · 0s ago'))
    expect(hoRule !== undefined && Array.from(hoRule).length).toBe(48)
    expect(text.includes('─'.repeat(48))).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'copy-github.com/phatjam98/eventhorizon#13' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'untrack-github.com/phatjam98/eventhorizon#13' })).toBeUndefined()
    expect(text.some(l => /^ ✗ #13 feat\(phase4\.7\+4\.8\)/.test(l) || /^ . #13 /.test(l))).toBe(true)
    // One-space indents; children at the title column (1 + 1 + 1 + 3 + 1).
    expect(text.some(l => l.startsWith(' ▶ WP3 Draw the pane'))).toBe(true)
    expect(text).toContain(`${' '.repeat(7)}✓ README, CHANGELOG, marketplace entry`)
    expect(text.some(l => l.startsWith(' ! decision Mark PR #13 ready and merge?'))).toBe(true)
    // The footer: the path row, then the hotkeys on their own row.
    expect(text.at(-2)).toMatch(/^ ~\/\.claude\/plans\/purring-origami\.md · changed 1…$/)
    expect(Array.from(text.at(-2)!).length).toBe(48)
    expect(text.at(-1)).toBe(' r: refresh · p: path · c: close')
    await ui.unmount()
  }
})

test('narrow dock at 48 columns, 10..30 rows: drawn rows never exceed the budget or 48 cells; current step and both sections stay', async ($, on) => {
  const w = world(on, { [PLAN]: NINE6 }, () => ({ exitCode: 1, stdout: '', stderr: stderr.ghAuth }))
  await start($)
  await planMode($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' } as any)
  await w.clock.advance(750)
  await handoff($)
  for (let rows = 10; rows <= 30; rows++) {
    const { ui, text } = await mountAt($, 48, rows)
    if (DUMP) (globalThis as any).console?.log(`--- 48 columns, ${rows} rows ---\n${text.join('\n')}`)
    expect({ rows, drawn: text.length <= rows }).toEqual({ rows, drawn: true })
    expect({ rows, over: text.filter(l => Array.from(l).length > 48) }).toEqual({ rows, over: [] })
    expect(text.some(l => /▶ WP3/.test(l))).toBe(true)
    expect(text.some(l => /waiting on you/i.test(l))).toBe(true)
    expect(text.some(l => /#13/.test(l))).toBe(true)
    await ui.unmount()
  }
})
