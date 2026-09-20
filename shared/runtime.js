// ===== shared/runtime.js: runtime configuration and naming helpers shared by both modes =====
// Pure JS: does not access Node APIs or depend on Host/Client-specific globals, so it can be concatenated into Host and Client payloads.
// Dynamic mode: concatenate only this file (without TOOLBOX_RUNTIME_OVERRIDES) -> all dynamic defaults, matching historical behavior.
  // Native static mode: the builder prepends a `const TOOLBOX_RUNTIME_OVERRIDES = {...}` JSON literal before this file.
// Configuration does not use globalThis/window/process.env (multiple bundles in one process would overwrite each other, approved packages must be auditable,
// and globals would prevent the payload content hash from representing actual behavior) -- business logic reads only TOOLBOX_RUNTIME defined in this file.
const TOOLBOX_RUNTIME = (() => {
  const o = (typeof TOOLBOX_RUNTIME_OVERRIDES !== 'undefined' && TOOLBOX_RUNTIME_OVERRIDES) || {}
  const mode = o.mode || 'dynamic-dev'
  const bundleId = o.bundleId || 'dynamic'
  const rpcPrefix = o.rpcPrefix || 'toolbox'
  const storagePrefix = o.storagePrefix || 'dsh.toolbox'
  const eventPrefix = o.eventPrefix || 'tb'
  const slotPrefix = o.slotPrefix || 'toolbox'
  return Object.freeze({
    mode, // 'dynamic-dev' | 'static-bundle'
    bundleId, // Always 'dynamic' in dynamic mode; bundleId for static installation packages (for example, 'flow-plus')
    displayName: o.displayName || 'Toolbox',
    registryService: o.registryService || 'toolboxRegistry',
    artifactService: o.artifactService || null,
    remoteService: o.remoteService || null,
    remoteNamespace: o.remoteNamespace || null,
    rpcPrefix, // Dynamic: 'toolbox'; compiled: 'toolbox.<bundleId>' -> rpc('tools') = '<prefix>/tools'
    storagePrefix, // Dynamic: 'dsh.toolbox'; compiled: 'dsh.toolbox.<bundleId>'
    eventPrefix, // Dynamic: 'tb'; compiled: 'tb-<bundleId>' -> event('session-changed')
    slotPrefix, // Dynamic: 'toolbox'; compiled: 'toolbox-<bundleId>' -> slot('entry') / slot('drawer')
    domId: o.domId || 'dynamic', // DOM marker naming value; always 'dynamic' in dynamic mode
    hostIdPrefix: o.hostIdPrefix || 'toolbox-host',
    dataDir: o.dataDir || '.dsh-dynamic-toolbox',
    capabilities: Object.freeze(Object.assign({
      diskReload: mode === 'dynamic-dev',
      rebuildFromDisk: mode === 'dynamic-dev',
      pluginDefaults: true,
      pluginRestart: true,
      aiUsage: true,
      managePlugins: true,
    }, o.capabilities || {})),
    // ---- Naming helpers (prefixes are already normalized by the builder; concatenation produces the final name) ----
    rpc: (suffix) => rpcPrefix + '/' + suffix,
    storageKey: (suffix) => storagePrefix + '.' + suffix,
    event: (suffix) => eventPrefix + '-' + suffix,
    slot: (name) => slotPrefix + '-' + name,
    // DOM marker values: dynamic defaults preserve historical values (mounted="1", entry=""); compiled mode uses bundleId to distinguish bundles
    domValue: () => (bundleId === 'dynamic' ? '' : bundleId),
    domMountedValue: () => (bundleId === 'dynamic' ? '1' : bundleId),
    logTag: () => (bundleId === 'dynamic' ? '[toolbox]' : '[toolbox:' + bundleId + ']'),
  })
})()
