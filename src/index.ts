import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isoDate, parsePorcelainBlame, shortSha } from './blame.ts'
import { findTrigger, normalizeEvents, type RawEvent } from './provenance.ts'

const run = promisify(execFile)

// A dsh plugin = `name` + `apply(ctx)`.
export const name = 'dsh-backstory'
export const inject = ['tools']

const MAX_LINES = 400 // bound whole-file output

// ---------------------------------------------------------------------------
// Provenance adapter (the dsh-native half, v0.2)
// ---------------------------------------------------------------------------

interface Origin {
  found: boolean
  turn: number
  tool: string
  prompt: string
}

const NO_ORIGIN: Origin = { found: false, turn: -1, tool: '', prompt: '' }

/**
 * Reconstruct which agent turn wrote `absPath` (near `line`) and the user prompt
 * that triggered it, from the live session's append-only event log
 * (`exec.agent.session.events`). Pure reasoning lives in ./provenance.ts; this
 * adapter only reaches into the dsh runtime and degrades to NO_ORIGIN on any
 * unexpected shape, so the tool always still returns its git backstory.
 */
async function provenance(exec: unknown, absPath: string, line: number): Promise<Origin> {
  try {
    const session = (exec as any)?.agent?.session
    const events = session?.events as RawEvent[] | undefined
    if (!Array.isArray(events)) return NO_ORIGIN
    const cwd = session?.header?.cwd ?? dirname(absPath)
    const { writes, prompts } = normalizeEvents(events, cwd)
    const t = findTrigger(absPath, line, writes, prompts)
    if (!t) return NO_ORIGIN
    return { found: true, turn: t.turn, tool: t.tool, prompt: t.prompt ?? '' }
  } catch {
    return NO_ORIGIN
  }
}

function clip(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'backstory',
      description:
        "Get the backstory of code: for a file (or a specific line range) return each line with the git commit that last touched it, plus — when the agent itself wrote the file — which turn wrote it and the user prompt that triggered it. Use it to explain not just WHAT the code does but WHY it is there. Ask for a narrow line range on large files.",
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
            note: { type: 'string' },
            origin: {
              type: 'object',
              additionalProperties: false,
              properties: {
                found: { type: 'boolean' },
                turn: { type: 'number' },
                tool: { type: 'string' },
                prompt: { type: 'string' },
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
                },
              },
            },
          },
        },
        render: (_args, v) => {
          const head = `📖 backstory · ${v.path} (${v.range})`
          const body = v.lines
            .map(
              (l) =>
                `L${l.line} · ${shortSha(l.commit)} ${l.author}${l.date ? ` ${l.date}` : ''}${
                  l.summary ? ` — "${l.summary}"` : ''
                }\n    ${l.content}`,
            )
            .join('\n')
          const origin = v.origin.found
            ? `\n🧬 origin · turn ${v.origin.turn} (${v.origin.tool} by the agent)${
                v.origin.prompt ? ` — you asked: "${clip(v.origin.prompt)}"` : ''
              }`
            : ''
          const foot = v.repo
            ? `${origin}\n(WHAT: explain each line from the code. WHY: the commit message${
                v.origin.found ? ' + the origin turn/prompt' : ''
              } above.)`
            : `${origin}\n(${v.note})`
          return [{ type: 'text', text: `${head}\n${body}${foot}` }]
        },
      },

      async execute(args, exec) {
        const abs = resolve(args.path)
        const start = args.line
        const end = args.endLine ?? args.line
        const range = start ? `${start}-${end}` : 'whole file'

        // dsh-native provenance (best-effort; degrades to NO_ORIGIN).
        const origin = await provenance(exec, abs, start ?? 0)

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

        // Try git blame for commit-level provenance.
        const gitArgs = ['blame', '--line-porcelain']
        if (start) gitArgs.push('-L', `${from},${hi}`)
        gitArgs.push('--', basename(abs))

        try {
          const { stdout } = await run('git', gitArgs, {
            cwd: dirname(abs),
            signal: exec.signal,
            maxBuffer: 32 * 1024 * 1024,
          })
          const parsed = parsePorcelainBlame(stdout)
          const lines = parsed.slice(0, MAX_LINES).map((b) => ({
            line: b.line,
            content: b.content,
            commit: b.commit,
            author: b.author,
            date: isoDate(b.authorTime),
            summary: b.summary,
          }))
          return { path: args.path, range, repo: true, truncated, note: '', origin, lines }
        } catch {
          // Not a git repo (or git missing): fall back to bare source lines.
          const lines = allLines.slice(from - 1, hi).map((content, i) => ({
            line: from + i,
            content,
            commit: '0'.repeat(40),
            author: '',
            date: '',
            summary: '',
          }))
          return {
            path: args.path,
            range,
            repo: false,
            truncated,
            note: 'Not a git repository — showing source only, no history.',
            origin,
            lines,
          }
        }
      },
    }),
  )
}
