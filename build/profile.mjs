// ===== build/profile.mjs: feature selection, dependency closure, namespace, and build configuration parsing =====
// Pure computation layer for the build CLI: no disk reads (the caller injects a loader for file existence checks), no disk writes, and no time dependency.
import { checkTimerInject } from './source-loader.mjs'

// Consecutive or trailing hyphens collapse to the same Service name after camelOf (a-b and a--b), so reject them as well.
export const BUNDLE_ID_RE = /^(?=.{2,40}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

// ---- Catalog validation (section 5.3): returns a list of errors (empty = valid) ----
export const validateCatalog = (plugins, loader) => {
  const errors = []
  const byKey = new Map()
  for (const p of plugins) {
    if (byKey.has(p.key)) errors.push('Duplicate key: ' + p.key)
    byKey.set(p.key, p)
  }
  const prefixGroups = new Map() // idPrefix -> [keys]
  const aliasOwners = new Map()
  for (const p of plugins) {
    // idPrefix validity and duplicates (duplicates must declare a shared group)
    if (!/^[a-z]{3,6}$/.test(p.idPrefix || '')) errors.push(p.key + ': idPrefix must contain 3-6 lowercase letters (current: ' + p.idPrefix + ')')
    const g = prefixGroups.get(p.idPrefix) || []
    g.push(p)
    prefixGroups.set(p.idPrefix, g)
    // Keep platform consistent with Host/Client files
    const hasHost = Boolean(p.hostFiles && p.hostFiles.length)
    const hasClient = Boolean(p.clientFile)
    if (p.platform === 'host-only' && (!hasHost || hasClient)) errors.push(p.key + ': platform=host-only is inconsistent with hostFiles/clientFile')
    if (p.platform === 'client-only' && (!hasClient || hasHost)) errors.push(p.key + ': platform=client-only is inconsistent with hostFiles/clientFile')
    if (p.platform === 'host+client' && (!hasHost || !hasClient)) errors.push(p.key + ': platform=host+client requires both hostFiles and clientFile')
    // Client-only features and features with a Client side require approval
    if (hasClient && p.approval !== true) errors.push(p.key + ': features with a Client side require approval: true (security gate for browser code execution)')
    // Features with a Client side require process scope (avoids repeated approval per root; review non-blocker 2)
    if (hasClient && p.bundle && p.bundle.scope !== 'process') errors.push(p.key + ': features with a Client side require bundle.scope=process')
    // References to nonexistent source files
    if (loader) {
      for (const f of (p.hostFiles || []).concat(p.clientFile ? [p.clientFile] : [])) {
        if (!loader.exists(f)) errors.push(p.key + ': source file does not exist: ' + f)
      }
      // Timer verb check
      if (hasHost) {
        const implSrc = loader.readExisting(
          ['shared/runtime.js']
            .concat(p.sharedRegistry ? ['shared/registry.js'] : [])
            .concat(p.sharedHost === false ? [] : ['shared/host.js'])
            .concat(p.hostFiles || []),
        ).join('\n')
        const timerErr = checkTimerInject(p, implSrc)
        if (timerErr) errors.push(timerErr)
      }
    }
    // Unknown dependency/conflict
    const b = p.bundle || {}
    if (b.selectable) {
      for (const alias of [p.key].concat(b.aliases || [])) {
        const owner = aliasOwners.get(alias)
        if (owner && owner !== p.key) errors.push('Duplicate feature alias: ' + alias + ' (' + owner + ', ' + p.key + ')')
        else aliasOwners.set(alias, p.key)
      }
    }
    for (const d of b.dependencies || []) if (!byKey.has(d)) errors.push(p.key + ': unknown dependency: ' + d)
    for (const c of b.conflicts || []) if (!byKey.has(c)) errors.push(p.key + ': unknown conflict: ' + c)
  }
  for (const [prefix, group] of prefixGroups) {
    if (group.length > 1 && !group.every((p) => p.idPrefixSharedGroup && group.every((q) => q.idPrefixSharedGroup === p.idPrefixSharedGroup))) {
      errors.push('Duplicate idPrefix without the same shared group declaration: ' + prefix + ' (' + group.map((p) => p.key).join(', ') + ')')
    }
  }
  // Dependency cycles (three-color DFS marking)
  const color = new Map()
  const visit = (key, chain) => {
    const c = color.get(key)
    if (c === 2) return
    if (c === 1) { errors.push('Dependency cycle: ' + chain.concat([key]).join(' -> ')); return }
    color.set(key, 1)
    const p = byKey.get(key)
    for (const d of (p && p.bundle && p.bundle.dependencies) || []) visit(d, chain.concat([key]))
    color.set(key, 2)
  }
  for (const p of plugins) visit(p.key, [])
  return errors
}

// ---- Normalize feature selection: alias resolution -> dependency closure -> conflict rejection -> sort by (order, key), with lexical key order for equal order ----
// Returns { ok, errors, explicit, dependencyAdded, selected }; selected includes toolbox and always places it first
export const normalizeSelection = (plugins, requested) => {
  const errors = []
  const byKey = new Map(plugins.map((p) => [p.key, p]))
  const aliasToKey = new Map()
  for (const p of plugins) {
    const b = p.bundle || {}
    if (!b.selectable) continue
    aliasToKey.set(p.key, p.key)
    for (const a of b.aliases || []) aliasToKey.set(a, p.key)
  }
  const explicit = []
  for (const r of requested) {
    const key = aliasToKey.get(r)
    if (!key) { errors.push('Unknown feature: ' + r + ' (available: ' + [...aliasToKey.keys()].join(', ') + ')'); continue }
    if (explicit.indexOf(key) < 0) explicit.push(key)
  }
  if (requested.length && !explicit.length) return { ok: false, errors, explicit: [], dependencyAdded: [], selected: [] }
  if (!explicit.length) { errors.push('Empty selection: select at least one feature (the toolbox framework is added implicitly)'); return { ok: false, errors, explicit: [], dependencyAdded: [], selected: [] } }
  // Dependency closure
  const all = new Set(explicit)
  const dependencyAdded = []
  const queue = [...explicit]
  while (queue.length) {
    const key = queue.shift()
    const p = byKey.get(key)
    for (const d of (p && p.bundle && p.bundle.dependencies) || []) {
      if (!all.has(d)) { all.add(d); dependencyAdded.push(d); queue.push(d) }
    }
  }
  // Conflict rejection
  for (const key of all) {
    const p = byKey.get(key)
    for (const c of (p && p.bundle && p.bundle.conflicts) || []) {
      if (all.has(c)) errors.push('Feature conflict: ' + key + ' and ' + c + ' cannot be compiled into the same bundle')
    }
  }
  if (errors.length) return { ok: false, errors, explicit, dependencyAdded, selected: [] }
  const cmp = (a, b) => {
    const pa = byKey.get(a); const pb = byKey.get(b)
    return ((pa.order || 0) - (pb.order || 0)) || (a < b ? -1 : a > b ? 1 : 0)
  }
  const features = [...all].sort(cmp)
  return {
    ok: true,
    errors: [],
    explicit: explicit.slice().sort(cmp),
    dependencyAdded: dependencyAdded.sort(cmp),
    selected: ['toolbox'].concat(features),
  }
}

// ---- Namespace derivation (section 9.2): bundleId -> all technical names ----
export const camelOf = (bundleId) => bundleId.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')

export const deriveRuntimeOverrides = (bundleId, displayName, { aiUsage = true, componentBridge = false } = {}) => ({
  mode: 'static-bundle',
  bundleId,
  displayName,
  registryService: 'toolboxRegistry' + camelOf(bundleId),
  artifactService: 'toolboxArtifacts' + camelOf(bundleId),
  remoteService: 'toolboxNative' + camelOf(bundleId),
  remoteNamespace: 'toolboxNative' + camelOf(bundleId),
  ...(componentBridge ? { bridgeService: 'toolboxNativeBridge' + camelOf(bundleId) } : {}),
  rpcPrefix: 'toolbox.' + bundleId,
  storagePrefix: 'dsh.toolbox.' + bundleId,
  eventPrefix: 'tb-' + bundleId,
  slotPrefix: 'toolbox-' + bundleId,
  domId: bundleId,
  hostIdPrefix: 'toolbox-host-' + bundleId,
  dataDir: '.dsh-dynamic-toolbox', // The business data directory follows the dynamic-mode convention (fixed at build time; toolbox.config.json is not read)
  capabilities: {
    diskReload: false,
    rebuildFromDisk: false,
    pluginDefaults: false,
    pluginRestart: false,
    aiUsage: false,
    managePlugins: false,
  },
})
