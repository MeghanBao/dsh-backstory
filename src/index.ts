import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isoDate, parsePorcelainBlame, shortSha } from './blame.ts'

const run = promisify(execFile)

// A dsh plugin = `name` + `apply(ctx)`.
export const name = 'dsh-backstory'
export const inject = ['tools']

const MAX_LINES = 400 // bound whole-file output

// ---------------------------------------------------------------------------
// Provenance seams
// ---------------------------------------------------------------------------

/**
 * v0.2 TODO — the dsh-native half. Reconstruct which agent turn last wrote a
 * line by walking the append-only session log (write/edit `tool/result` events
 * carry applied hunks) and mapping hunk line-ranges back to their turn + the
 * user prompt that opened it. Needs the real `ctx.sessions` / `ctx.sessionQuery`
 * API — wire it here once verified against `packages/session-query`.
 */
async function sessionProvenance(_path: string, _line: number): Promise<string | null> {
  return null
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'backstory',
      description:
        "Get the backstory of code: for a file (or a specific line range) return each line together with the git commit that last touched it (author, date, message). Use it to explain not just WHAT the code does but WHY it is there. Ask for a narrow line range on large files.",
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
          const foot = v.repo
            ? '\n(Explain WHAT each line does from the code; use the commit messages above for WHY it is there.)'
            : `\n(${v.note})`
          return [{ type: 'text', text: `${head}\n${body}${foot}` }]
        },
      },

      async execute(args, exec) {
        const abs = resolve(args.path)
        const start = args.line
        const end = args.endLine ?? args.line
        const range = start ? `${start}-${end}` : 'whole file'

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

        // Try git blame for provenance.
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
          return { path: args.path, range, repo: true, truncated, note: '', lines }
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
            lines,
          }
        }
      },
    }),
  )
}
