// Handoff: the tool the model calls to leave a "waiting on you" note, its store key, commands and prompt bullet.
import { test, expect, mock } from 'claude-code/testing'

import { handoffText, parseHandoffInput, sanitizeHandoff, sweepDrops, MAX_ITEMS, MAX_SUMMARY, MAX_TITLE } from '../hooks/handoff'
import { earlierHandoffSection, planSection } from '../hooks/prompt'

const HOME = '/home/t'
const PLAN = `${HOME}/.claude/plans/purring-origami.md`
const NOW = 1_800_000_000_000
const DAY = 86_400_000
const SESSION_KEY = 'waypoint:handoff:session/S1'
const PLAN_KEY = `waypoint:handoff:plan/${PLAN}`
const TOOL = 'mcp__waypoint__handoff'
const PLAN_TEXT = '# Plan: ship it\n\n### [x] WP1 — One\n\n### [~] WP2 — Two\n'

type Opts = { files?: Record<string, string>; store?: Record<string, unknown>; registerFails?: boolean }

function world(on: any, opts: Opts = {}) {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { ...(opts.files ?? {}) }
  const store: Record<string, unknown> = structuredClone(opts.store ?? {})
  const toasts: string[] = []
  const notifies: string[] = []
  const registered: any[] = []
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', () => ({ value: '/work' }))
  const flags = { idThrows: false }
  on('session.id', () => {
    if (flags.idThrows) throw new Error('session id unavailable')
    return { value: 'S1' }
  })
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
  on('fs.stat', (_: any, e: any) =>
    e.path in files ? { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: NOW - 1000, isLink: false } } : { deny: 'ENOENT' },
  )
  on('fs.read', (_: any, e: any) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_: any, e: any) => {
    notifies.push(e.text)
    return { value: { isSent: true } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'waypoint' } }))
  on('tool.register', (_: any, e: any) => {
    if (opts.registerFails) return { deny: 'not bound' }
    registered.push(e)
    return { value: { tool: TOOL } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', () => ({ ref: 1, result: {}, text: 'ok' }))
  return { clock, files, store, toasts, notifies, registered, flags }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
const command = async ($: any, args: string): Promise<string> =>
  (await $.command.run({ command: 'waypoint', args, origin: { kind: 'person' }, presentation: 'text' })).text
const call = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, tool_use_id: 't1', ...input })
const compose = ($: any) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
const NOTE = {
  summary: 'PR #1 is verified. Next: merge it, then I tag the release.',
  items: [
    { kind: 'decision', title: 'Mark PR #1 ready and merge?', ref: '#1', blocking: true },
    { kind: 'action', title: 'Say how the pane looks' },
  ],
}

// --- pure ---------------------------------------------------------------------

test('parseHandoffInput: clear, trims, caps and defaults', () => {
  expect(parseHandoffInput({ clear: true, summary: 'ignored' })).toEqual({ ok: true, input: { op: 'clear' } })
  expect(parseHandoffInput(null)).toMatchObject({ ok: false, error: expect.stringMatching(/^Handoff not noted: /) })
  expect(parseHandoffInput({ summary: '   ', items: [{ kind: 'action', title: '  ' }] })).toMatchObject({ ok: false })
  const r = parseHandoffInput({
    summary: `  ${'s'.repeat(MAX_SUMMARY + 50)}  `,
    items: [
      { kind: 'weird', title: 't'.repeat(MAX_TITLE + 10), blocking: 'yes' },
      'not an item',
      ...Array.from({ length: 12 }, (_, i) => ({ kind: 'answer', title: `q${i}`, ref: '!6' })),
    ],
  })
  if (!r.ok || r.input.op !== 'set') throw new Error('expected set')
  const p = r.input
  expect(p.summary.length).toBe(MAX_SUMMARY)
  expect(p.summaryClipped).toBe(true)
  expect(p.items).toHaveLength(MAX_ITEMS)
  expect(p.droppedItems).toBe(3)
  expect(p.items[0]).toEqual({ kind: 'action', title: expect.any(String), blocking: false })
  expect(p.items[0]!.title.length).toBe(MAX_TITLE)
  expect(p.items[1]).toEqual({ kind: 'answer', title: 'q0', ref: '!6', blocking: false })
})

test('sanitizeHandoff rejects junk and keeps a valid record', () => {
  expect(sanitizeHandoff(undefined)).toBeNull()
  expect(sanitizeHandoff({ summary: 'x', items: 'no', at: 1 })).toBeNull()
  expect(sanitizeHandoff({ summary: 'x', items: [{ kind: 'decision', title: 'y', blocking: true }], at: 5, sessionId: 'S' })).toEqual({
    summary: 'x',
    items: [{ kind: 'decision', title: 'y', blocking: true }],
    at: 5,
    sessionId: 'S',
  })
  expect(handoffText(null)).toBe('No handoff note.')
})

test('prompt: the executing text names the handoff tool; the planning text does not', () => {
  expect(planSection(PLAN, false)).toContain('mcp__waypoint__handoff')
  expect(planSection(PLAN, false)).toContain('clear: true')
  expect(planSection(PLAN, true)).not.toContain('handoff')
})

// --- wiring -------------------------------------------------------------------

test('session.start registers the handoff tool, in the prompt (not deferred)', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toHaveLength(1)
  expect(w.registered[0]).toMatchObject({ name: 'handoff', isDeferred: false, inputSchema: { type: 'object' } })
  expect(Object.keys(w.registered[0].inputSchema.properties)).toEqual(['summary', 'items', 'clear'])
})

