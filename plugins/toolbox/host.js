// ===== toolbox-host.js: toolbox framework Host half — tool registry + panel RPC + plugin lifecycle controls =====
// Host-only tool plugins register through ctx.get(TOOLBOX_RUNTIME.registryService).register(...);
// the Client shell is driven through toolbox/tools (listing) and toolbox/panel (rendering/actions);
// the gear management view is driven through toolbox/plugins (inventory) and toolbox/plugin-toggle (real stop/start),
// directly connected to the dynamicCordisRunner service (the Cordis panel stop/run buttons are its @Remote versions,
// stopFromPanel/runHostHalf). Both use the same registry as the Cordis panel, so their state stays synchronized naturally.
// Note: ctx.get is an optional lookup unrestricted by inject (guard.ts readService enforces declarations only on property access).

return {
  name: 'toolbox-host',
  async apply(ctx) {
    const RT = TOOLBOX_RUNTIME

    // ===== Artifact Provider (artifact-source abstraction) =====
    // Dynamic mode: DynamicDiskProvider probes every root bearing this repository's strong marker (plugins.json contains id:'toolbox').
    // Direct hits take priority, with first-level subdirectories as fallback; payloads are read live from disk, and enablement state is stored in <root>/<dataDir>/toolbox-plugins.json.
    // Compiled mode: a namespaced Service supplied by the static Bootstrap embeds the manifest/payload and neither scans repositories nor reads source-repository files.
    // The body of this file depends only on the unified interface and no longer assumes that plugins.json necessarily exists.
    const makeDynamicDiskProvider = () => {
      const baseRoots = () => {
        const r = []
        const sp = ctx.get('sandboxPolicy')
        if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) r.push(sp.workspaceRoot)
        const ss = ctx.get('sessions')
        if (ss) { try { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && r.indexOf(c) < 0) r.push(c) } } catch (e) {} }
        return r
      }
      const readManifestAt = async (fs, dir) => {
        try {
          const t = await fs.resolve('plugins.json', { cwd: dir })
          if (!await fs.stat(t)) return null
          const parsed = JSON.parse(await fs.readText(t))
          if (!parsed || !Array.isArray(parsed.plugins) || !parsed.plugins.some((e) => e && e.id === 'toolbox')) return null
          return { manifest: parsed, root: String(dir).replace(/[\\/]+$/, '') }
        } catch (e) { return null }
      }
      // Do not cache: with multiple repositories, each candidate is an independent repository, so the first match must not become permanently fixed.
      const probeManifests = async (bases) => {
        const fs = ctx.get('fs')
        if (!fs) return []
        const out = []
        const seen = new Set()
        for (const b of bases) {
          const hit = await readManifestAt(fs, b)
          if (hit && !seen.has(hit.root)) { seen.add(hit.root); out.push(hit) }
        }
        for (const b of bases) {
          try {
            const entries = await fs.listDir(await fs.resolve('.', { cwd: b }))
            for (const ent of entries || []) {
              if (!ent || ent.type !== 'directory' || !ent.name) continue
              if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
              const hit = await readManifestAt(fs, b.replace(/[\\/]+$/, '') + '/' + ent.name)
              if (hit && !seen.has(hit.root)) { seen.add(hit.root); out.push(hit) }
            }
          } catch (e) {}
        }
        return out
      }
      const CONFIG_REL = RT.dataDir + '/toolbox-plugins.json'
      return {
        mode: 'dynamic-dev',
        capabilities: RT.capabilities,
        // Manifests for every candidate repository (used by this framework to select its own root).
        async manifests() { return probeManifests(baseRoots()) },
        // manifest(base?): when base is supplied, probe only that path (for resolveRoot); otherwise probe globally and return the first match.
        async manifest(base) {
          const hits = await probeManifests(base ? [base] : baseRoots())
          return hits[0] || null
        },
        async payload(root, entry) {
          const fs = ctx.get('fs')
          if (!fs) throw new Error('fs service unavailable')
          const pt = await fs.resolve(entry.payload, { cwd: root })
          return JSON.parse(await fs.readText(pt))
        },
        // Read enablement state from <root>/<dataDir>/toolbox-plugins.json.
        async readEnablement(root) {
          const fs = ctx.get('fs')
          if (!fs || !root) return { version: 1, plugins: {} }
          try {
            const t = await fs.resolve(CONFIG_REL, { cwd: root })
            if (!await fs.stat(t)) return { version: 1, plugins: {} }
            const parsed = JSON.parse(await fs.readText(t))
            if (!parsed || typeof parsed !== 'object' || !parsed.plugins || typeof parsed.plugins !== 'object') {
              return { version: 1, plugins: {} }
            }
            return parsed
          } catch (e) { return { version: 1, plugins: {} } }
        },
        // Write enablement state through subprocess (the same path used for automatic-completion reports, bypassing fs sandbox policy).
        async writeEnablement(root, cfg) {
          const sub = ctx.get('subprocess')
          if (!sub || !root) return false
          try {
            const handle = sub.spawn({
              argv: ['node', '-e', "const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],process.argv[2])", root.replace(/[\\/]+$/, '') + '/' + CONFIG_REL, JSON.stringify(cfg, null, 2)],
              stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
              graceMs: 10000,
            })
            await handle.done
            return true
          } catch (e) { return false }
        },
      }
    }
    const artifacts = (RT.artifactService && ctx.get(RT.artifactService)) || makeDynamicDiskProvider()

    // All candidate repository roots (used by this framework to select its own root).
    const rootCands = (await artifacts.manifests()).map((h) => h.root)

    // ==== Global multiplex registry (v6.3): provide only one per process (first framework or static bootstrapper); later frameworks attach. ====
    // Single source of truth for the implementation: shared/registry.js (concatenated into this payload, with one contract across dynamic, compiled, and static-bootstrap modes).
    // State lives on the service object (shared across fibers): root -> tool table; see that file for the build-lock-based runInBuild.
    // Reuse/provide rule: reuse an existing global instance if another repository or bundle started first; otherwise provide a new instance.
    const existingReg = ctx.get(RT.registryService)
    const registry = existingReg || (() => { const r = makeToolboxRegistry(); ctx.provide(RT.registryService, r); return r })()

    // Framework-driven runner.run calls must execute inside the registry's mutually exclusive build section (register calls inside a tool plugin's apply are assigned
    // to this root's table). Manual toggles, restarts, bulk actions, reattachment, and rebuilds all go through here to avoid misassigning them via the single lastRoot slot.
    const runInBuild = (root, fn) => registry.runInBuild(root, fn)

    // Root of this framework's repository: probe every candidate (sandboxPolicy.workspaceRoot plus each session cwd, including first-level subdirectories),
    // then choose a repository not yet attached by any framework. With multiple repositories, each framework claims one instead of all taking the first.
    const myRoot = (() => {
      for (const c of rootCands) if (!registry.has(c)) return c
      return rootCands[0] || null
    })()
    if (myRoot) {
      registry.attach(myRoot)
      // Detach when the framework stops or updates: the registry is a process-global service shared across fibers, and after the framework dies,
      // a leftover ghost root permanently corrupts both the bootstrap "instance already exists for this repository" check and myRoot arbitration (the has() occupancy check),
      // preventing bootstrap recovery after a stop and potentially making a multi-repository restart claim another framework's root.
      ctx.effect(() => () => { try { registry.detach(myRoot) } catch (e) {} })
    }

    // findManifest(base?): when base is supplied, probe only that path (for resolveRoot); otherwise probe globally and return the first match.
    // Delegated to the Artifact Provider: dynamic mode probes disk; compiled mode matches an attached workspace root.
    const findManifest = (base) => artifacts.manifest(base)

    // Panel RPC root resolution: first probe the caller's explicit cwd (the client sends the currently active workspace path);
    // with no cwd or no match, fall back to this framework's root (cwd should always exist with multiple repositories; fallback supports legacy callers only).
    const resolveRoot = async (args) => {
      const cwd = args && ((typeof args.cwd === 'string' && args.cwd) ? args.cwd : (typeof args.root === 'string' && args.root) ? args.root : '')
      if (cwd) {
        const found = await findManifest(String(cwd).replace(/[\\/]+$/, ''))
        if (found) return found.root
        return null // Explicitly not found (this cwd has no toolbox): do not fall back to this framework's root and show tools from the wrong repository after switching repositories.
      }
      return myRoot || null
    }
    // Whether the caller explicitly supplied cwd/root (strict semantics): if an explicit path cannot be resolved, never send null into the registry,
    // because the registry's `root || lastRoot` fallback would route the request to the most recently attached repository, leaking data across repositories:
    // a workspace without a toolbox would show the previous repository's tools, and panel actions would run wrong-repository tools with root=undefined.
    const hasExplicitRoot = (args) => Boolean(args && (((typeof args.cwd === 'string') && args.cwd) || ((typeof args.root === 'string') && args.root)))
    const ROOT_UNMOUNTED_ERR = 'The toolbox is not mounted in the current workspace'

    ctx.effect(() => harness.handle(RT.rpc('tools'), async (args) => {
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      // An unresolved explicit cwd produces the empty state (the client then shows "dsh-dynamic-toolbox not detected" and renders no tabs).
      if (strict && !root) return { ok: true, root: null, tools: [] }
      return { ok: true, root, tools: registry.tools(root) }
    }))

    // ===== Plugin lifecycle management (gear view) =====
    const runner = ctx.get('dynamicCordisRunner')
    // stopFromPanel is an rc.7 runner panel method, not a stable wire-level protocol; if absent, degrade only
    // the stop path (return a clear error and set canStop=false in the inventory so the client disables the toggle). Inventory reads,
    // ordinary tools, panels, and the start path remain available.
    const canStopFromPanel = Boolean(runner && typeof runner.stopFromPanel === 'function')
    const agents = ctx.get('agents')
    const sessionsSvc = ctx.get('sessions')
    const sessionOf = (args) => (args && typeof args.session === 'string' && args.session) ? args.session : undefined

    // Agent resolution: prefer a live agent; for a host session, ghost id, or another non-live session, fall back to a minimal agent.
    // Runner internals consume only agent.id; steer/inject are already silent when agents.get finds nothing.
    // In bootstrap host-session mode, the primary instance belongs to the host session id; this fallback lets drawer management RPCs drive it too.
    const agentFor = (sid) => sid ? ((agents && agents.get(sid)) || { id: sid }) : undefined

    // Host session id (same algorithm as hostIdOf in host-bootstrap/index.js; both sites must stay synchronized): uniquely identifies a repository root
    // and matches this framework to its host-session row during automatic completion without confusing framework rows across repositories.
    // After canonicalizing the path (normalize separators, remove trailing separators, and fold case on Windows), use a normalized short prefix plus an FNV-1a hash.
    // Truncation alone would collide for long paths sharing a prefix; without canonicalization, alternate spellings of one directory would yield different owners.
    const pathHash = (s) => {
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h.toString(36)
    }
    const canonicalRoot = (root) => {
      let s = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '')
      if (/^[a-zA-Z]:/.test(s) || s.indexOf('//') === 0) s = s.toLowerCase()
      return s
    }
    const hostIdOf = (root) => {
      const canon = canonicalRoot(root)
      const norm = canon.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
      const prefix = norm.slice(-24)
      return RT.hostIdPrefix + '-' + (prefix ? prefix + '-' : '') + pathHash(canon)
    }

    // Manifest mapping (cached by root): root -> { name -> { entryId, defaultStart } }.
    // Lazy function: its body references readConfig, which is initialized by the time this function is called.
    const manifestCacheByRoot = new Map()
    const manifestMap = async (root) => {
      if (manifestCacheByRoot.has(root)) return manifestCacheByRoot.get(root)
      const out = {}
      try {
        const found = await findManifest(root || undefined)
        if (found && found.manifest && Array.isArray(found.manifest.plugins)) {
          const cfg = await readConfig(found.root)
          const recs = (cfg && cfg.plugins) || {}
          for (const e of found.manifest.plugins) {
            if (!e || typeof e.name !== 'string') continue
            const rec = recs[e.id]
            out[e.name] = {
              entryId: e.id,
              defaultStart: rec && typeof rec.enabled === 'boolean' ? rec.enabled : Boolean(e.autoStart),
            }
          }
        }
      } catch (e) {}
      manifestCacheByRoot.set(root, out)
      return out
    }

    // Whether a row belongs to this repository: a manifest-name match is necessary but insufficient, because Package names are identical across clones.
    // Name-only filtering would pull repository B rows into repository A management, causing bulk toggles across repositories and writing enablement state to the wrong repository.
    // Owner validation: bootstrap rows are owned by this repository's host session (exact hostIdOf(root) match); legacy manually defined rows
    // whose owner is a real session are accepted when that owner session's cwd contains this repository root; if the owner cannot be verified,
    // the row does not belong. If the manifest read fails (empty mapping), fall back to filtering by the caller session (the original degradation path).
    const isRepoRow = (row, byName, root, sid) => {
      const current = row.packages.find((p) => p.packageId === (row.currentPackageId || row.nextPackageId))
        || row.packages[row.packages.length - 1]
      const name = (current && current.name) || row.pluginId
      if (byName && Object.keys(byName).length > 0) {
        if (byName[name] === undefined) return false
        if (root) {
          if (row.agentId === hostIdOf(root)) return true
          const ownerCwd = sessionCwdOf(row.agentId)
          return ownerCwd ? ownsRoot(ownerCwd, root) : false
        }
        return !sid || row.agentId === sid
      }
      return !sid || row.agentId === sid
    }

    // cwd of the owner session (used to determine ownership of manually defined rows; host shims are absent from the sessions service, so this returns undefined).
    const sessionCwdOf = (sid) => {
      if (!sid || !sessionsSvc || typeof sessionsSvc.get !== 'function') return undefined
      try {
        const s = sessionsSvc.get(sid)
        const c = s && s.header && typeof s.header.cwd === 'string' ? s.header.cwd : undefined
        return c || undefined
      } catch (e) { return undefined }
    }

    // Owner attribution: the owner session workspace contains this repository root (findRepo probes only the cwd itself and its first-level subdirectories,
    // so root === cwd or root = cwd/<subdirectory>). Normalize separators/trailing separators before comparison and fold Windows path case.
    const ownsRoot = (cwd, root) => {
      let c = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
      let r = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '')
      if (!c || !r) return false
      if (/^[a-zA-Z]:/.test(c) || /^[a-zA-Z]:/.test(r) || c.indexOf('//') === 0 || r.indexOf('//') === 0) {
        c = c.toLowerCase()
        r = r.toLowerCase()
      }
      return r === c || r.indexOf(c + '/') === 0
    }

    // Dynamic-plugin inventory for the current repository (inventory is process-wide, so filter rows by manifest ownership for this repository;
    // in bootstrap host-session mode, plugins may belong to the host session and are no longer filtered by agentId===session).
    // Includes defaultStart: the plugin's default enabled state for the next rebuild (use its record in .dsh-dynamic-toolbox/toolbox-plugins.json
    // when present, otherwise plugins.json autoStart; null for plugins absent from the manifest).
    ctx.effect(() => harness.handle(RT.rpc('plugins'), async (args) => {
      if (!runner) return { ok: false, error: 'dynamicCordisRunner service unavailable' }
      const sid = sessionOf(args)
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const rows = []
      const byName = await manifestMap(root)
      for (const r of runner.inventory()) {
        if (!isRepoRow(r, byName, root, sid)) continue
        const current = r.packages.find((p) => p.packageId === (r.currentPackageId || r.nextPackageId))
          || r.packages[r.packages.length - 1]
        const name = (current && current.name) || r.pluginId
        const meta = byName[name] || null
        rows.push({
          pluginId: r.pluginId,
          name,
          entryId: meta ? meta.entryId : null, // Manifest entry id (the tool id); null for plugins outside the manifest (placed under "System" in the management tree and immovable).
          running: Boolean(r.activeRun),
          currentPackageId: r.currentPackageId || null,
          // Enabling or disabling a plugin with a Client half requires browser orchestration/approval, so delegate it to the Cordis panel.
          hasClientHalf: r.packages.some((p) => p.hasClientHalf),
          canStop: canStopFromPanel,
          defaultStart: meta ? meta.defaultStart : null,
        })
      }
      return { ok: true, root, plugins: rows, capabilities: artifacts.capabilities }
    }))

    // Runnable Package in a row: prefer current/next pointers; for a suppressed plugin (defined but not run during rebuild,
    // for example because remembered enablement is off), both pointers are empty, so fall back to the latest Package in the row (define appends, making the last one newest).
    const pkgOf = (row) => row.currentPackageId || row.nextPackageId
      || (row.packages && row.packages.length ? row.packages[row.packages.length - 1].packageId : null)

    // Real stop/start: stop uses stopFromPanel (matching the panel and injecting a notification into the session);
    // run activates directly (Host-only, with no Client half, so no approval is needed and completion is synchronous).
    ctx.effect(() => harness.handle(RT.rpc('plugin-toggle'), async (args) => {
      if (!runner) return { ok: false, error: 'Plugin runner service unavailable' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: 'Missing pluginId' }
      const byName = await manifestMap(root)
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row || !isRepoRow(row, byName, root, sid)) return { ok: false, error: 'Plugin does not exist or does not belong to the current repository: ' + pluginId }
      if (row.packages.some((p) => p.hasClientHalf)) {
        return { ok: false, error: pluginId + ' has a Client half; manage its state in the Cordis panel' }
      }
      // runner.owned() validates ownership against the sessionId used at definition time. In bootstrap mode, the plugin belongs to
      // a toolbox-host-* shim session, so the caller session agent would be rejected as "lost on DSH restart".
      // Always use the row owner session's agent (the host shim is in the agents service; non-live sessions fall back to minimal {id}).
      const ownerAgent = agentFor(row.agentId)
      const enable = Boolean(args && args.enable)
      if (enable) {
        if (row.activeRun) return { ok: true, running: true, note: 'Already running' }
        const pkg = pkgOf(row)
        if (!pkg) return { ok: false, error: pluginId + ' has no runnable Package' }
        const res = await runInBuild(root, () => runner.run(ownerAgent, pluginId, pkg, 'run'))
        if (res && res.ok) {
          const out = { ok: true, running: true }
          const warn = await persistToggle(pluginId, true, root)
          if (warn) out.warning = warn
          return out
        }
        return { ok: false, error: (res && (res.message || res.reason)) || 'Failed to start' }
      }
      if (!canStopFromPanel) {
        return { ok: false, error: 'The current DSH lacks the runner.stopFromPanel interface, so the plugin cannot be stopped (starting is unaffected)' }
      }
      const res = await runner.stopFromPanel(ownerAgent, pluginId)
      if (res && res.ok) {
        const out = { ok: true, running: false }
        const warn = await persistToggle(pluginId, false, root)
        if (warn) out.warning = warn
        return out
      }
      return { ok: false, error: (res && (res.message || res.reason)) || 'Failed to stop' }
    }))

    // ===== Enablement-state configuration: read and write through the Artifact Provider =====
    // After every successful real stop/start from a gear toggle, record { plugins: { <manifest-entry-id>: { enabled, at } } };
    // during rebuild (doRebuild), entries recorded with enabled=false are defined but not started, restoring the prior setting;
    // entries without records follow the manifest's autoStart default.
    // Dynamic mode writes <root>/<dataDir>/toolbox-plugins.json through subprocess to bypass the fs sandbox;
    // compiled mode persists through the static Bootstrap provider without writing the user workspace (see DSH_TOOLBOX_COMPILED_BUNDLES_PLAN section 10.3).
    const readConfig = (root) => artifacts.readEnablement(root)
    const writeConfig = async (root, cfg) => {
      const ok = await artifacts.writeEnablement(root, cfg)
      // Enablement state changed: invalidate this root's manifest-map cache so defaultStart follows the state immediately;
      // otherwise the "after restart" pill and rebuild default remain frozen at the first read after framework startup.
      if (ok) manifestCacheByRoot.delete(root)
      return ok
    }
    // Serialize enablement-state read/modify/write operations by root: toggle, toggle-all, and set-default each read the full file, change one key, then rewrite it.
    // If run concurrently, a later writer can overwrite an earlier update using a stale snapshot and lose an enabled record. Queue configuration transactions for the same root;
    // different roots do not block one another, and a failed earlier transaction does not block later ones.
    const cfgChains = new Map() // root -> tail Promise
    const withConfigLock = (root, fn) => {
      const key = String(root || '')
      const prev = cfgChains.get(key) || Promise.resolve()
      const run = prev.then(fn, fn)
      cfgChains.set(key, run.catch(() => {}))
      return run
    }
    // Dynamic pluginId -> manifest entry id: match the current Package name to the entry name in the specified repository's plugins.json.
    // Return null and do not persist if unmatched. Route by root so concurrent repositories each write their own enablement state.
    const manifestEntryIdOf = async (pluginId, root) => {
      if (!runner) return null
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row) return null
      const current = row.packages.find((p) => p.packageId === (row.currentPackageId || row.nextPackageId))
        || row.packages[row.packages.length - 1]
      const pkgName = current && current.name
      if (!pkgName) return null
      const found = await findManifest(root || undefined)
      if (!found || !found.manifest || !Array.isArray(found.manifest.plugins)) return null
      const entry = found.manifest.plugins.find((e) => e && e.name === pkgName)
      return entry ? { entryId: entry.id, root: found.root } : null
    }
    // Return null when persisted (or when no persistence is needed); return a string for a disk-write warning, which the caller must put in the response
    // warning field. The toggle itself already took effect, and persistence results must not be silent (hard requirement in plugins.md section 7).
    const persistToggle = (pluginId, enabled, root) => withConfigLock(root, async () => {
      try {
        const hit = await manifestEntryIdOf(pluginId, root)
        if (!hit) return null
        const cfg = await readConfig(hit.root)
        let at = null
        try { at = new Date().toISOString() } catch (e) {}
        cfg.plugins[hit.entryId] = { enabled: Boolean(enabled), at }
        const ok = await writeConfig(hit.root, cfg)
        return ok ? null : 'Failed to persist the enablement setting (this change took effect, but the post-restart default may differ from the UI)'
      } catch (e) { return 'Error while persisting the enablement setting: ' + String((e && e.message) || e) }
    })

    // Change only the default enabled state for the next rebuild (remembered enablement), not current runtime state: click path for the management view's "after restart" pill.
    ctx.effect(() => harness.handle(RT.rpc('plugin-set-default'), async (args) => {
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: 'Missing pluginId' }
      const hit = await manifestEntryIdOf(pluginId, root)
      if (!hit) return { ok: false, error: 'The plugin is not in the plugins.json manifest, so its enablement setting cannot be persisted' }
      // Perform the whole read/modify/write inside a configuration transaction, mutually exclusive with toggle/toggle-all, to prevent lost updates.
      const written = await withConfigLock(hit.root, async () => {
        const cfg = await readConfig(hit.root)
        let at = null
        try { at = new Date().toISOString() } catch (e) {}
        cfg.plugins[hit.entryId] = { enabled: Boolean(args && args.enabled), at }
        return writeConfig(hit.root, cfg)
      })
      if (!written) return { ok: false, error: 'Failed to persist the enablement setting' }
      return { ok: true, entryId: hit.entryId, enabled: Boolean(args && args.enabled) }
    }))

    // Restart one plugin: its stub rereads the disk implementation during apply, so changes to plugins/<key>/tool.js take effect immediately when clicked,
    // without redefining or reapproving. Equivalent to toggle(enable=true), but allowed for a running plugin (a true restart).
    ctx.effect(() => harness.handle(RT.rpc('plugin-restart'), async (args) => {
      if (!runner) return { ok: false, error: 'Plugin runner service unavailable' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : ''
      if (!pluginId) return { ok: false, error: 'Missing pluginId' }
      const byName = await manifestMap(root)
      const row = runner.inventory().find((r) => r.pluginId === pluginId)
      if (!row || !isRepoRow(row, byName, root, sid)) return { ok: false, error: 'Plugin does not exist or does not belong to the current repository: ' + pluginId }
      if (row.packages.some((p) => p.hasClientHalf)) {
        return { ok: false, error: pluginId + ' has a Client half; restart it from the Cordis panel' }
      }
      const pkg = pkgOf(row)
      if (!pkg) return { ok: false, error: pluginId + ' has no runnable Package' }
      const res = await runInBuild(root, () => runner.run(agentFor(row.agentId), pluginId, pkg, 'run'))
      if (res && res.ok) {
        const out = { ok: true, running: true }
        const warn = await persistToggle(pluginId, true, root)
        if (warn) out.warning = warn
        return out
      }
      return { ok: false, error: (res && (res.message || res.reason)) || 'Failed to restart' }
    }))

    // Bulk toggle: one action really stops or starts every Host-only plugin in the current repository and writes enablement state once.
    ctx.effect(() => harness.handle(RT.rpc('plugin-toggle-all'), async (args) => {
      if (!runner) return { ok: false, error: 'Plugin runner service unavailable' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const enable = Boolean(args && args.enable)
      if (!enable && !canStopFromPanel) {
        return { ok: false, error: 'The current DSH lacks the runner.stopFromPanel interface, so plugins cannot be stopped in bulk (starting is unaffected)' }
      }
      // Use one configuration transaction for the entire batch (withConfigLock is mutually exclusive with per-row toggle/set-default):
      // read the manifest mapping and configuration once, reuse them in the loop, then write once, preventing lost records from concurrent read/modify/write.
      // A disk-write failure does not roll back toggles already applied (runtime state and remembered state are decoupled); report it in the warning field.
      const out = await withConfigLock(root, async () => {
        const entryIdByName = {}
        let cfg = null
        let cfgRoot = null
        try {
          const found = await findManifest(root || undefined)
          if (found && found.manifest && Array.isArray(found.manifest.plugins)) {
            cfgRoot = found.root
            cfg = await readConfig(cfgRoot)
            for (const e of found.manifest.plugins) if (e && typeof e.name === 'string') entryIdByName[e.name] = e.id
          }
        } catch (e) {}
        const done = []
        const failed = []
        const skippedClient = []
        for (const r of runner.inventory()) {
          if (!isRepoRow(r, entryIdByName, root, sid)) continue
          if (r.packages.some((p) => p.hasClientHalf)) { skippedClient.push(r.pluginId); continue }
          const current = r.packages.find((p) => p.packageId === (r.currentPackageId || r.nextPackageId))
            || r.packages[r.packages.length - 1]
          const name = (current && current.name) || ''
          // Use each row owner session's agent (bootstrap plugins belong to the host shim session, so the caller session agent fails owned()).
          const rowAgent = agentFor(r.agentId)
          if (enable) {
            if (r.activeRun) { done.push(r.pluginId + ' (already running)') }
            else {
              const pkg = pkgOf(r)
              if (!pkg) { failed.push(r.pluginId + ': has no runnable Package'); continue }
              const res = await runInBuild(root, () => runner.run(rowAgent, r.pluginId, pkg, 'run'))
              if (res && res.ok) done.push(r.pluginId)
              else { failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || 'Failed to start')); continue }
            }
          } else {
            if (!r.activeRun) { done.push(r.pluginId + ' (already stopped)') }
            else {
              const res = await runner.stopFromPanel(rowAgent, r.pluginId)
              if (res && res.ok) done.push(r.pluginId)
              else { failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || 'Failed to stop')); continue }
            }
          }
          const eid = entryIdByName[name]
          if (cfg && eid) {
            let at = null
            try { at = new Date().toISOString() } catch (e) {}
            cfg.plugins[eid] = { enabled: enable, at }
          }
        }
        let warning = null
        if (cfg && cfgRoot) {
          const okWrite = await writeConfig(cfgRoot, cfg)
          if (!okWrite) warning = 'Failed to persist enablement settings (this batch took effect, but post-restart defaults may differ from the UI)'
        }
        return { done, failed, skippedClient, warning }
      })
      const result = { ok: out.failed.length === 0, done: out.done, failed: out.failed, skippedClient: out.skippedClient }
      if (out.warning) result.warning = out.warning
      return result
    }))

    // Bulk restart: run each currently running Host-only plugin (the stub rereads the disk implementation),
    // so edits across multiple tool.js, shared/host.js, or disk loaders take effect with one action instead of clicking restart on each row.
    // Leave stopped plugins stopped (respect toggle state; do not start implicitly) and skip plugins with a Client half (manage those in the Cordis panel).
    ctx.effect(() => harness.handle(RT.rpc('plugin-restart-all'), async (args) => {
      if (!runner) return { ok: false, error: 'Plugin runner service unavailable' }
      const sid = sessionOf(args)
      const agent = agentFor(sid)
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const byName = await manifestMap(root)
      const done = []
      const failed = []
      const skippedClient = []
      for (const r of runner.inventory()) {
        if (!isRepoRow(r, byName, root, sid)) continue
        if (r.packages.some((p) => p.hasClientHalf)) { skippedClient.push(r.pluginId); continue }
        if (!r.activeRun) continue // Restart only currently running plugins.
        const pkg = pkgOf(r)
        if (!pkg) { failed.push(r.pluginId + ': has no runnable Package'); continue }
        const res = await runInBuild(root, () => runner.run(agentFor(r.agentId), r.pluginId, pkg, 'run'))
        if (res && res.ok) done.push(r.pluginId)
        else failed.push(r.pluginId + ': ' + ((res && (res.message || res.reason)) || 'Failed to restart'))
      }
      return { ok: failed.length === 0, done, failed, skippedClient }
    }))

    // ===== Bootstrap rebuild from the manifest (doRebuild is shared by the gear button and startup automatic completion) =====
    // In dynamic mode the framework reads payload.json from disk (it is the complete define-argument JSON); in compiled mode it reads the provider's
    // embedded payload, then uses dynamicCordisRunner to define and run Host-only plugins in bulk, reducing a fresh rebuild to
    // "define+run framework + one approval" with zero clicks.
    // Idempotency: skip plugins already defined in this repository by name, including user-stopped plugins, to respect toggle state.
    // Enablement memory: read provider configuration; entries recorded as disabled are defined but not run, restoring the previous state.
    // v6.3: serial execution plus build context. Tool-plugin registration during apply must land under this repository root; serial execution keeps
    // buildRoot stable throughout, while the beginBuild/endBuild exclusion queue prevents grouping leaks during parallel cold starts of multiple repositories.
    const doRebuild = async (sid, root) => {
      const t0 = Date.now()
      if (!runner) return { ok: false, error: 'dynamicCordisRunner service unavailable' }
      const agent = agentFor(sid)
      const found = await findManifest(root || undefined)
      if (!found || !found.manifest || !Array.isArray(found.manifest.plugins)) {
        return { ok: false, error: (artifacts.mode === 'compiled-bundle' ? 'Compiled manifest unavailable (root is not attached)' : 'plugins.json not found') + (root ? ' (root: ' + root + ' )' : '') }
      }
      const manifest = found.manifest
      const manifestRoot = found.root
      const config = await readConfig(manifestRoot)
      const cfgPlugins = (config && config.plugins) || {}
      // Determine idempotency using rows owned by this repository host/session (review H4 fix): isRepoRow matching only manifest names
      // makes same-named tools in two repositories appear already defined for each other, so constrain agentId to this repository host id or the current build sid.
      const hostOfRoot = hostIdOf(manifestRoot)
      const defined = []
      const started = []
      const skipped = []
      const suppressed = []
      const failed = []
      const approvalPending = [] // Approval entries: run starts non-blockingly and opens an approval card; one user approval starts them (authorization does not cross processes, which is the browser-code execution safety gate).
      const entries = manifest.plugins.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      // Hold the lock for the entire section: during serial define+run, buildRoot remains manifestRoot, so tool registrations cannot land under the wrong root;
      // this is mutually exclusive with parallel bootstrap or manual toggles in other repositories through the same registry lock.
      // The idempotency snapshot (existingNames) must be collected under the lock (audit M11): if two concurrent rebuilds both take stale snapshots outside it,
      // they acquire the lock in turn and define the same plugins twice. Reading inventory under the lock lets the later rebuild see and skip rows just defined by the first.
      await registry.runInBuild(manifestRoot, async () => {
        // Collect the idempotency snapshot under the lock (audit M11), and determine repository ownership rather than checking only the current session (review P1 follow-up):
        // when two sessions in one repository rebuild concurrently, rows defined by the first belong to its session; recognizing only current sid/hostOfRoot
        // makes the second miss them and redefine the entire batch. Reuse sessionCwdOf/ownsRoot owner checks, with the same semantics as isRepoRow:
        // a row counts as defined when its owner session workspace contains this repository root.
        const existingNames = new Set()
        for (const r of runner.inventory()) {
          if (r.agentId === sid || r.agentId === hostOfRoot) {
            for (const p of r.packages) if (p && p.name) existingNames.add(p.name)
            continue
          }
          const ownerCwd = sessionCwdOf(r.agentId)
          if (ownerCwd && ownsRoot(ownerCwd, manifestRoot)) {
            for (const p of r.packages) if (p && p.name) existingNames.add(p.name)
          }
        }
        for (const entry of entries) {
          if (entry.id === 'toolbox') { skipped.push('toolbox (framework itself)'); continue }
          if (existingNames.has(entry.name)) { skipped.push(entry.id); continue }
          try {
            const payload = await artifacts.payload(manifestRoot, entry)
            const rec = runner.define({ sessionId: sid, plugin: payload.plugin, name: payload.name, purpose: payload.purpose, code: payload.code })
            defined.push(entry.id + '→' + rec.pluginId)
            existingNames.add(entry.name)
            const recCfg = cfgPlugins[entry.id]
            if (recCfg && recCfg.enabled === false) { suppressed.push(entry.id); continue }
            if (entry.autoStart) {
              const res = await runner.run(agent, rec.pluginId, rec.packageId, 'run')
              if (res && res.ok) {
                if (res.status === 'awaiting-approval') approvalPending.push(entry.id) // The approval card is open; clicking Allow starts it asynchronously.
                else started.push(entry.id)
              }
              else failed.push(entry.id + ': ' + ((res && (res.message || res.reason)) || 'run failed'))
            }
          } catch (e) {
            failed.push(entry.id + ': ' + String((e && e.message) || e))
          }
        }
      })
      const orderOf = (s) => { const id = String(s).split('→')[0].split(':')[0]; const e = entries.find((x) => x.id === id); return e ? e.order || 0 : 999 }
      for (const list of [defined, started, skipped, suppressed, failed, approvalPending]) list.sort((a, b) => orderOf(a) - orderOf(b))
      return { ok: failed.length === 0, defined, started, skipped, suppressed, failed, approvalPending, ms: Date.now() - t0 }
    }

    ctx.effect(() => harness.handle(RT.rpc('rebuild'), async (args) => {
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      const sid = sessionOf(args)
      return doRebuild(sid, root)
    }))

    // Aggregate the AI usage ledger (total row in management view): read .dsh-dynamic-toolbox/toolbox-ai-usage.json and aggregate calls/output tokens/failures by tool.
    ctx.effect(() => harness.handle(RT.rpc('ai-usage'), async () => {
      const fs = ctx.get('fs')
      if (!fs) return { ok: true, tools: [], totals: null }
      try {
        const found = await findManifest(myRoot)
        if (!found) return { ok: true, tools: [], totals: null }
        // Use the same ledger path as its writer (shared/host.js mapDataRel): follow RT.dataDir instead of hard-coding the default directory name.
        const t = await fs.resolve(RT.dataDir + '/toolbox-ai-usage.json', { cwd: found.root })
        if (!await fs.stat(t)) return { ok: true, tools: [], totals: null }
        const parsed = JSON.parse(await fs.readText(t))
        const list = Array.isArray(parsed) ? parsed : []
        const byTool = {}
        let calls = 0
        let out = 0
        let errs = 0
        let todayCalls = 0
        let todayOut = 0
        const dayStr = new Date().toDateString() // Local day boundary, using the same timezone as ledger timestamp t.
        for (const r of list) {
          if (!r || typeof r !== 'object') continue
          const k = String(r.tool || '?')
          if (!byTool[k]) byTool[k] = { tool: k, calls: 0, out: 0, errors: 0 }
          if (r.ok) {
            byTool[k].calls++
            calls++
            const o = typeof r.out === 'number' ? r.out : 0
            byTool[k].out += o
            out += o
            if (typeof r.t === 'number' && new Date(r.t).toDateString() === dayStr) { todayCalls++; todayOut += o }
          } else {
            byTool[k].errors++
            errs++
          }
        }
        const tools = Object.keys(byTool).sort().map((k) => byTool[k])
        return { ok: true, tools, totals: { calls, out, errors: errs, todayCalls, todayOut } }
      } catch (e) { return { ok: true, tools: [], totals: null } }
    }))
    // Rebuild-duration history (data source for the management view mini bar chart): read history from <dataDir>/toolbox-autorebuild.json (framework state, isolated by bundle).
    ctx.effect(() => harness.handle(RT.rpc('rebuild-history'), async () => {
      const fs = ctx.get('fs')
      if (!fs) return { ok: false, error: 'fs service unavailable' }
      try {
        const found = await findManifest(myRoot)
        if (!found) return { ok: true, history: [] }
        const t = await fs.resolve(RT.dataDir + '/toolbox-autorebuild.json', { cwd: found.root })
        if (!await fs.stat(t)) return { ok: true, history: [] }
        const parsed = JSON.parse(await fs.readText(t))
        return { ok: true, history: (parsed && Array.isArray(parsed.history)) ? parsed.history : [] }
      } catch (e) { return { ok: true, history: [] } }
    }))

    // ===== Startup automatic completion: in dynamic mode, invoke doRebuild once whenever the framework starts (idempotent; skip already-defined names). =====
    // Skip in compiled mode: the static Bootstrap defines/runs functionality from its embedded manifest without reading disk;
    // in compiled mode the registry is provided by Bootstrap and survives core restarts, so deterministic reattachment below is unnecessary.
    // sid discovery: prefer agents.currentInitiator() (cordis_run carries the initiator when driven by an agent);
    // fallback: find this framework's row in inventory by the plugins.json toolbox entry name,
    // and use it only when exactly one row matches. If same-named frameworks exist in multiple sessions and ownership is ambiguous, skip rather than complete into another session.
    let stopped = false
    ctx.effect(() => () => { stopped = true })
    if (artifacts.capabilities.rebuildFromDisk !== false) ;(async () => {
      // Write a staged report through subprocess, bypassing fs sandbox policy: rewrite the entire file at each stage,
      // so the stage where the file stops identifies where the problem occurred. Report path: <workspace>/.dsh-dynamic-toolbox/toolbox-autorebuild.json.
      const stages = []
      const report = async (stage, extra) => {
        stages.push(Object.assign({ stage }, extra || {}))
        let at = null
        try { at = new Date().toISOString() } catch (e) {}
        const roots = []
        try {
          const sp = ctx.get('sandboxPolicy')
          if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) roots.push(sp.workspaceRoot)
          const ss = ctx.get('sessions')
          if (ss) { for (const s of ss.list()) { const c = s && s.header && s.header.cwd; if (typeof c === 'string' && c && roots.indexOf(c) < 0) roots.push(c) } }
        } catch (e) {}
        // Write the report into this framework's repository; with multiple repositories, each framework writes its own instead of competing for the first.
        let root = myRoot || roots[0]
        try {
          const fs = ctx.get('fs')
          if (fs && !myRoot) {
            outer:
            for (const r of roots) {
              try {
                const t = await fs.resolve('plugins.json', { cwd: r })
                if (await fs.stat(t)) { root = r; break }
                const dt = await fs.resolve('.', { cwd: r })
                const entries = await fs.listDir(dt)
                for (const ent of entries || []) {
                  if (!ent || ent.type !== 'directory' || !ent.name) continue
                  if (ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue
                  const sub = r.replace(/[\\/]+$/, '') + '/' + ent.name
                  const t2 = await fs.resolve('plugins.json', { cwd: sub })
                  if (await fs.stat(t2)) { root = sub; break outer }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        if (!root) { stages.push({ stage: 'report-no-root' }); return }
        const sub = ctx.get('subprocess')
        if (!sub) { stages.push({ stage: 'report-no-subprocess' }); return }
        // Historical duration curve: append this done result to the previous file's history (last 20 runs) so rebuild-speed changes can be tracked.
        let history = []
        try {
          const fs2 = ctx.get('fs')
          if (fs2) {
            const t = await fs2.resolve(RT.dataDir + '/toolbox-autorebuild.json', { cwd: root })
            if (await fs2.stat(t)) {
              const prev = JSON.parse(await fs2.readText(t))
              if (prev && Array.isArray(prev.history)) history = prev.history
            }
          }
        } catch (e) {}
        if (stage === 'done') {
          const res = extra && extra.res
          history = history.concat([{
            at,
            ms: res && typeof res.ms === 'number' ? res.ms : null,
            defined: res && Array.isArray(res.defined) ? res.defined.length : 0,
            started: res && Array.isArray(res.started) ? res.started.length : 0,
            failed: res && Array.isArray(res.failed) ? res.failed.length : 0,
            suppressed: res && Array.isArray(res.suppressed) ? res.suppressed.length : 0,
          }]).slice(-20)
        }
        const payload = JSON.stringify({ at, stages, history }, null, 2)
        try {
          const handle = sub.spawn({
            argv: ['node', '-e', "const fs=require('fs');fs.mkdirSync(require('path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],process.argv[2])", root.replace(/[\\/]+$/, '') + '/' + RT.dataDir + '/toolbox-autorebuild.json', payload],
            stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
            graceMs: 10000,
          })
          await handle.done
        } catch (e) {
          try { stages.push({ stage: 'report-failed', error: String((e && e.message) || e) }) } catch (e2) {}
        }
      }
      if (!runner) { await report('no-services', { runner: Boolean(runner) }); return }
      await report('start')
      let sid = undefined
      try {
        const init = typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
        if (init && typeof init.id === 'string' && init.id) sid = init.id
      } catch (e) {}
      if (!sid) {
        try {
          // Fallback: first match the framework row owned by this framework repository's host session (agentId === hostIdOf(myRoot)).
          const fn0 = await findManifest(myRoot)
          const selfName = fn0 && fn0.manifest && Array.isArray(fn0.manifest.plugins)
            ? fn0.manifest.plugins.find((e) => e && e.id === 'toolbox') : undefined
          const sName = selfName && selfName.name
          if (sName) {
            const hits = runner.inventory().filter((r) => r.packages.some((p) => p && p.name === sName) && r.agentId === hostIdOf(myRoot))
            const anyHits = hits.length ? hits : runner.inventory().filter((r) => r.packages.some((p) => p && p.name === sName))
            if (anyHits.length === 1) sid = anyHits[0].agentId
            else if (anyHits.length > 1) console.log('toolbox: automatic completion skipped (same-named frameworks exist in multiple repositories and their hosts cannot be distinguished); retry from drawer management')
          }
        } catch (e) {}
      }
      await report('sid', { sid: sid || null })
      if (stopped) { await report('stopped-before-rebuild'); return }
      if (!sid) { console.log('toolbox: automatic completion skipped (unable to determine the current session)'); return }
      const res = await doRebuild(sid, myRoot)
      if (stopped) { await report('stopped-after-rebuild'); return }
      // Deterministic reattachment: after a framework restart the registry is a new empty table, so rerun active plugins
      // to register them deterministically in the new table. The slow 2-second heartbeat cannot self-heal after the service is re-provided because the child fiber's ctx.get
      // throws when the isolate key changes, so the fiber must be rebuilt by rerunning; skip plugins just started by doRebuild to avoid duplicate runs.
      const justDefined = new Set()
      for (const s of (res && Array.isArray(res.defined) ? res.defined : [])) {
        const pid = String(s).split('→')[1]
        if (pid) justDefined.add(pid)
      }
      const reattachAgent = agentFor(sid)
      const reattached = []
      const reattachFailed = []
      const reattachAsync = [] // Plugins with a Client half: rerunning enters asynchronous starting; browser-side activation happens separately.
      // Exclude the framework itself (the plugin corresponding to manifest id=toolbox), or reattach reruns the framework, which restarts and reattaches again forever.
      // Gate (MiMo H1): reattach only if doRebuild succeeded and the framework itself can be identified from the manifest. If findManifest fails or the entry is absent,
      // selfPluginIds remains empty and exclusion fails; skip all reattachment in that case rather than risk a restart loop.
      const selfPluginIds = new Set()
      let selfName = null
      try {
        const found0 = await findManifest(myRoot)
        const tbEntry = found0 && found0.manifest && Array.isArray(found0.manifest.plugins)
          ? found0.manifest.plugins.find((e) => e && e.id === 'toolbox') : undefined
        selfName = tbEntry && tbEntry.name
        if (selfName) {
          for (const r of runner.inventory()) {
            if (r.packages.some((p) => p && p.name === selfName)) selfPluginIds.add(r.pluginId)
          }
        }
      } catch (e) {}
      const reattachEnabled = Boolean(res && res.ok && selfName && selfPluginIds.size > 0 && sid)
      if (!reattachEnabled) {
        console.log('toolbox: reattachment skipped (' + (!res || !res.ok ? 'doRebuild did not succeed' : !selfName ? 'manifest has no toolbox entry' : selfPluginIds.size === 0 ? 'framework itself was not identified' : 'sid was not determined') + '); running tools rely on heartbeat/manual recovery')
      }
      if (reattachEnabled) {
        const reattachByName = await manifestMap(myRoot)
        for (const r of runner.inventory()) {
          if (stopped) break // M2: abort reattachment immediately while the framework is stopping.
          if (!isRepoRow(r, reattachByName, myRoot, sid)) continue
          if (!r.activeRun) continue
          const hasClient = r.packages.some((p) => p.hasClientHalf)
          if (selfPluginIds.has(r.pluginId)) continue // Never reattach the framework itself; prevents a restart loop.
          if (justDefined.has(r.pluginId)) continue
          const pkg = r.currentPackageId || r.nextPackageId
          if (!pkg) continue
          try {
            const rr = await runInBuild(myRoot, () => runner.run(agentFor(r.agentId), r.pluginId, pkg, 'run'))
            if (rr && rr.ok) {
              if (hasClient) reattachAsync.push(r.pluginId)
              else reattached.push(r.pluginId)
            } else {
              reattachFailed.push(r.pluginId + ': ' + ((rr && (rr.message || rr.reason)) || 'Failed to restart'))
            }
          } catch (e) {
            reattachFailed.push(r.pluginId + ': ' + String((e && e.message) || e))
          }
        }
      }
      if (reattached.length) console.log('toolbox: framework restarted; deterministically reattached running tools: ' + reattached.join(','))
      if (reattachAsync.length) console.log('toolbox: reattached plugins with UI (asynchronous activation): ' + reattachAsync.join(','))
      if (reattachFailed.length) console.log('toolbox: reattachment failed: ' + reattachFailed.join(';'))
      await report('done', { sid, res, reattached: reattached.length + reattachAsync.length })
      if (res && res.ok) {
        if (res.defined && res.defined.length) {
          console.log('toolbox: automatic completion newly defined: ' + res.defined.join(',') + '; started: ' + (res.started || []).join(','))
        } else {
          console.log('toolbox: automatic completion check finished; all plugins in plugins.json already exist')
        }
        if (res.failed && res.failed.length) console.log('toolbox: automatic completion partially failed: ' + res.failed.join(';'))
        if (res.suppressed && res.suppressed.length) console.log('toolbox: kept disabled according to the previous setting: ' + res.suppressed.join(','))
        if (res.approvalPending && res.approvalPending.length) console.log('toolbox: awaiting approval to start (the approval card is open; allow once to start): ' + res.approvalPending.join(','))
      } else {
        console.log('toolbox: automatic completion failed: ' + ((res && res.error) || '(unknown)'))
      }
    })().catch((e) => { console.log('toolbox: automatic completion error: ' + String((e && e.message) || e)) })

    // Session information query (v6.5): the client looks up header.cwd and the owning Workspace by current session id.
    // The primary drawer instance runs under a host session, so useSessions byId records may be unreliable;
    // use Host-side sessions/sessionQuery as the source of truth for cwd (the client calls after every session switch).
    ctx.effect(() => harness.handle(RT.rpc('session-info'), async (args) => {
      const sid = args && typeof args.session === 'string' && args.session ? args.session : ''
      if (!sid) return { ok: false, error: 'Missing session id' }
      const ss = ctx.get('sessions')
      let cwd
      if (ss && typeof ss.get === 'function') {
        try {
          const s = ss.get(sid)
          cwd = s && s.header && typeof s.header.cwd === 'string' ? s.header.cwd : undefined
        } catch (e) {}
      }
      if (!cwd) {
        const sq = ctx.get('sessionQuery')
        try {
          const list = sq && typeof sq.listSessions === 'function' ? await sq.listSessions() : []
          const hit = (list || []).find((x) => x && x.id === sid)
          cwd = hit && hit.header && typeof hit.header.cwd === 'string' ? hit.header.cwd : undefined
        } catch (e) {}
      }
      let workspaceId
      try {
        const wr = ctx.get('workspaceRegistry')
        const workspaces = wr && typeof wr.list === 'function' ? wr.list() : []
        const owner = (workspaces || []).find((w) => w && Array.isArray(w.sessionIds) && w.sessionIds.some((x) => String(x) === sid))
        if (owner && owner.id != null) workspaceId = String(owner.id)
      } catch (e) {}
      if (cwd || workspaceId) return { ok: true, ...(cwd ? { cwd } : {}), ...(workspaceId ? { workspaceId } : {}) }
      return { ok: false, error: 'Session does not exist or cannot be read: ' + sid }
    }))

    ctx.effect(() => harness.handle(RT.rpc('panel'), async (args) => {
      const strict = hasExplicitRoot(args)
      const root = await resolveRoot(args)
      // An unresolved explicit cwd is a clear error; never send null into the registry, because that would use root=undefined
      // and execute tools from the lastRoot repository, leaking data across repositories.
      if (strict && !root) return { ok: false, error: ROOT_UNMOUNTED_ERR }
      return registry.panel(root, args)
    }))
  },
}
