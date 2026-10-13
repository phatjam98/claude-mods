// WP2 wiring: events → state, discovery precedence, resume, refresh gating, commands, prompt section, status line.
import { test, expect, mock } from 'claude-code/testing'

const HOME = '/home/t'
const PLANS = `${HOME}/.claude/plans`
const PLAN = `${PLANS}/purring-origami.md`
const NOW = 1_800_000_000_000
const HOUR = 3_600_000

const steps = (done: number, active: number | null, n = 9): string =>
  Array.from({ length: n }, (_, i) => {
    const m = i < done ? 'x' : i === active ? '~' : ' '
    return `### [${m}] WP${i} — Step number ${i}\nBody ${i}.\n`
  }).join('\n')

const planText = (done = 3, active: number | null = 3) =>
  `# Plan: ship the widget\n\n## Context\nWhy.\n\n## Work packages\n\n${steps(done, active)}\n## Verification\n- run it\n`

type File = { text: string; mtimeMs: number }
type Opts = { files?: Record<string, File>; store?: Record<string, unknown>; toolResult?: (e: any) => any; now?: number }

/** In-memory engine beneath the plugin: fs, store, session, ui recorders. */
function world(on: any, opts: Opts = {}) {
  const clock = mock.clock(on, { now: opts.now ?? NOW })
  const files: Record<string, File> = { ...(opts.files ?? {}) }
  const store: Record<string, unknown> = { ...(opts.store ?? {}) }
  const reads: string[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opens: any[] = []
  const copies: string[] = []
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => {
    store[e.key] = structuredClone(e.value)
    return { value: undefined }
  })
  on('store.delete', (_: any, e: any) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('fs.stat', (_: any, e: any) => {
    const f = files[e.path]
    return f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.read', (_: any, e: any) => {
    const f = files[e.path]
    if (!f) return { deny: `ENOENT ${e.path}` }
    reads.push(e.path)
    return { value: f.text }
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.list', (_: any, e: any) => {
    const dir = e.path.replace(/\/$/, '') + '/'
    return {
      value: Object.keys(files)
        .filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
        .map(p => ({ name: p.slice(dir.length), kind: 'file', size: files[p]!.text.length, mtimeMs: files[p]!.mtimeMs, isLink: false })),
    }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', (_: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_: any, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: opens.length ? [{ id: 'waypoint', title: 'Waypoint', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.copy', (_: any, e: any) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('command.register', () => ({ value: { command: 'waypoint' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hello', scope: 'shared' }] }))
  on('tool.call', (_: any, e: any) => (opts.toolResult ? opts.toolResult(e) : { ref: 1, result: {}, text: 'ok' }))
  const write = (path: string, text: string, mtimeMs = clock.now()) => {
    files[path] = { text, mtimeMs }
  }
  return { clock, files, store, reads, statuses, toasts, opens, copies, write }
}

const attach = ($: any, type: string, detail: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  $.prompt.attachment({ type, text: 'plan mode reminder', origin: { kind: 'engine' }, detail, ...extra })
const planMode = ($: any, path = PLAN, hasPlan = true, extra = {}) =>
  attach($, 'plan_mode', { reminder: 'full', planFilePath: path, hasPlan }, extra)
const command = ($: any, args: string) =>
  $.command.run({ command: 'waypoint', args, origin: { kind: 'person' }, presentation: 'text' })
const compose = ($: any) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
const edit = ($: any, file_path: string, extra = {}) =>
  $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path, old_string: 'a', new_string: 'b', ...extra })
const start = ($: any, isInteractive = true) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive })
const turnDone = ($: any) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1]

test('plan_mode attachment tracks and parses the plan; the attachment text is unchanged', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - 1000 } } })
  const r = await planMode($)
  expect(r.text).toBe('plan mode reminder')
  expect(w.reads).toEqual([PLAN])
  expect(last(w.statuses)).toBe('⚑ 3/9 WP3')
  expect(await command($, 'status')).toMatchObject({ text: expect.stringContaining('3/9 done') })
})

test('a subagent plan_mode attachment is ignored', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await planMode($, PLAN, true, { agentId: 'a1' })
  expect(w.reads).toEqual([])
  expect((await command($, 'status')).text).toBe('waypoint: no plan tracked')
})

