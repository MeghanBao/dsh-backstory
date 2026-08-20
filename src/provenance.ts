// Pure session-log provenance engine — no dsh imports, unit-tested.
// Reconstructs which agent turn wrote a file and the user prompt that triggered
// that turn, from the append-only session event log.
import { basename, resolve } from 'node:path'

export interface WriteEvent {
  seq: number
  turn: number
  path: string
  tool: 'write' | 'edit'
  ranges?: Array<{ start: number; end: number }> // optional line-level refinement
}

export interface PromptEvent {
  seq: number
  turn: number
  text: string
}

export interface Trigger {
  turn: number
  seq: number
  tool: 'write' | 'edit'
  prompt: string | null
}

export interface RawEvent {
  seq?: number
  type?: string
  data?: any
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
      .join('')
      .trim()
  }
  return ''
}

/**
 * Normalize a raw dsh session-event log into the writes + prompts we reason over.
 * Field access is deliberately defensive: dsh is a developer preview and exact
 * payload shapes may shift. Unrecognized events are skipped, never thrown.
 */
export function normalizeEvents(
  events: RawEvent[],
  cwd: string,
): { writes: WriteEvent[]; prompts: PromptEvent[] } {
  const writes: WriteEvent[] = []
  const prompts: PromptEvent[] = []
  let turn = 0
  let fallbackSeq = 0

  for (const ev of events ?? []) {
    const seq = typeof ev?.seq === 'number' ? ev.seq : fallbackSeq++
    const data = ev?.data ?? {}
    switch (ev?.type) {
      case 'turn/start':
        turn =
          typeof data.turn === 'number'
            ? data.turn
            : typeof data.number === 'number'
              ? data.number
              : turn + 1
        break
      case 'user/message': {
        // `source.kind === 'user'` is a real human prompt (vs synthetic injection
        // or goal round). Treat a missing source as human too.
        const kind = data?.source?.kind
        if (kind === undefined || kind === 'user') {
          const text = extractText(data.content ?? data.message?.content)
          if (text) prompts.push({ seq, turn, text })
        }
        break
      }
      case 'tool/call': {
        const toolName = data.name ?? data.toolName
        const args = data.arguments ?? data.args ?? {}
        const file = args.file_path ?? args.path
        if ((toolName === 'write' || toolName === 'edit') && typeof file === 'string') {
          writes.push({ seq, turn, path: resolve(cwd, file), tool: toolName })
        }
        break
      }
    }
  }
  return { writes, prompts }
}

/**
 * Find the write/edit that most recently touched `path` (and `line`, if the
 * write carries line ranges), then the user prompt that opened its turn.
 * Path match is exact-first, falling back to basename to tolerate relative vs
 * absolute drift. Line drift across later edits is not tracked (v0.2 is
 * file-level; ranges narrow only when present).
 */
export function findTrigger(
  path: string,
  line: number,
  writes: WriteEvent[],
  prompts: PromptEvent[],
): Trigger | null {
  const matches = (w: WriteEvent, exact: boolean): boolean => {
    const samePath = exact ? w.path === path : basename(w.path) === basename(path)
    if (!samePath) return false
    if (line > 0 && w.ranges && w.ranges.length) {
      return w.ranges.some((r) => line >= r.start && line <= r.end)
    }
    return true
  }
  const pick = (exact: boolean): WriteEvent | null => {
    let best: WriteEvent | null = null
    for (const w of writes) if (matches(w, exact) && (!best || w.seq > best.seq)) best = w
    return best
  }

  const best = pick(true) ?? pick(false)
  if (!best) return null

  // Triggering prompt: the earliest human message in the write's turn, else the
  // most recent human message at or before the write.
  let inTurn: PromptEvent | null = null
  let before: PromptEvent | null = null
  for (const p of prompts) {
    if (p.turn === best.turn && (!inTurn || p.seq < inTurn.seq)) inTurn = p
    if (p.seq <= best.seq && (!before || p.seq > before.seq)) before = p
  }
  const prompt = (inTurn ?? before)?.text ?? null
  return { turn: best.turn, seq: best.seq, tool: best.tool, prompt }
}
