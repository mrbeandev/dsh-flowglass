// Verify the native static bundle structure and contracts.
// Usage: node scripts/verify-bundle.mjs <bundleDir> [--pack]
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const dir = (process.argv[2] || '').replace(/\\/g, '/').replace(/\/+$/, '')
const withPack = process.argv.includes('--pack')
if (!dir) { console.error('Usage: node scripts/verify-bundle.mjs <bundleDir> [--pack]'); process.exit(2) }

let failures = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''))
  if (!cond) failures++
}
const read = (rel) => { try { return readFileSync(dir + '/' + rel, 'utf8') } catch (error) { return null } }
const required = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/remote.js', 'manifest.json', 'BUILDINFO.json', 'README.md', 'LICENSE']
for (const file of required) check('Includes ' + file, existsSync(dir + '/' + file))

const pkg = JSON.parse(read('package.json') || '{}')
check('Uses the native Host entry', pkg.type === 'module' && pkg.main === './lib/index.js' && pkg.exports && pkg.exports['.'] === './lib/index.js')
check('Exports native Client and Remote entries', pkg.exports && pkg.exports['./client'] === './lib/client.js' && pkg.exports['./remote'] === './lib/remote.js')
check('Declares dsh.bundle.patch', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml')
check('Declares the native web Client', pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web')
check('Client uses api-remotes/ui-session without removed client-runtime',
  pkg.dsh && pkg.dsh.client
    && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes')
    && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-session')
    && !pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
check('Declares the Host Typert protocol peer', pkg.peerDependencies && typeof pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'] === 'string')
check('Does not depend on dynamic Host/Client runners', JSON.stringify(pkg).indexOf('cordis-host-runner') < 0 && JSON.stringify(pkg).indexOf('cordis-client-runner') < 0)
check('Uses the English package identity', pkg.name === 'dsh-flowglass-en')

const info = JSON.parse(read('BUILDINFO.json') || '{}')
const manifest = JSON.parse(read('manifest.json') || '{}')
check('BUILDINFO marks native-static with zero approval', info.mode === 'native-static' && info.dynamicApprovalRequired === false)
check('Manifest marks native-static', manifest.mode === 'native-static')
check('Uses the collision-free bundle identity', info.bundleId === 'flowglass-en' && manifest.bundle === 'flowglass-en')
check('Includes a fingerprint', typeof info.fingerprint === 'string' && info.fingerprint.length >= 12)
const patch = read('cordis.patch.yml') || ''
check('Patch row ID and package name are correct', patch.includes('toolbox-bundle-' + info.bundleId) && patch.includes("name: '" + pkg.name + "'"))

const host = read('lib/index.js') || ''
const client = read('lib/client.js') || ''
const remote = read('lib/remote.js') || ''
const combined = host + '\n' + client + '\n' + remote
check('Host is a native Typert Remote Service', host.includes('TypertRemoteService') && host.includes('export async function apply(ctx)'))
check('Client registers with __ModuleLoader__', client.includes('window.__ModuleLoader__.load({') && client.includes('id: ' + JSON.stringify(pkg.name)))
check('Client mounts the native Remote contribution', client.includes('ctx.remote.$mount(remoteContribution)'))
check('Client bundle exports apply/inject', client.includes('exports.inject = inject') && client.includes('exports.apply = apply'))
check('Contains no dynamic runner path', !/dynamicCordisRunner|runner\.define|runner\.run|dyn\//.test(combined))
check('Contains no dynamic payload/loader stub', !/payloads\.js|TOOL_FILES|cannot load loader\.js/.test(combined))
check('Remote describes tools/panel/sessionInfo', remote.includes("descriptor('tools')") && remote.includes("descriptor('panel')") && remote.includes("descriptor('sessionInfo')"))
check('Generated code contains no Han characters', !/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(combined))

for (const file of ['lib/index.js', 'lib/client.js', 'lib/remote.js']) {
  const result = spawnSync(process.execPath, ['--check', dir + '/' + file], { encoding: 'utf8' })
  check(file + ' passes syntax check', result.status === 0, result.status === 0 ? '' : (result.stderr || result.stdout || '').slice(0, 240))
}

if (withPack) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, shell: true, encoding: 'utf8' })
  check('npm pack --dry-run succeeds', result.status === 0, result.status === 0 ? '' : (result.stderr || '').slice(0, 240))
  if (result.status === 0) {
    const names = (JSON.parse(result.stdout)[0].files || []).map((file) => file.path.replace(/\\/g, '/'))
    for (const wanted of required) check('Tarball includes ' + wanted, names.includes(wanted))
    const banned = names.filter((name) => /(^|\/)(payloads\.js|runtime-profile\.js|loader\.js|payload\.json)$/.test(name))
    check('Tarball excludes dynamic payload/loader artifacts', banned.length === 0, banned[0] || '')
  }
}

console.log(failures ? ('>>> ' + failures + ' checks failed') : '>>> Native static bundle verification passed')
process.exit(failures ? 1 : 0)
