// Plan style wiring: the guide on the plan-mode reminder, the lint note after a plan write, `/waypoint lint` and `conform`.
import { test, expect, mock } from 'claude-code/testing'

const HOME = '/home/t'
const PLANS = `${HOME}/.claude/plans`
const PLAN = `${PLANS}/purring-origami.md`
const NOW = 1_800_000_000_000
const MARK = '# Waypoint: plan style'

/** Steps marked, title without a `Plan:` prefix: no findings. */
const CLEAN = `# Ship the widget\n\n## Context\nWhy.\n\n### [ ] WP1 — Build it\nDo.\n\n### [ ] WP2 — Test it\nDo.\n\n## Verification\n- run it\n`
/** Marked steps under a `Plan:` title: one nit, no fixes. */
const NIT_ONLY = CLEAN.replace('# Ship the widget', '# Plan: ship the widget')
/** No markers at all: the parser guesses, a fix-level finding. */
const MARKERLESS = `# Ship the widget\n\n## Context\nWhy.\n\n## Build it\nDo.\n\n## Test it\nDo.\n\n## Verification\n- run it\n`

type File = { text: string; mtimeMs: number }

/** In-memory engine beneath the plugin. A Write stores its content; an Edit leaves the file as the test set it. */
type Engine = { failOnce?: number; tool?: { isError?: boolean; context?: string[] }; submit?: 'ok' | 'throw' | 'drop'; links?: Record<string, string> }

function world(on: any, files: Record<string, File> = {}, opts: Engine = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  const submits: any[] = []
  const tool = opts.tool ?? {}
  /** A path through a linked folder, spelled as the link target. */
  const real = (p: string): string => {
    for (const [link, target] of Object.entries(opts.links ?? {})) if (p === link || p.startsWith(`${link}/`)) return target + p.slice(link.length)
    return p
  }
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
    const p = real(e.path)
    const isDir = Object.keys(files).some(k => k.startsWith(`${p}/`))
    const f = files[p]
    const realPath = e.resolve ? { realPath: p } : {}
    if (isDir) return { value: { kind: 'directory', size: 0, mtimeMs: NOW, isLink: p !== e.path, ...realPath } }
    return f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false, ...realPath } } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.read', (_: any, e: any) => (files[real(e.path)] ? { value: files[real(e.path)]!.text } : { deny: `ENOENT ${e.path}` }))
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
  on('ui.status', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'waypoint' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'Write') files[real(e.file_path)] = { text: e.content, mtimeMs: NOW }
    return { ref: 1, result: {}, text: 'ok', ...tool }
  })
  on('prompt.submit', (_: any, e: any) => {
    submits.push(e)
    const own = e.origin?.kind === 'plugin'
    if (own && opts.failOnce && opts.failOnce-- > 0) throw new Error('no session to take it')
    if (own && opts.submit === 'throw') throw new Error('no session to take it')
    if (own && opts.submit === 'drop') return { drop: 'busy' }
    return { text: e.text, origin: e.origin }
  })
  return { files, submits, clock, toasts }
}

