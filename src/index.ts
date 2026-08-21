import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isoDate, shortSha } from './blame.ts'
import { blameFile, readCommitBodies } from './git.ts'
import { findTrigger, normalizeEvents, type RawEvent } from './provenance.ts'
import { appendRecord, buildRecord, computeTouch, hashLine, readLedger } from './ledger.ts'
import { appendNote, buildNote, indexNotes, readNotes } from './notes.ts'
import { attributeLine } from './attribution.ts'
import { parseProvenanceTrailers, type CommitProvenance } from './trailers.ts'
import { isDisabledByEnv, loadConfig } from './config.ts'
import { redactPrompt } from './redact.ts'
import { backstorySkill } from './skill.ts'

// A dsh plugin = `name` + `apply(ctx)`.
export const name = 'dsh-backstory'
export const inject = ['tools']

const MAX_LINES = 400 // bound whole-file output

// ---------------------------------------------------------------------------
// Provenance adapter (the dsh-native half)
// ---------------------------------------------------------------------------

interface Origin {
  found: boolean
  turn: number
  tool: string
  prompt: string
  source: string // 'ledger-hash' | 'ledger-range' | 'session' | 'none'
}

const NO_ORIGIN: Origin = { found: false, turn: -1, tool: '', prompt: '', source: 'none' }

interface LineOwner {
  turn: number
  prompt: string
  source: string
}

interface BackstoryLine {
  line: number
  content: string
  commit: string
  author: string
  date: string
  summary: string
  owner?: LineOwner
  explanation?: string // cached per-line explanation (v0.7), keyed by content hash
}

/**
 * v0.2 fallback: reconstruct which agent turn wrote `absPath` (near `line`) and
 * the prompt that triggered it, from the *live* session event log. Used only
 * when the persistent ledger has nothing. Degrades to NO_ORIGIN on any shape.
 */
async function sessionProvenance(exec: unknown, absPath: string, line: number): Promise<Origin> {
  try {
    const session = (exec as any)?.agent?.session
    const events = session?.events as RawEvent[] | undefined
    if (!Array.isArray(events)) return NO_ORIGIN
    const cwd = session?.header?.cwd ?? dirname(absPath)
    const { writes, prompts } = normalizeEvents(events, cwd)
    const t = findTrigger(absPath, line, writes, prompts)
    if (!t) return NO_ORIGIN
    return { found: true, turn: t.turn, tool: t.tool, prompt: t.prompt ?? '', source: 'session' }
  } catch {
    return NO_ORIGIN
  }
}

