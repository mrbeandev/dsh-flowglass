// ===== build/source-loader.mjs: safe reading, concatenation, syntax checking, and hashing =====
// Shared build-time module (for Node build scripts only; excluded from every runtime payload).
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

// rootUrl: file URL of the repository root (for example, new URL('../', import.meta.url)); rel is always a root-relative POSIX path
export const makeSourceLoader = (rootUrl) => {
  const resolveUrl = (rel) => new URL('./' + rel, rootUrl)
  return Object.freeze({
    exists: (rel) => existsSync(resolveUrl(rel)),
    read: (rel) => readFileSync(resolveUrl(rel), 'utf8'),
    readExisting: (rels) => rels.filter((r) => existsSync(resolveUrl(r))).map((r) => readFileSync(resolveUrl(r), 'utf8')),
  })
}

// Syntax check (compile without executing); returns null on success, otherwise an error description
export const syntaxCheck = (label, code) => {
  try {
    new Function('return (async () => {\n' + code + '\n})()')
    return null
  } catch (e) {
    return label + ': ' + ((e && e.message) || String(e))
  }
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// Host-side timer verb check (new DSH sandbox ctx gate): using ctx.interval/timeout, etc. while
// inject does not declare 'timer' is rejected at runtime ("sandbox ctx does not expose ..."); catch it early at build time.
export const TIMER_VERBS = ['ctx.interval', 'ctx.timeout', 'ctx.throttle', 'ctx.debounce', 'ctx.setTimeout', 'ctx.setInterval', 'ctx.get(\'timer\')']

// Returns an error description or null
export const checkTimerInject = (entry, implSrc) => {
  if (!entry.hostFiles || entry.platform === 'client-only') return null
  const usesTimer = TIMER_VERBS.some((v) => implSrc.includes(v))
  if (usesTimer && !(entry.inject || []).includes('timer')) {
    return 'timer-inject FAIL: ' + entry.key + ' uses timer verbs in its implementation but inject lacks \'timer\' (the new DSH dynamic Host requires explicit injection)'
  }
  return null
}