test('Edit on the tracked path re-parses; another path, a subagent edit and a failed edit do not', async ($, on) => {
  let fail = false
  const w = world(on, {
    files: { [PLAN]: { text: planText(), mtimeMs: NOW - 1000 } },
    toolResult: () => (fail ? { ref: 1, result: {}, text: 'no match', isError: true } : { ref: 1, result: {}, text: 'ok' }),
  })
  await planMode($)
  expect(w.reads).toHaveLength(1)
  w.write(PLAN, planText(4, 4))
  await edit($, '/work/src/other.ts')
  await edit($, PLAN, { agentId: 'sub' })
  fail = true
  await edit($, PLAN)
  expect(w.reads).toHaveLength(1)
  fail = false
  await edit($, PLAN)
  expect(w.reads).toHaveLength(2)
  expect(last(w.statuses)).toBe('⚑ 4/9 WP4')
})

test('ExitPlanMode result filePath tracks the plan; an errored call does not', async ($, on) => {
  let isError = true
  const w = world(on, {
    files: { [PLAN]: { text: planText(), mtimeMs: NOW } },
    toolResult: () =>
      isError ? { ref: 1, result: { plan: '' }, text: 'rejected', isError: true } : { ref: 1, result: { plan: 'p', filePath: PLAN }, text: 'ok' },
  })
  const ran = await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'x1' } as any)
  expect(ran.isError).toBe(true)
  expect((await command($, 'status')).text).toBe('waypoint: no plan tracked')
  isError = false
  await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'x2' } as any)
  expect(w.reads).toEqual([PLAN])
  expect((await command($, 'status')).text).toBe('waypoint: ship the widget · 3/9 done · current WP3')
})

test('manual tracking outranks plan mode; plan mode outranks a resumed plan', async ($, on) => {
  const OTHER = `${PLANS}/other.md`
  world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW }, [OTHER]: { text: planText(1, 1), mtimeMs: NOW } } })
  await command($, 'use other')
  await planMode($, PLAN)
  expect((await command($, 'status')).text).toContain('1/9 done')
  await command($, `use ${PLAN}`)
  expect((await command($, 'status')).text).toContain('3/9 done')
})

const rec = (percent: number) => ({ path: PLAN, title: 'Plan', at: NOW - HOUR, percent, sessionId: 'OLD' })

test('resume: a fresh unfinished record tracks the plan as resume and auto-opens', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - HOUR } }, store: { 'last:/work': rec(33) } })
  await start($)
  expect(w.reads).toEqual([PLAN])
  expect(last(w.statuses)).toBe('⚑ 3/9 WP3')
  expect(w.store['last:/work']).toMatchObject({ path: PLAN, percent: 33, sessionId: 'S1' })
  expect(w.opens).toHaveLength(1)
  expect(w.opens[0]).toMatchObject({ id: 'waypoint', title: 'Waypoint', rows: 10 })
})

test('resume: a complete plan last touched two days ago deletes the key', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(9, null), mtimeMs: NOW - 48 * HOUR } }, store: { 'last:/work': rec(100) } })
  await start($)
  expect(w.reads).toEqual([])
  expect('last:/work' in w.store).toBe(false)
  expect(w.opens).toHaveLength(0)
})

test('resume: a missing file deletes the key', async ($, on) => {
  const w = world(on, { store: { 'last:/work': rec(10) } })
  await start($)
  expect('last:/work' in w.store).toBe(false)
  expect((await command($, 'status')).text).toBe('waypoint: no plan tracked')
})

test('resume: a complete plan touched within 24 h comes back', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(9, null), mtimeMs: NOW - 2 * HOUR } }, store: { 'last:/work': rec(100) } })
  await start($)
  expect(last(w.statuses)).toBe('⚑ 9/9 ✓')
})

test('prompt.compose: no section untracked; planning variant in plan mode; executing variant after exit', async ($, on) => {
  const w = world(on)
  let r = await compose($)
  expect(r.sections.map((s: any) => s.id)).toEqual(['intro'])

  await planMode($, PLAN, false)
  r = await compose($)
  expect(r.sections.map((s: any) => s.id)).toEqual(['intro', 'waypoint:plan'])
  expect(r.sections[1]).toMatchObject({ scope: 'session', text: expect.stringContaining('A pane will draw') })
  expect(last(w.statuses)).toBe('⚑ planning')

  w.write(PLAN, planText())
  await attach($, 'plan_mode_exit', { planFilePath: PLAN, hasPlan: true })
  r = await compose($)
  const text = (r.sections[1] as any).text as string
  expect(text).toContain(`A pane tracks the plan at ${PLAN}`)
  expect(text).not.toContain('3/9')
  expect(last(w.statuses)).toBe('⚑ 3/9 WP3')
})

