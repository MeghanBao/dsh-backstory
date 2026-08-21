// Prompt redaction (pure, unit-tested). Prompts get written into the ledger and,
// via the hook, into public commit trailers — so scrub obvious secrets before
// they are stored. Best-effort pattern masking, not a security guarantee; pair
// with opt-out (see ./config.ts) for anything sensitive.

interface Rule {
  re: RegExp
  replace: string
}

// Order matters: specific token shapes first, then generic key=value pairs.
const RULES: Rule[] = [
  { re: /-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/g, replace: '[REDACTED_KEY]' },
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: '[REDACTED]' }, // OpenAI-style
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED]' }, // GitHub tokens
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[REDACTED]' }, // AWS access key id
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: '[REDACTED]' }, // Slack
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: '[REDACTED]' }, // Google API key
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: '[REDACTED_JWT]' }, // JWT
  { re: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}=*/gi, replace: '[REDACTED]' }, // auth headers
  {
    re: /\b(api[_-]?key|token|secret|password|passwd|pwd|access[_-]?token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    replace: '$1$2[REDACTED]',
  },
]

/**
 * Mask secrets in `text`. Built-in rules cover common token/key shapes;
 * `extraPatterns` (from config) are user-supplied regex source strings, each
 * masked to `[REDACTED]`. A malformed pattern is skipped, never thrown.
 */
export function redactPrompt(text: string, extraPatterns: string[] = []): string {
  let out = text
  for (const { re, replace } of RULES) out = out.replace(re, replace)
  for (const src of extraPatterns) {
    try {
      out = out.replace(new RegExp(src, 'g'), '[REDACTED]')
    } catch {
      /* ignore an invalid user pattern */
    }
  }
  return out
}
