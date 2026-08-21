// Installs a `prepare-commit-msg` git hook that appends DSH-* provenance
// trailers (see ./hook.ts). Run once per clone:  `npm run install-hook`.
// The hook is a tiny POSIX shim that shells out to this plugin's hook.ts, so the
// trailer logic has a single source of truth. Removing the hook file disables it.

import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // .../src
const HOOK_ENTRY = join(HERE, 'hook.ts')

const MARKER = 'dsh-backstory'

/** The POSIX shim written into `.git/hooks/prepare-commit-msg`. */
export function hookScript(hookEntry: string): string {
  return [
    '#!/bin/sh',
    `# ${MARKER}: append DSH-* provenance trailers from .dsh/backstory.jsonl`,
    '# (auto-installed; delete this file to disable)',
    `HOOK=${JSON.stringify(hookEntry)}`,
    '[ -f "$HOOK" ] || exit 0',
    'command -v node >/dev/null 2>&1 || exit 0',
    'node "$HOOK" "$1" 2>/dev/null || exit 0',
    '',
  ].join('\n')
}

export interface InstallResult {
  installed: boolean
  path: string
  reason?: string
  backedUp?: boolean
}

/** Write the hook into `<root>/.git/hooks`, backing up any foreign existing hook. */
export async function installHook(root: string, hookEntry: string = HOOK_ENTRY): Promise<InstallResult> {
  const path = join(root, '.git', 'hooks', 'prepare-commit-msg')
  try {
    await access(join(root, '.git'))
  } catch {
    return { installed: false, path, reason: 'not a git repository' }
  }
  await mkdir(dirname(path), { recursive: true })

  let backedUp = false
  try {
    const existing = await readFile(path, 'utf8')
    if (!existing.includes(MARKER)) {
      await rename(path, `${path}.backup`)
      backedUp = true
    }
  } catch {
    /* no existing hook */
  }

  await writeFile(path, hookScript(hookEntry), 'utf8')
  await chmod(path, 0o755)
  return { installed: true, path, backedUp }
}

if (process.argv[1]?.endsWith('install-hook.ts')) {
  const res = await installHook(process.cwd())
  if (res.installed) {
    console.log(`✓ installed prepare-commit-msg hook → ${res.path}`)
    if (res.backedUp) console.log(`  (existing hook moved to ${res.path}.backup)`)
  } else {
    console.error(`✗ not installed: ${res.reason}`)
    process.exitCode = 1
  }
}