const reminder = ($: any, type: string, detail: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  $.prompt.attachment({ type, text: 'plan mode reminder', origin: { kind: 'engine' }, detail, ...extra })
const full = { reminder: 'full', planFilePath: PLAN, hasPlan: false }
const sparse = { reminder: 'sparse', planFilePath: PLAN, hasPlan: false }
const command = ($: any, args: string) =>
  $.command.run({ command: 'waypoint', args, origin: { kind: 'person' }, presentation: 'text' })
const write = ($: any, file_path: string, content: string, extra = {}) =>
  $.tool.call({ tool: 'Write', tool_use_id: 'w', file_path, content, ...extra } as any)
const edit = ($: any, file_path: string, extra = {}) =>
  $.tool.call({ tool: 'Edit', tool_use_id: 'e', file_path, old_string: 'a', new_string: 'b', ...extra } as any)
const occurrences = (s: string, sub: string) => s.split(sub).length - 1

// --- the plan-mode reminder --------------------------------------------------

test('the full plan_mode reminder gets the style guide appended, once', async ($, on) => {
  world(on)
  const r = await reminder($, 'plan_mode', full)
  expect(r.text.startsWith('plan mode reminder\n\n# Waypoint: plan style\n')).toBe(true)
  expect(occurrences(r.text, MARK)).toBe(1)
})

test('the sparse reminder that follows is left as it came', async ($, on) => {
  world(on)
  await reminder($, 'plan_mode', full)
  expect((await reminder($, 'plan_mode', sparse)).text).toBe('plan mode reminder')
})

test('a reminder already carrying the guide is not given it twice', async ($, on) => {
  world(on)
  const r = await $.prompt.attachment({ type: 'plan_mode', text: `x\n\n${MARK}\nrules`, origin: { kind: 'engine' }, detail: full } as any)
  expect(occurrences(r.text ?? "", MARK)).toBe(1)
})

test('plan_mode_reentry is left as it came; the full reminder after it carries the guide', async ($, on) => {
  world(on)
  expect((await reminder($, 'plan_mode_reentry', { planFilePath: PLAN })).text).toBe('plan mode reminder')
})

test('styleGuide off: the full reminder is untouched', { options: { styleGuide: false } }, async ($, on) => {
  world(on)
  expect((await reminder($, 'plan_mode', full)).text).toBe('plan mode reminder')
})

test("a subagent's full reminder is untouched", async ($, on) => {
  world(on)
  expect((await reminder($, 'plan_mode', full, { agentId: 'a1' })).text).toBe('plan mode reminder')
})

// --- the lint note after a plan write ------------------------------------------

test('a Write of a markerless plan under planDir adds a lint note; an identical second Write adds none', async ($, on) => {
  world(on)
  const first = await write($, PLAN, MARKERLESS)
  expect(first.context).toHaveLength(1)
  expect(first.context[0]).toContain('Waypoint read purring-origami.md after that write')
  expect(first.text).toBe('ok')
  expect((await write($, PLAN, MARKERLESS)).context).toBeUndefined()
})

test('a note comes again once the findings change', async ($, on) => {
  world(on)
  await write($, PLAN, MARKERLESS)
  expect((await write($, PLAN, NIT_ONLY)).context?.[0]).toContain('Plan:')
})

test('an Edit that leaves only nits adds no note; a clean Write adds none', async ($, on) => {
  const w = world(on)
  w.files[PLAN] = { text: NIT_ONLY, mtimeMs: NOW }
  expect((await edit($, PLAN)).context).toBeUndefined()
  expect((await write($, `${PLANS}/other.md`, CLEAN)).context).toBeUndefined()
})

test('an Edit that leaves a fix-level problem adds a note naming the edit', async ($, on) => {
  const w = world(on)
  w.files[PLAN] = { text: MARKERLESS, mtimeMs: NOW }
  expect((await edit($, PLAN)).context?.[0]).toContain('after that edit')
})

test('a path given with ~ is resolved into planDir', async ($, on) => {
  world(on)
  expect((await write($, '~/.claude/plans/purring-origami.md', MARKERLESS)).context).toBeUndefined() // the mock stores it under ~
  expect((await write($, PLAN, MARKERLESS)).context).toHaveLength(1)
})

test('no note outside planDir, for a non-.md file, or from a subagent', async ($, on) => {
  world(on)
  expect((await write($, '/work/notes.md', MARKERLESS)).context).toBeUndefined()
  expect((await write($, `${PLANS}/deep.txt`, MARKERLESS)).context).toBeUndefined()
  expect((await write($, `${HOME}/.claude/plans-old/x.md`, MARKERLESS)).context).toBeUndefined()
  expect((await write($, PLAN, MARKERLESS, { agentId: 'sub' })).context).toBeUndefined()
  // the subagent's write recorded nothing: the main session's own write still gets its note
  expect((await write($, PLAN, MARKERLESS)).context).toHaveLength(1)
})

test('no note for an errored call', async ($, on) => {
  world(on, {}, { tool: { isError: true } })
  expect((await write($, PLAN, MARKERLESS)).context).toBeUndefined()
})

test('a plan dir reached through a link: a write spelled by the link target still gets the note', async ($, on) => {
  const target = '/data/plans'
  world(on, { [`${target}/keep.md`]: { text: CLEAN, mtimeMs: NOW } }, { links: { [PLANS]: target } })
  expect((await write($, `${target}/purring-origami.md`, MARKERLESS)).context).toHaveLength(1)
  expect((await write($, '/data/other/x.md', MARKERLESS)).context).toBeUndefined()
})

test('a relative planDir is taken from the home dir', { options: { planDir: 'notes/plans' } }, async ($, on) => {
  world(on)
  expect((await write($, `${HOME}/notes/plans/a.md`, MARKERLESS)).context).toHaveLength(1)
  expect((await write($, '/work/notes/plans/a.md', MARKERLESS)).context).toBeUndefined()
})

test('styleGuide off: a markerless plan Write adds nothing', { options: { styleGuide: false } }, async ($, on) => {
  world(on)
  expect((await write($, PLAN, MARKERLESS)).context).toBeUndefined()
})

test('a note keeps the context the call already had', async ($, on) => {
  world(on, {}, { tool: { context: ['earlier note'] } })
  const r = await write($, PLAN, MARKERLESS)
  expect(r.context[0]).toBe('earlier note')
  expect(r.context[1]).toContain('Waypoint read')
})

// --- commands ----------------------------------------------------------------

test('/waypoint lint on the tracked plan prints the report', async ($, on) => {
  world(on, { [PLAN]: { text: MARKERLESS, mtimeMs: NOW } })
  await command($, 'use purring-origami')
  const r = await command($, 'lint')
  expect(r.text.split('\n')[0]).toMatch(/^Ship the widget \(purring-origami\.md\): /)
  expect(r.text).toContain('Fix')
  expect(r.context ?? []).toEqual([])
})

test('/waypoint lint with nothing tracked replies with the picker and tracks nothing', async ($, on) => {
  world(on, { [PLAN]: { text: CLEAN, mtimeMs: NOW } })
  const r = await command($, 'lint')
  expect(r.text).toContain('No plan tracked.')
  expect(r.text).toContain('1: Ship the widget')
  expect((await command($, 'status')).text.split('\n')[0]).toBe('waypoint: no plan tracked')
})

test('/waypoint lint <slug> and <n> lint without tracking; a missing file says so', async ($, on) => {
  world(on, { [PLAN]: { text: CLEAN, mtimeMs: NOW } })
  expect((await command($, 'lint purring-origami')).text).toContain('Looks fine.')
  expect((await command($, 'lint 1')).text).toContain('Looks fine.')
  expect((await command($, 'status')).text.split('\n')[0]).toBe('waypoint: no plan tracked')
  expect((await command($, 'lint nope')).text).toBe(`No plan file at ${PLANS}/nope.md.`)
})

const SUBMITTED =
  'Asked this session to apply the plan style guide to "Ship the widget" (purring-origami.md) additively; it starts when the session is idle and shows the diff.'

test('/waypoint conform answers, then submits an additive instruction with the absolute path as a turn of its own', async ($, on) => {
  const w = world(on, { [PLAN]: { text: MARKERLESS, mtimeMs: NOW } })
  await command($, 'use purring-origami')
  const r = await command($, 'conform')
  expect(r.text).toBe(SUBMITTED)
  expect(r.context ?? []).toEqual([])
  expect(w.submits).toHaveLength(0) // never from inside the command hook
  await w.clock.advance(1)
  expect(w.submits).toHaveLength(1)
  const sub = w.submits[0]
  expect(sub.text).toContain(PLAN)
  expect(sub.text).toContain('Edit')
  expect(sub.text).toContain('Additive mode')
  expect(sub.text.startsWith('/')).toBe(false)
  expect(sub.origin).toMatchObject({ kind: 'plugin', name: 'waypoint' })
})

test('/waypoint conform rewrite <slug> says so and asks for heading rewrites', async ($, on) => {
  const w = world(on, { [PLAN]: { text: CLEAN, mtimeMs: NOW } })
  const r = await command($, 'conform rewrite purring-origami')
  expect(r.text).toContain('with heading rewrites')
  await w.clock.advance(1)
  expect(w.submits[0].text).toContain('Rewrite mode')
})

const typed = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'person' } } as any)