test('a rejected tool.register never breaks session.start', async ($, on) => {
  world(on, { registerFails: true })
  const r = await start($)
  expect(r).toMatchObject({ cwd: '/work' })
  expect(await command($, 'status')).toBe('waypoint: no plan tracked\npane: not placed\nstyle guide: on')
})

test('the tool sets the note, stores it under the session key and toasts; clear nulls it without a toast', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await call($, NOTE)
  expect(r).toEqual({ result: 'Handoff noted: 2 items.' })
  expect(w.store[SESSION_KEY]).toMatchObject({ summary: NOTE.summary, at: NOW, sessionId: 'S1' })
  expect((w.store[SESSION_KEY] as any).items).toEqual([
    { kind: 'decision', title: 'Mark PR #1 ready and merge?', ref: '#1', blocking: true },
    { kind: 'action', title: 'Say how the pane looks', blocking: false },
  ])
  expect(w.toasts).toEqual(['waypoint: waiting on you · 2 items'])
  expect(w.notifies).toEqual([])
  const text = await command($, 'handoff')
  expect(text).toContain(NOTE.summary)
  expect(text).toContain('! decision: Mark PR #1 ready and merge? (#1)')
  expect(text).toContain('· action: Say how the pane looks')

  expect(await call($, { clear: true })).toEqual({ result: 'Handoff cleared.' })
  expect(SESSION_KEY in w.store).toBe(false)
  expect(w.toasts).toHaveLength(1)
  expect(await command($, 'handoff')).toBe('No handoff note.')
})

test('invalid input is denied (an error result to the model), not a throw, and changes nothing', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await call($, { summary: '' })
  expect(r.deny).toMatch(/^Handoff not noted: /)
  expect(r.result).toBeUndefined()
  expect(SESSION_KEY in w.store).toBe(false)
  expect(w.toasts).toEqual([])
})

test('an exception while noting is denied with Handoff not noted: …', async ($, on) => {
  const w = world(on)
  await start($)
  w.flags.idThrows = true
  const r = await call($, NOTE)
  expect(r.deny).toMatch(/^Handoff not noted: /)
  expect(r.result).toBeUndefined()
  expect(SESSION_KEY in w.store).toBe(false)
})

test('control characters are stripped from summary, titles and refs; summary newlines become spaces', () => {
  const r = parseHandoffInput({
    summary: 'one\u0007 line\r\ntwo\u001b[31m red\u009b',
    items: [{ kind: 'action', title: 'ti\u0000tle\u007f', ref: '#1\u0008' }],
  })
  if (!r.ok || r.input.op !== 'set') throw new Error('expected set')
  expect(r.input.summary).toBe('one line two[31m red')
  expect(r.input.items[0]).toEqual({ kind: 'action', title: 'title', ref: '#1', blocking: false })
  expect(sanitizeHandoff({ summary: 'a\nb\u0001c', items: [], at: 1 })?.summary).toBe('a bc')
})

