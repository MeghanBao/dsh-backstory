// Recording config + opt-out. Prompts land in the ledger and, via the hook, in
// public commit trailers — so recording is easy to turn off, globally or per repo.
//
// Opt-out precedence:
//   - env `DSH_BACKSTORY_DISABLE=1` (or `true`) disables recording everywhere;
//   - `.dsh/backstory.config.json` with `"record": false` disables it per repo.
// The same config file supplies extra redaction patterns.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface BackstoryConfig {
  record: boolean
  redactPatterns: string[]
}

export const DEFAULT_CONFIG: BackstoryConfig = { record: true, redactPatterns: [] }

export const CONFIG_REL = join('.dsh', 'backstory.config.json')

/** True when the env opts recording out entirely. Pure. */
export function isDisabledByEnv(env: Record<string, string | undefined>): boolean {
  const v = env.DSH_BACKSTORY_DISABLE
  return v === '1' || v === 'true' || v === 'yes'
}

/** Merge untrusted JSON onto the defaults, ignoring wrong-typed fields. Pure. */
export function mergeConfig(raw: unknown): BackstoryConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    record: typeof r.record === 'boolean' ? r.record : DEFAULT_CONFIG.record,
    redactPatterns:
      Array.isArray(r.redactPatterns) && r.redactPatterns.every((x) => typeof x === 'string')
        ? (r.redactPatterns as string[])
        : DEFAULT_CONFIG.redactPatterns,
  }
}

/** Load `<root>/.dsh/backstory.config.json`, falling back to defaults. */
export async function loadConfig(root: string): Promise<BackstoryConfig> {
  try {
    return mergeConfig(JSON.parse(await readFile(join(root, CONFIG_REL), 'utf8')))
  } catch {
    return DEFAULT_CONFIG
  }
}
