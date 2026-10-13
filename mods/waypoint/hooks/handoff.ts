// Handoff: the note the model leaves (through the tool `mcp__waypoint__handoff`)
// when only the person can move the plan. Pure: validation, store shape, text.

import type { Handoff, HandoffItem, HandoffKind } from '../types'

export const HANDOFF_TOOL = 'handoff'
export const HANDOFF_TOOL_FULL = 'mcp__waypoint__handoff'
export const MAX_SUMMARY = 1200
export const MAX_ITEMS = 10
export const MAX_TITLE = 200
export const MAX_REF = 500
/** A stored note nobody has touched for this long is dropped at session start. */
export const HANDOFF_TTL_MS = 30 * 86_400_000
/** Another session's session-key note (it never saw a plan) is dropped at session start after this long. */
export const SESSION_HANDOFF_IDLE_MS = 86_400_000

const KINDS: readonly HandoffKind[] = ['decision', 'action', 'answer']

export const HANDOFF_DESCRIPTION =
  'Leave the person a short note when you stop because only they can move the plan (a decision, a merge, a credential, an answer). ' +
  'It shows in the waypoint pane as "Waiting on you". Give a 2–4 sentence summary of where things stand and what happens after they act, ' +
  'plus one item per thing they must do, decide or answer. Call it with clear: true when work resumes after they act, or call it again to replace the note.'

export const HANDOFF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2–4 sentences: where the work stands and what happens after the person acts' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { enum: ['decision', 'action', 'answer'] },
          title: { type: 'string' },
          ref: { type: 'string', description: 'PR/MR url, #n or !n this is about' },
          blocking: { type: 'boolean' },
        },
        required: ['kind', 'title'],
      },
    },
    clear: { type: 'boolean', description: 'true clears the note when work resumes; other fields are ignored' },
  },
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)
// C0 and C1 control characters, tab and newline aside (they become spaces below).
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
/** Control characters stripped, whitespace (newlines included) collapsed to single spaces. */
export const oneLine = (s: string): string => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim()

function itemOf(raw: unknown): HandoffItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? clip(oneLine(r.title), MAX_TITLE) : ''
  if (title === '') return null
  const kind = KINDS.includes(r.kind as HandoffKind) ? (r.kind as HandoffKind) : 'action'
  const ref = typeof r.ref === 'string' ? clip(oneLine(r.ref), MAX_REF) : ''
  return ref ? { kind, title, ref, blocking: r.blocking === true } : { kind, title, blocking: r.blocking === true }
}

export type HandoffSet = { op: 'set'; summary: string; items: HandoffItem[]; droppedItems: number; summaryClipped: boolean }

/** `ok`: a clear or a set to apply. `invalid`: nothing to apply; `error` is the model's error result. */
export type HandoffInput =
  | { ok: true; input: { op: 'clear' } | HandoffSet }
  | { ok: false; error: string }

/** Prefix of every error result the tool returns. */
export const NOT_NOTED = 'Handoff not noted: '

/** What the model sent, made safe: never throws, whatever `raw` is. */
export function parseHandoffInput(raw: unknown): HandoffInput {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (r.clear === true) return { ok: true, input: { op: 'clear' } }
  const full = typeof r.summary === 'string' ? oneLine(r.summary) : ''
  const summary = clip(full, MAX_SUMMARY)
  const all = (Array.isArray(r.items) ? r.items : []).map(itemOf).filter((x): x is HandoffItem => x !== null)
  const items = all.slice(0, MAX_ITEMS)
  if (summary === '' && items.length === 0) {
    return { ok: false, error: `${NOT_NOTED}give a summary or at least one item with a title (or clear: true).` }
  }
  return { ok: true, input: { op: 'set', summary, items, droppedItems: all.length - items.length, summaryClipped: summary !== full } }
}

/** A stored value read back: a Handoff, or null when it is not one. */
export function sanitizeHandoff(raw: unknown): Handoff | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.summary !== 'string' || !Array.isArray(r.items) || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  const items = r.items.map(itemOf).filter((x): x is HandoffItem => x !== null).slice(0, MAX_ITEMS)
  return { summary: clip(oneLine(r.summary), MAX_SUMMARY), items, at: r.at, sessionId: typeof r.sessionId === 'string' ? r.sessionId : '' }
}

/**
 * Session-start sweep: drop an unreadable note, one older than HANDOFF_TTL_MS, and
 * another session's session-key note older than a day. The current session's key always stays.
 */
export function sweepDrops(h: Handoff | null, now: number, key: { isSession: boolean; isOwn: boolean }): boolean {
  if (key.isOwn) return false
  if (h === null || now - h.at > HANDOFF_TTL_MS) return true
  return key.isSession && now - h.at > SESSION_HANDOFF_IDLE_MS
}

const itemsWord = (n: number): string => `${n} item${n === 1 ? '' : 's'}`

/** What the model reads back after a set. */
export function noteResult(p: HandoffSet): string {
  const extra = [
    p.droppedItems > 0 ? `kept the first ${MAX_ITEMS} items` : '',
    p.summaryClipped ? `summary shortened to ${MAX_SUMMARY} characters` : '',
  ].filter(Boolean)
  return `Handoff noted: ${itemsWord(p.items.length)}.${extra.length ? ` (${extra.join('; ')}.)` : ''}`
}

export const CLEARED_RESULT = 'Handoff cleared.'

/** The toast (and native notification) on a set. */
export const handoffToast = (h: Handoff): string =>
  h.items.length > 0 ? `waypoint: waiting on you · ${itemsWord(h.items.length)}` : 'waypoint: waiting on you'

/** `/waypoint handoff`. */
export function handoffText(h: Handoff | null): string {
  if (!h) return 'No handoff note.'
  const lines = ['Waiting on you:', h.summary].filter(Boolean)
  for (const it of h.items) lines.push(`${it.blocking ? '!' : '·'} ${it.kind}: ${it.title}${it.ref ? ` (${it.ref})` : ''}`)
  return lines.join('\n')
}