test('sweepDrops: own key never; expired or unreadable always; another session key after a day', () => {
  const h = (ageMs: number) => ({ summary: 's', items: [], at: NOW - ageMs, sessionId: 'X' })
  const other = { isSession: true, isOwn: false }
  const plan = { isSession: false, isOwn: false }
  expect(sweepDrops(null, NOW, { isSession: true, isOwn: true })).toBe(false)
  expect(sweepDrops(h(40 * DAY), NOW, { isSession: true, isOwn: true })).toBe(false)
  expect(sweepDrops(null, NOW, plan)).toBe(true)
  expect(sweepDrops(h(31 * DAY), NOW, plan)).toBe(true)
  expect(sweepDrops(h(2 * DAY), NOW, plan)).toBe(false)
  expect(sweepDrops(h(DAY + 1), NOW, other)).toBe(true)
  expect(sweepDrops(h(DAY - 1), NOW, other)).toBe(false)
})

test('notify on: a set also raises a native notification', { options: { notify: true } }, async ($, on) => {
  const w = world(on)
  await start($)
  await call($, { summary: 'Waiting.', items: [{ kind: 'answer', title: 'Which region?' }] })
  expect(w.notifies).toEqual(['waypoint: waiting on you · 1 item'])
})

test('/waypoint handoff clear clears the note and its key', async ($, on) => {
  const w = world(on)
  await start($)
  await call($, NOTE)
  expect(await command($, 'handoff clear')).toBe('Handoff note cleared.')
  expect(SESSION_KEY in w.store).toBe(false)
  expect(await command($, 'handoff clear')).toBe('No handoff note.')
  expect(await command($, 'handoff nonsense')).toBe('Usage: /waypoint handoff [clear]')
})

test('the session note moves to the plan key when a plan is tracked; later writes go there', async ($, on) => {
  const w = world(on, { files: { [PLAN]: PLAN_TEXT } })
  await start($)
  await call($, NOTE)
  expect(w.store[SESSION_KEY]).toBeDefined()
  await command($, `use ${PLAN}`)
  expect(SESSION_KEY in w.store).toBe(false)
  expect(w.store[PLAN_KEY]).toMatchObject({ summary: NOTE.summary })
  expect(await command($, 'handoff')).toContain(NOTE.summary)
  await call($, { summary: 'Replaced.' })
  expect(w.store[PLAN_KEY]).toMatchObject({ summary: 'Replaced.', items: [] })
})

test('a stored plan note comes back when a new session resumes the plan', async ($, on) => {
  const w = world(on, {
    files: { [PLAN]: PLAN_TEXT },
    store: {
      'last:/work': { path: PLAN, title: 'Plan', at: NOW - 3_600_000, percent: 50, sessionId: 'OLD' },
      [PLAN_KEY]: { summary: 'From last time.', items: [{ kind: 'decision', title: 'Merge?', blocking: true }], at: NOW - DAY, sessionId: 'OLD' },
    },
  })
  await start($)
  expect(await command($, 'handoff')).toContain('From last time.')
  expect(w.store[PLAN_KEY]).toBeDefined()
})

test('session start drops unreadable notes and notes older than 30 days', async ($, on) => {
  const old = { summary: 'old', items: [], at: NOW - 31 * DAY, sessionId: 'X' }
  const fresh = { summary: 'fresh', items: [], at: NOW - DAY, sessionId: 'X' }
  const w = world(on, {
    store: {
      'waypoint:handoff:session/X': old,
      'waypoint:handoff:plan/a.md': fresh,
      'waypoint:handoff:plan/b.md': 'junk',
    },
  })
  await start($)
  expect(Object.keys(w.store).filter(k => k.startsWith('waypoint:handoff:'))).toEqual(['waypoint:handoff:plan/a.md'])
})

test('/waypoint reset clears the note and deletes its key', async ($, on) => {
  const w = world(on, { files: { [PLAN]: PLAN_TEXT } })
  await start($)
  await command($, `use ${PLAN}`)
  await call($, NOTE)
  expect(w.store[PLAN_KEY]).toBeDefined()
  await command($, 'reset')
  expect(PLAN_KEY in w.store).toBe(false)
  expect(await command($, 'handoff')).toBe('No handoff note.')
})

