// ===== scripts/build-toolbox-bundle.mjs: toolbox bundle build CLI (thin wrapper) =====
// Selects features from the shared plugin catalog and builds a native static DSH Host/Client bundle (see --help).
// The pure, reproducible build pipeline lives in build/build-bundle.mjs; this file only parses arguments and writes files.
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path'
import { PLUGINS } from '../build/plugin-catalog.mjs'
import { makeSourceLoader } from '../build/source-loader.mjs'
import { BUNDLE_ID_RE } from '../build/profile.mjs'
import { buildBundle } from '../build/build-bundle.mjs'

const rootUrl = new URL('../', import.meta.url)
const loader = makeSourceLoader(rootUrl)

// ---- Argument parsing ----
const argv = process.argv.slice(2)
const aliases = new Map()
for (const p of PLUGINS) {
  const b = p.bundle || {}
  if (!b.selectable) continue
  aliases.set(p.key, p.key)
  for (const a of b.aliases || []) aliases.set(a, p.key)
}
const opts = { features: [], clean: false, dryRun: false, json: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--help' || a === '-h') { opts.help = true }
  else if (a === '--features') { opts.features.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)) }
  else if (a === '--id') opts.id = argv[++i]
  else if (a === '--name') opts.name = argv[++i]
  else if (a === '--label') opts.label = argv[++i]
  else if (a === '--version') opts.version = argv[++i]
  else if (a === '--repo-dir') opts.repositoryDirectory = argv[++i]
  else if (a === '--out') opts.out = argv[++i]
  else if (a === '--clean') opts.clean = true
  else if (a === '--dry-run') opts.dryRun = true
  else if (a === '--json') opts.json = true
  else if (a.startsWith('--') && aliases.has(a.slice(2))) opts.features.push(aliases.get(a.slice(2)))
  else { console.error('Unknown argument: ' + a + ' (see --help for usage)'); process.exit(2) }
}

if (opts.help) {
  console.log(`Usage: node scripts/build-toolbox-bundle.mjs [--features a,b] [options]
  --features a,b   Standard selection interface (default: flow, producing dsh-flowglass-en with bundleId flowglass-en; normalized by catalog order)
  --flow / --jira…  Feature alias shortcuts (available: ${[...aliases.keys()].join(', ')})
  --id <id>        bundleId (default: flowglass-en for Flowglass; otherwise selected keys joined in lexical order with -; ${BUNDLE_ID_RE})
  --name <pkg>     npm package name (Flowglass default: dsh-flowglass-en; others: dsh-<id>-toolbox)
  --label <text>   Sidebar/drawer display name (single feature: feature label; multiple features: "A + B Toolbox")
  --version <ver>  semver (default: 0.0.0-dev; releases must provide a valid semver explicitly)
  --repo-dir <dir>  package.json repository.directory for published packages (links back to a repository subdirectory)
  --out <dir>      Output directory (default: dist/toolbox-bundles/<id>)
  --clean          Remove the exact resolved output directory before building
  --dry-run        Print the resolved profile, file list, and validation result without writing files
  --json           Print a machine-readable build summary for CI`)
  process.exit(0)
}

const result = buildBundle(loader, opts)
if (!result.ok) {
  console.error('✗ Build failed:\n  ' + result.errors.join('\n  '))
  process.exit(1)
}
const { files, summary } = result
const outRel = opts.out || ('dist/toolbox-bundles/' + summary.bundleId)
const repoRoot = fileURLToPath(rootUrl)
const allowedOutRoot = resolve(repoRoot, 'dist', 'toolbox-bundles')
const outPath = resolve(repoRoot, outRel)
const fromAllowedRoot = relative(allowedOutRoot, outPath)
// --clean recursively removes the target directory. The output must be a strict
// child of dist/toolbox-bundles: it cannot escape through .. or an absolute path,
// and the output root itself cannot be used as the target.
if (!fromAllowedRoot || fromAllowedRoot === '..' || fromAllowedRoot.startsWith('..' + sep) || isAbsolute(fromAllowedRoot)) {
  console.error('✗ Unsafe output directory: ' + outRel + ' (must be under dist/toolbox-bundles/<bundle>)')
  process.exit(2)
}

// ---- Summary ----
if (opts.json) {
  console.log(JSON.stringify(Object.assign({ out: outRel }, summary), null, 2))
} else {
  console.log('bundle: ' + summary.bundleId + ' (' + summary.packageName + '@' + summary.version + ') → ' + outRel)
  console.log('features: explicitly selected [' + summary.features.explicit.join(', ') + ']'
    + (summary.features.dependencyAdded.length ? '; dependencies added [' + summary.features.dependencyAdded.join(', ') + ']' : '')
    + '; toolbox framework added implicitly')
  console.log('display name: ' + summary.label + '; fingerprint: ' + summary.fingerprint)
  console.log('load mode: native static DSH Host/Client; dynamic approvals: 0')
  for (const f of summary.files) console.log('  ' + f.path + '  ' + f.bytes + ' B')
}

if (opts.dryRun) { if (!opts.json) console.log('(dry run: no files written)'); process.exit(0) }

// ---- Write files (--clean only removes the exact resolved output directory) ----
if (opts.clean && existsSync(outPath)) rmSync(outPath, { recursive: true, force: true })
mkdirSync(join(outPath, 'lib'), { recursive: true })
for (const [rel, content] of files) {
  const target = join(outPath, ...rel.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
console.log('>>> Build complete: ' + outRel + ' (' + files.size + ' files)')
console.log('Next: cd ' + outRel + ' && npm pack, then dsh plugin --profile web add <tgz>')