test('plan mode before the file exists is planning, not missing', async ($, on) => {
  world(on)
  await planMode($, PLAN, false)
  await turnDone($)
  expect((await command($, 'status')).text).toContain('not read yet')
})

test('/waypoint use <slug> resolves into planDir; a missing file is an error', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  expect((await command($, 'use nope')).text).toBe(`No plan file at ${PLANS}/nope.md`)
  expect((await command($, 'use purring-origami')).text).toBe('Tracking purring-origami.md: 3/9 done.')
  expect(w.opens).toHaveLength(1)
  expect((await command($, 'refresh')).text).toBe('Re-read purring-origami.md: 3/9 done.')
})

test('/waypoint reset clears tracking, the stored record and the status line', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await command($, 'use purring-origami')
  expect(w.store['last:/work']).toBeDefined()
  expect((await command($, 'reset')).text).toBe('Waypoint reset: no plan tracked.')
  expect('last:/work' in w.store).toBe(false)
  expect(last(w.statuses)).toBeUndefined()
  expect(w.statuses.length).toBeGreaterThan(1)
  expect((await compose($)).sections).toHaveLength(1)
})

test('/waypoint layout persists; status summarises; unknown is usage', async ($, on) => {
  const w = world(on)
  expect((await command($, 'layout wide')).text).toBe('Waypoint layout: wide.')
  expect(w.store.layout).toBe('wide')
  expect((await command($, 'layout sideways')).text).toContain('Usage: /waypoint layout')
  expect((await command($, 'status')).text).toBe('waypoint: no plan tracked')
  expect((await command($, 'frobnicate')).text).toMatch(/^Usage: \/waypoint \[close\|refresh/)
  expect((await command($, 'layout')).text).toBe('Waypoint layout: auto (from settings).')
  expect('layout' in w.store).toBe(false)
})

test('a stored layout wins over the option; /waypoint layout with no argument hands back to it', { options: { layout: 'compact' } }, async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await command($, 'use purring-origami')
  const hasFooter = async () => {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'Pane', requestId: 'waypoint', props: { bodyColumns: 120, placement: 'dock' } as any })
    const found = (await ui.find({ type: 'Button', key: 'refresh' })) !== undefined // the footer is wide-only
    await ui.unmount()
    return found
  }
  expect(await hasFooter()).toBe(false)
  await command($, 'layout auto')
  expect(await hasFooter()).toBe(true)
  expect((await command($, 'layout')).text).toBe('Waypoint layout: compact (from settings).')
  expect('layout' in w.store).toBe(false)
  expect(await hasFooter()).toBe(false)
})

test('/waypoint with nothing tracked lists recent plans and opens the pane', async ($, on) => {
  const w = world(on, { files: { [`${PLANS}/a.md`]: { text: '# A', mtimeMs: NOW - HOUR }, [`${PLANS}/b.md`]: { text: '# B', mtimeMs: NOW } } })
  expect((await command($, '')).text).toBe('Waypoint opened.')
  expect(w.opens).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'Pane', requestId: 'waypoint', props: { bodyColumns: 80, placement: 'dock' } as any })
  expect(await ui.find({ type: 'Button', text: /b · 0s ago/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /a · 1h ago/ })).toBeDefined()
  await ui.unmount()
})

test('plan poll: stats every tick, reads only when the mtime changed', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - 1000 } } })
  await start($)
  await command($, 'use purring-origami')
  expect(w.reads).toHaveLength(1)
  await w.clock.advance(5_000)
  await w.clock.advance(5_000)
  expect(w.reads).toHaveLength(1)
  w.write(PLAN, planText(5, 5))
  await w.clock.advance(5_000)
  expect(w.reads).toHaveLength(2)
  expect(last(w.statuses)).toBe('⚑ 5/9 WP5')
  // same content, new mtime: read again, but the snapshot (hash) is unchanged
  const before = w.statuses.length
  w.write(PLAN, planText(5, 5))
  await w.clock.advance(5_000)
  expect(w.reads).toHaveLength(3)
  expect(w.statuses.length).toBe(before)
})