test('prompt.compose carries the handoff bullet while executing, not while planning', async ($, on) => {
  const w = world(on, { files: { [PLAN]: PLAN_TEXT } })
  await start($)
  await $.prompt.attachment({ type: 'plan_mode', text: 'plan', origin: { kind: 'engine' }, detail: { reminder: 'full', planFilePath: PLAN, hasPlan: false } })
  let r = await compose($)
  expect(r.sections[0].text).not.toContain(TOOL)
  await $.prompt.attachment({ type: 'plan_mode_exit', text: 'exit', origin: { kind: 'engine' }, detail: { planFilePath: PLAN, hasPlan: true } })
  r = await compose($)
  expect(r.sections[0].text).toContain(TOOL)
  expect(w.files[PLAN]).toBe(PLAN_TEXT)
})

test('session start drops other sessions\' session-key notes older than a day, never the current session\'s', async ($, on) => {
  const at = (ms: number, id: string) => ({ summary: id, items: [], at: NOW - ms, sessionId: id })
  const w = world(on, {
    store: {
      'waypoint:handoff:session/IDLE': at(DAY + 60_000, 'IDLE'),
      'waypoint:handoff:session/BUSY': at(DAY - 60_000, 'BUSY'),
      [SESSION_KEY]: at(5 * DAY, 'S1'),
      'waypoint:handoff:plan/a.md': at(5 * DAY, 'X'),
    },
  })
  await start($)
  expect(Object.keys(w.store).filter(k => k.startsWith('waypoint:handoff:')).sort()).toEqual(
    ['waypoint:handoff:plan/a.md', 'waypoint:handoff:session/BUSY', SESSION_KEY].sort(),
  )
})

test('migration: a newer note already under the plan key wins over the session key', async ($, on) => {
  const newer = { summary: 'Newer, on the plan.', items: [], at: NOW + 5000, sessionId: 'OTHER' }
  const w = world(on, { files: { [PLAN]: PLAN_TEXT }, store: { [PLAN_KEY]: newer } })
  await start($)
  await call($, { summary: 'Older, in this session.' })
  expect((w.store[SESSION_KEY] as any).summary).toBe('Older, in this session.')
  await command($, `use ${PLAN}`)
  expect(SESSION_KEY in w.store).toBe(false)
  expect(w.store[PLAN_KEY]).toEqual(newer)
  expect(await command($, 'handoff')).toContain('Newer, on the plan.')
})

test('the note is restored after a hot reload (session.start twice in one world)', async ($, on) => {
  const w = world(on, { files: { [PLAN]: PLAN_TEXT } })
  await start($)
  await command($, `use ${PLAN}`)
  await call($, NOTE)
  await start($)
  expect(await command($, 'handoff')).toContain(NOTE.summary)
  expect(w.store[PLAN_KEY]).toMatchObject({ summary: NOTE.summary, sessionId: 'S1' })
})

test('prompt.compose: the earlier-handoff section only for a note from another session; gone after clear; plan section unchanged', async ($, on) => {
  const old = { summary: `From last time.\n${'x'.repeat(200)}`, items: [{ kind: 'decision', title: 'Merge?', blocking: true }], at: NOW - DAY, sessionId: 'OLD' }
  const w = world(on, {
    files: { [PLAN]: PLAN_TEXT },
    store: {
      'last:/work': { path: PLAN, title: 'Plan', at: NOW - 3_600_000, percent: 50, sessionId: 'OLD' },
      [PLAN_KEY]: old,
    },
  })
  await start($)
  let r = await compose($)
  expect(r.sections.map((x: any) => x.id)).toEqual(['waypoint:plan', 'waypoint:handoff'])
  expect(r.sections[0]).toEqual({ id: 'waypoint:plan', text: planSection(PLAN, false), scope: 'session' })
  const sec = r.sections[1]
  expect(sec.scope).toBe('session')
  expect(sec.text).toBe(earlierHandoffSection(old.summary))
  expect(sec.text).toBe(
    `# Waypoint: earlier handoff\nA handoff note from an earlier session is still showing in the pane: "From last time. ${'x'.repeat(104)}". When the person has acted on it, call mcp__waypoint__handoff with clear: true, or replace it.`,
  )
  await call($, { clear: true })
  r = await compose($)
  expect(r.sections.map((x: any) => x.id)).toEqual(['waypoint:plan'])
  await call($, NOTE)
  r = await compose($)
  expect(r.sections.map((x: any) => x.id)).toEqual(['waypoint:plan'])
  expect(w.store[PLAN_KEY]).toMatchObject({ sessionId: 'S1' })
})
