// git I/O, isolated from the dsh tool wiring so it can be tested against a real
// repository without pulling in the dsh runtime. Pure parsing lives in ./blame.ts.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname } from 'node:path'
import { parsePorcelainBlame, type BlameLine } from './blame.ts'

const run = promisify(execFile)

export interface BlameResult {
  repo: boolean
  lines: BlameLine[]
}

/**
 * Run `git blame --line-porcelain` for `absPath` (optionally limited to lines
 * [from,to]) and parse it. Returns `{ repo: false, lines: [] }` when the file is
 * not tracked in a git repo — or git is unavailable — so callers can fall back
 * to raw source instead of failing.
 */
export async function blameFile(
  absPath: string,
  from?: number,
  to?: number,
  opts: { signal?: AbortSignal; maxBuffer?: number } = {},
): Promise<BlameResult> {
  const args = ['blame', '--line-porcelain']
  if (from) args.push('-L', `${from},${to ?? from}`)
  args.push('--', basename(absPath))
  try {
    const { stdout } = await run('git', args, {
      cwd: dirname(absPath),
      signal: opts.signal,
      maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
    })
    return { repo: true, lines: parsePorcelainBlame(stdout) }
  } catch {
    return { repo: false, lines: [] }
  }
}