function clip(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// ---------------------------------------------------------------------------
// Recorder (v0.3a): append a persistent provenance record on every write/edit
// ---------------------------------------------------------------------------

/** Current turn + triggering prompt + session id, from the live session log. */
function latestContext(session: any): { turn: number; prompt: string; sessionId: string } {
  const sessionId = session?.header?.id ?? session?.id ?? ''
  const events = session?.events
  if (!Array.isArray(events)) return { turn: 0, prompt: '', sessionId }
  const cwd = session?.header?.cwd ?? ''
  const { prompts } = normalizeEvents(events, cwd)
  const last = prompts[prompts.length - 1]
  return { turn: last?.turn ?? 0, prompt: last?.text ?? '', sessionId }
}

/**
 * Read the file back after a completed write/edit, compute the touched line span
 * + content hashes, and append a record to `<cwd>/.dsh/backstory.jsonl`.
 * Best-effort: any failure is swallowed so it can never break the tool call.
 */
async function recordWrite(exec: any): Promise<void> {
  if (isDisabledByEnv(process.env)) return
  const tool = exec?.name
  if (tool !== 'write' && tool !== 'edit') return
  const args = exec?.arguments as Record<string, unknown> | undefined
  const rel = (args?.file_path ?? args?.path) as string | undefined
  const session = exec?.agent?.session
  const cwd = session?.header?.cwd
  if (typeof rel !== 'string' || typeof cwd !== 'string') return

  const config = await loadConfig(cwd)
  if (!config.record) return // per-repo opt-out

  const abs = resolve(cwd, rel)
  const newContent = await readFile(abs, 'utf8')
  const touch = computeTouch(tool, args, newContent)
  if (!touch) return

  const { turn, prompt, sessionId } = latestContext(session)
  // Scrub secrets before they reach the ledger (and later, commit trailers).
  const safePrompt = redactPrompt(prompt, config.redactPatterns)
  const file = relative(cwd, abs).split('\\').join('/')
  await appendRecord(cwd, buildRecord({ session: sessionId, turn, prompt: safePrompt, tool, file, touch }))
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export function apply(ctx: Context) {
  // Register the `/backstory` user command, when the skills service is present.
  // Optional: hosts without it still expose the `backstory` tool. Register once
  // the service is available (via inject), else best-effort immediately.
  const registerSkill = (c: any) => c?.skills?.register?.(backstorySkill())
  try {
    if (typeof (ctx as any).inject === 'function') (ctx as any).inject(['skills'], registerSkill)
    else registerSkill(ctx)
  } catch {
    /* skills service absent — the tool still works */
  }

  // Persist provenance as it happens (v0.3a). Never let recording throw into
  // the tool waterfall; observe, record, and always continue.
  ;(ctx as any).on?.('tools/post-execute', async (exec: any, result: any, next: any) => {
    try {
      if (result && !result.isError) await recordWrite(exec)
    } catch {
      /* recording is best-effort */
    }
    return next()
  })

  ctx.tools.register(
    defineTool({
      name: 'backstory',
      description:
        "Get the backstory of code: for a file (or a specific line range) return each line with the git commit that last touched it, plus — when the agent itself wrote a line — which turn wrote it and the user prompt that triggered it (from a persistent per-line ledger, drift-resilient by content hash). Lines you have explained before come back with a cached `explanation`; only explain the ones without it, then call `backstory_remember` to cache your new explanations. `unexplained` counts the lines still needing one. Use it to explain not just WHAT the code does but WHY it is there. Ask for a narrow line range on large files.",
      parameters: {
        path: { type: 'string', required: true, description: 'File path (absolute or workspace-relative)' },
        line: { type: 'number', description: 'First line (1-based). Omit to read the whole file.' },
        endLine: { type: 'number', description: 'Last line (1-based). Defaults to `line`.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            range: { type: 'string' },
            repo: { type: 'boolean' },
            truncated: { type: 'boolean' },
            unexplained: { type: 'number' },
            note: { type: 'string' },
            origin: {
              type: 'object',
              additionalProperties: false,
              properties: {
                found: { type: 'boolean' },
                turn: { type: 'number' },
                tool: { type: 'string' },
                prompt: { type: 'string' },
                source: { type: 'string' },
              },
            },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  line: { type: 'number' },
                  content: { type: 'string' },
                  commit: { type: 'string' },
                  author: { type: 'string' },
                  date: { type: 'string' },
                  summary: { type: 'string' },
                  owner: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      turn: { type: 'number' },
                      prompt: { type: 'string' },
                      source: { type: 'string' },
                    },
                  },
                  explanation: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, v) => {
          const origin = v.origin ?? NO_ORIGIN
          const head = `📖 backstory · ${v.path} (${v.range})`
          const body = (v.lines ?? [])
            .map((l) => {
              const mark = l.owner ? ` 🧬t${l.owner.turn}` : ''
              const cached = l.explanation ? `\n    ↳ ${l.explanation}` : ''
              return `L${l.line} · ${shortSha(l.commit ?? '')} ${l.author ?? ''}${
                l.date ? ` ${l.date}` : ''
              }${l.summary ? ` — "${l.summary}"` : ''}${mark}\n    ${l.content}${cached}`
            })
            .join('\n')
          const originLine = origin.found
            ? `\n🧬 origin · turn ${origin.turn}${origin.tool ? ` (${origin.tool} by the agent)` : ''}${
                origin.prompt ? ` — you asked: "${clip(origin.prompt)}"` : ''
              }${origin.source ? ` [${origin.source}]` : ''}`
            : ''
          const cache = v.unexplained
            ? `\n(${v.unexplained} line(s) not yet explained — explain them, then call backstory_remember; ↳ = cached explanation.)`
            : ''
          const foot = v.repo
            ? `${originLine}\n(WHAT: explain each line from the code. WHY: the commit message${
                origin.found ? ' + the origin turn/prompt' : ''
              } above. 🧬t = the agent turn that wrote that line.)${cache}`
            : `${originLine}\n(${v.note})${cache}`
          return [{ type: 'text', text: `${head}\n${body}${foot}` }]
        },
      },

      async execute(args, exec) {
        const abs = resolve(args.path)
        const start = args.line
        const end = args.endLine ?? args.line
        const range = start ? `${start}-${end}` : 'whole file'

        const cwd = (exec as any)?.agent?.session?.header?.cwd ?? dirname(abs)
        const records = await readLedger(cwd)
        const notes = indexNotes(await readNotes(cwd))

        // Always read the source so we can answer even outside a git repo.
        const source = await readFile(abs, { encoding: 'utf8', signal: exec.signal })
        const allLines = source.split('\n')
        const from = start ? Math.max(1, start) : 1
        const to = start ? Math.min(allLines.length, end ?? start) : allLines.length
        let truncated = false
        let hi = to
        if (hi - from + 1 > MAX_LINES) {
          hi = from + MAX_LINES - 1
          truncated = true
        }

        // Attribute each line. Precedence: exact content-hash from the ledger
        // (most precise) > git-native commit trailer (git tracks drift) > ledger
        // line-range. Also yields a file-level origin from the first hit.
        const enrich = (lines: BackstoryLine[], commitProv: Map<string, CommitProvenance>): Origin => {
          let fileOrigin = NO_ORIGIN
          for (const l of lines) {
            const led = attributeLine(records, args.path, l.line, l.content)
            const cp = commitProv.get(l.commit)
            let owner: LineOwner | undefined
            let tool = ''
            if (led.found && led.source === 'ledger-hash') {
              owner = { turn: led.turn, prompt: led.prompt, source: led.source }
              tool = led.tool
            } else if (cp) {
              owner = { turn: cp.turn, prompt: cp.prompt, source: 'commit' }
            } else if (led.found) {
              owner = { turn: led.turn, prompt: led.prompt, source: led.source }
              tool = led.tool
            }
            if (owner) {
              l.owner = owner
              if (!fileOrigin.found) {
                fileOrigin = { found: true, turn: owner.turn, tool, prompt: owner.prompt, source: owner.source }
              }
            }
          }
          return fileOrigin
        }

        // Try git blame for commit-level provenance.
        const blame = await blameFile(abs, start ? from : undefined, start ? hi : undefined, {
          signal: exec.signal,
        })
        const lines: BackstoryLine[] = blame.repo
          ? blame.lines.slice(0, MAX_LINES).map((b) => ({
              line: b.line,
              content: b.content,
              commit: b.commit,
              author: b.author,
              date: isoDate(b.authorTime),
              summary: b.summary,
            }))
          : allLines.slice(from - 1, hi).map((content, i) => ({
              line: from + i,
              content,
              commit: '0'.repeat(40),
              author: '',
              date: '',
              summary: '',
            }))

        // Git-native provenance (v0.4): read DSH-* trailers off the blamed commits.
        const commitProv = new Map<string, CommitProvenance>()
        if (blame.repo) {
          const bodies = await readCommitBodies(cwd, lines.map((l) => l.commit), { signal: exec.signal })
          for (const [sha, body] of bodies) {
            const p = parseProvenanceTrailers(body)
            if (p) commitProv.set(sha, p)
          }
        }

        // Origin precedence: ledger/commit attribution first, live session second.
        const ledgerOrigin = enrich(lines, commitProv)
        const origin = ledgerOrigin.found ? ledgerOrigin : await sessionProvenance(exec, abs, start ?? 0)

        // Attach cached explanations by line-content hash; count what still needs one.
        let unexplained = 0
        for (const l of lines) {
          const cached = notes.get(hashLine(l.content))
          if (cached) l.explanation = cached
          else unexplained++
        }

        return blame.repo
          ? { path: args.path, range, repo: true, truncated, unexplained, note: '', origin, lines }
          : {
              path: args.path,
              range,
              repo: false,
              truncated,
              unexplained,
              note: 'Not a git repository — showing source only, no history.',
              origin,
              lines,
            }
      },
    }),
  )

  // Companion write tool (v0.7): cache the explanations the model just produced,
  // keyed by each line's current content hash, so future `backstory` queries
  // return them and only changed lines need re-explaining.
  ctx.tools.register(
    defineTool({
      name: 'backstory_remember',
      description:
        'Cache your per-line explanations so future `backstory` queries return them. Pass the lines you just explained; each is stored keyed by the line\'s current content, and comes back as `explanation` until that line changes. Call this after explaining the `unexplained` lines from `backstory`.',
      parameters: {
        path: { type: 'string', required: true, description: 'File path (absolute or workspace-relative)' },
        notes: {
          type: 'array',
          required: true,
          description: 'One entry per explained line.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              line: { type: 'number', required: true, description: 'Line number (1-based)' },
              text: { type: 'string', required: true, description: 'The explanation for that line' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { saved: { type: 'number' }, path: { type: 'string' } },
        },
        render: (_args, v) => [{ type: 'text', text: `💾 cached ${v.saved} explanation(s) for ${v.path}` }],
      },

      async execute(args, exec) {
        const abs = resolve(args.path)
        const cwd = (exec as any)?.agent?.session?.header?.cwd ?? dirname(abs)
        const allLines = (await readFile(abs, { encoding: 'utf8', signal: exec.signal })).split('\n')
        let saved = 0
        for (const n of args.notes ?? []) {
          const content = allLines[n.line - 1]
          if (typeof content !== 'string' || !n.text) continue
          await appendNote(cwd, buildNote(content, n.text))
          saved++
        }
        return { saved, path: args.path }
      },
    }),
  )
}
