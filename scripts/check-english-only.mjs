import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist'])
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])
const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const cjkPunctuation = /[\u3001\u3002\u3008-\u300f\u3010\u3011\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f]/u
const failures = []

const visit = (path) => {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    if (ignoredDirectories.has(path.split(/[\\/]/).pop())) return
    for (const entry of readdirSync(path)) visit(resolve(path, entry))
    return
  }
  if (!textExtensions.has(extname(path).toLowerCase())) return
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u)
  lines.forEach((line, index) => {
    if (han.test(line) || cjkPunctuation.test(line)) failures.push(relative(root, path) + ':' + (index + 1) + ': ' + line.trim())
  })
}

visit(root)
if (failures.length) {
  console.error('English-only check failed. Han characters or CJK punctuation found:')
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('English-only check passed: no Han characters or CJK punctuation found.')