test('turn.complete refreshes through the stat gate', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - 1000 } } })
  await planMode($)
  await turnDone($)
  expect(w.reads).toHaveLength(1)
  w.write(PLAN, planText(4, 4))
  await turnDone($)
  expect(w.reads).toHaveLength(2)
})

test('crossing to 100% toasts plan complete once', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(8, 8), mtimeMs: NOW - 1000 } } })
  await planMode($)
  w.write(PLAN, planText(9, null))
  await edit($, PLAN)
  await edit($, PLAN)
  expect(w.toasts.filter(t => t === '⚑ plan complete')).toHaveLength(1)
  expect(last(w.statuses)).toBe('⚑ 9/9 ✓')
})

test('199 of 200 steps is 99% and no plan-complete toast; the 200th toasts', async ($, on) => {
  const big = (done: number) => `# P\n\n${steps(done, done < 200 ? done : null, 200)}`
  const w = world(on, { files: { [PLAN]: { text: big(198), mtimeMs: NOW - 1000 } } })
  await planMode($)
  w.write(PLAN, big(199))
  await edit($, PLAN)
  expect(w.toasts).toEqual([])
  expect(last(w.statuses)).toBe('⚑ 199/200 WP199')
  w.write(PLAN, big(200))
  await edit($, PLAN)
  expect(w.toasts).toEqual(['⚑ plan complete'])
})

test('Write on the tracked path re-parses; a subagent write does not', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - 1000 } } })
  await planMode($)
  w.write(PLAN, planText(4, 4))
  await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: PLAN, content: 'x', agentId: 'sub' } as any)
  expect(w.reads).toHaveLength(1)
  await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: PLAN, content: 'x' } as any)
  expect(w.reads).toHaveLength(2)
  expect(last(w.statuses)).toBe('⚑ 4/9 WP4')
})

test('plan_mode_reentry tracks the plan like plan_mode', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await attach($, 'plan_mode_reentry', { planFilePath: PLAN })
  expect(w.reads).toEqual([PLAN])
  expect((await compose($)).sections.map((x: any) => x.id)).toContain('waypoint:plan')
})

// The test engine in 2.1.296 has no `$.ui.close` to raise a person's close, so the
// close goes through the pane's own button (`$.ui.close` from the plugin, the same hook).
test('closing the pane brings the band back', async ($, on) => {
  world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] })) // what draws when the band yields
  await command($, 'use purring-origami')
  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100 } as any })
    const found = (await ui.find({ type: 'Text', text: /WP3 of 9/ })) !== undefined
    await ui.unmount()
    return found
  }
  expect(await band()).toBe(false) // the placed pane hides the band
  const pane = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'Pane', requestId: 'waypoint', props: { bodyColumns: 120, placement: 'dock' } as any })
  await pane.press({ key: 'close' })
  await pane.unmount()
  expect(await band()).toBe(true)
})

test('tool.call hooks return exactly what the call resolved', async ($, on) => {
  const stub = { ref: 7, result: { filePath: PLAN, extra: [1, 2] }, text: 'stub text' }
  world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } }, toolResult: () => structuredClone(stub) })
  await start($)
  await command($, 'use purring-origami')
  for (const call of [
    { tool: 'Bash', tool_use_id: 'b', command: 'gh pr view 13' },
    { tool: 'Edit', tool_use_id: 'e', file_path: PLAN, old_string: 'a', new_string: 'b' },
    { tool: 'Write', tool_use_id: 'w', file_path: PLAN, content: 'x' },
    { tool: 'ExitPlanMode', tool_use_id: 'x' },
  ]) {
    expect(await $.tool.call(call as any)).toEqual(stub)
  }
})

test('a vanished plan file is marked missing', async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await command($, 'use purring-origami')
  delete w.files[PLAN]
  expect((await command($, 'refresh')).text).toBe(`Plan file missing: ${PLAN}`)
})

test('statusLine off: the status line is cleared once at start and never set to text', { options: { statusLine: false } }, async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW } } })
  await start($)
  await planMode($)
  await command($, 'reset')
  expect(w.statuses).toEqual([undefined])
})

test('openOnStart off: a resumed plan does not open the pane', { options: { openOnStart: false } }, async ($, on) => {
  const w = world(on, { files: { [PLAN]: { text: planText(), mtimeMs: NOW - HOUR } }, store: { 'last:/work': rec(33) } })
  await start($)
  expect(w.reads).toEqual([PLAN])
  expect(w.opens).toHaveLength(0)
})