for (const mode of ['throw', 'drop'] as const) {
  test(`/waypoint conform: a submit that fails (${mode}) toasts and rides with the next prompt, once`, async ($, on) => {
    const w = world(on, { [PLAN]: { text: MARKERLESS, mtimeMs: NOW } }, { submit: mode })
    expect((await command($, 'conform purring-origami')).text).toBe(SUBMITTED)
    await w.clock.advance(1)
    expect(w.toasts.some(t => t.startsWith('waypoint: could not hand the conform instruction'))).toBe(true)
    const next = w.submits.length
    await typed($, 'go on')
    expect(w.submits[next].context).toHaveLength(1)
    expect(w.submits[next].context[0]).toContain(PLAN)
    await typed($, 'and again')
    expect(w.submits[next + 1].context ?? []).toEqual([])
  })
}

test('/waypoint conform on a clean plan has nothing to do', async ($, on) => {
  world(on, { [PLAN]: { text: CLEAN, mtimeMs: NOW } })
  const r = await command($, 'conform purring-origami')
  expect(r.text).toBe('Ship the widget (purring-origami.md): looks fine, nothing to conform.')
  expect(r.context ?? []).toEqual([])
})

test('/waypoint status shows the style guide line; usage lists lint and conform', async ($, on) => {
  world(on)
  expect((await command($, 'status')).text.split('\n')).toContain('style guide: on')
  const usage = (await command($, 'bogus')).text
  expect(usage).toContain('lint [path|slug|n]')
  expect(usage).toContain('conform [rewrite] [path|slug|n]')
})

