// Pure helpers — no dsh, no I/O, no external imports. This is the unit-tested core.

export interface BlameLine {
  line: number
  content: string
  commit: string
  author: string
  authorTime: number // unix epoch seconds
  summary: string
}

/**
 * Parse the output of `git blame --line-porcelain -L a,b -- file`.
 * `--line-porcelain` repeats the full commit metadata for every line, so each
 * record is self-contained: a header line, some `key value` lines, then the
 * source line prefixed with a TAB.
 */
export function parsePorcelainBlame(output: string): BlameLine[] {
  const rows: BlameLine[] = []
  let commit = ''
  let finalLine = 0
  let author = ''
  let authorTime = 0
  let summary = ''

  for (const raw of output.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw)
    if (header) {
      commit = header[1]
      finalLine = Number(header[2])
      author = ''
      authorTime = 0
      summary = ''
      continue
    }
    if (raw.startsWith('author ')) author = raw.slice('author '.length)
    else if (raw.startsWith('author-time ')) authorTime = Number(raw.slice('author-time '.length))
    else if (raw.startsWith('summary ')) summary = raw.slice('summary '.length)
    else if (raw.startsWith('\t')) {
      rows.push({ line: finalLine, content: raw.slice(1), commit, author, authorTime, summary })
    }
  }
  return rows
}

export function shortSha(sha: string): string {
  return /^0{40}$/.test(sha) ? '(uncommitted)' : sha.slice(0, 7)
}

export function isoDate(epochSeconds: number): string {
  if (!epochSeconds) return ''
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}
