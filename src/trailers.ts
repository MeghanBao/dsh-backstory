// Git-native provenance (v0.4): fold the agent turn/prompt into commit-message
// trailers so that, once work is committed, `git blame → sha → trailer` recovers
// the provenance and git's own line tracking handles drift for free — no ledger
// hash lookup needed. Pure and unit-tested; the git I/O lives in ./git.ts.

export interface CommitProvenance {
  turn: number
  prompt: string
  session: string
}

export const TRAILER = { turn: 'DSH-Turn', prompt: 'DSH-Prompt', session: 'DSH-Session' } as const

/** Collapse a prompt to a single trailer-safe line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Render the trailer block to append to a commit message. A `prepare-commit-msg`
 * hook (or the agent) writes this so the commit carries who/why.
 */
export function formatProvenanceTrailers(p: {
  turn: number
  prompt: string
  session?: string
}): string {
  const out = [`${TRAILER.turn}: ${p.turn}`, `${TRAILER.prompt}: ${oneLine(p.prompt)}`]
  if (p.session) out.push(`${TRAILER.session}: ${p.session}`)
  return out.join('\n')
}

/**
 * Extract provenance trailers from a commit body. Returns null when no
 * DSH-Turn/DSH-Prompt trailer is present. Scans every line (git keeps trailers
 * at the end, but we tolerate placement).
 */
export function parseProvenanceTrailers(body: string): CommitProvenance | null {
  let turn = -1
  let prompt = ''
  let session = ''
  let seen = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const t = /^DSH-Turn:\s*(-?\d+)$/.exec(line)
    if (t) {
      turn = Number(t[1])
      seen = true
      continue
    }
    const p = /^DSH-Prompt:\s*(.*)$/.exec(line)
    if (p) {
      prompt = p[1]
      seen = true
      continue
    }
    const s = /^DSH-Session:\s*(.*)$/.exec(line)
    if (s) {
      session = s[1]
      seen = true
    }
  }
  return seen ? { turn, prompt, session } : null
}