test('/waypoint status with styleGuide off says so', { options: { styleGuide: false } }, async ($, on) => {
  world(on)
  expect((await command($, 'status')).text.split('\n')).toContain('style guide: off')
})

test('/waypoint conform: a later conform whose submit succeeds leaves nothing pending from a failed one', async ($, on) => {
  const w = world(on, { [PLAN]: { text: MARKERLESS, mtimeMs: NOW } }, { failOnce: 1 })
  await command($, 'conform purring-origami')
  await w.clock.advance(1)
  expect(w.toasts.some(t => t.startsWith('waypoint: could not hand the conform instruction'))).toBe(true)
  await command($, 'conform purring-origami')
  await w.clock.advance(1)
  const ok = w.submits.filter(x => x.origin?.kind === 'plugin')
  expect(ok).toHaveLength(2) // the failed one reached the hook too
  await typed($, 'go on')
  expect(w.submits[w.submits.length - 1].context ?? []).toEqual([])
})

test('/waypoint conform: a pending instruction older than 10 minutes is dropped, not attached', async ($, on) => {
  const w = world(on, { [PLAN]: { text: MARKERLESS, mtimeMs: NOW } }, { submit: 'throw' })
  await command($, 'conform purring-origami')
  await w.clock.advance(1)
  await w.clock.advance(10 * 60_000 + 1)
  await typed($, 'go on')
  expect(w.submits[w.submits.length - 1].context ?? []).toEqual([])
  await typed($, 'and again')
  expect(w.submits[w.submits.length - 1].context ?? []).toEqual([])
})
