// ===== shared/registry.js: shared tool registry implementation (single source of truth) =====
// The same source is used in three places:
//   1. Dynamic mode: concatenated into the toolbox framework Host payload (IMPL_FILES; see build/payload-builder.mjs).
//   2. Compiled mode: static Bootstrap embeds the same source through the compiler and provides a namespaced registry Service.
//   3. host-bootstrap/index.js retains a synchronized copy (static plugins cannot read repository files; contract changes must be synchronized on both sides).
// Contract: attach/detach/register/runInBuild/tools/panel/has/roots/clear.
// State lives in the returned object's closure (shared across fibers): root -> tool table.
// Tool registration belongs to the "current build root"; build uses locking runInBuild(root, fn), holding the lock for the entire asynchronous section.
// Within the section (register calls from tool plugin apply), buildRoot remains stable, so parallel cold starts across repositories/bundles never mix tables.
const makeToolboxRegistry = () => {
  const tables = new Map() // root -> Map<id, entry>
  let buildRoot = null
  let lastRoot = null
  let lock = Promise.resolve()
  const tableOf = (root) => {
    if (!root) return null
    let t = tables.get(root)
    if (!t) { t = new Map(); tables.set(root, t) }
    return t
  }
  const register = (desc, handler) => {
    if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
    const t = tableOf(buildRoot || lastRoot)
    if (!t) return () => {}
    const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, icon: desc.icon || null, handler }
    t.set(desc.id, entry)
    // The disposer removes only the entry it registered: if a later registration replaces the same ID, the old disposer must not remove the new entry.
    return () => { if (t.get(desc.id) === entry) t.delete(desc.id) }
  }
  return {
    attach(root) { if (!root) return; lastRoot = root; tableOf(root) },
    detach(root) { if (root) tables.delete(root) },
    register,
    // Mutually exclusive build section: await the previous section -> buildRoot=root -> execute fn (every register in the section belongs to
    // root) -> finally clear buildRoot and release the lock. The lock lives on the service object and covers all roots.
    async runInBuild(root, fn) {
      const prev = lock
      let r
      lock = new Promise((res) => { r = res })
      await prev
      buildRoot = root || null
      try { return await fn() } finally { buildRoot = null; r() }
    },
    tools(root) {
      const t = tables.get(root || lastRoot) || new Map()
      return [...t.values()].sort((a, b) => a.order - b.order)
        .map((x) => ({ id: x.id, label: x.label, order: x.order, icon: x.icon || null }))
    },
    async panel(root, call) {
      const t = tables.get(root || lastRoot)
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = t && t.get(toolId)
      if (!entry || !entry.handler) return { ok: false, error: 'Tool is not registered or has stopped: ' + (toolId || '(empty)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: (call && call.fields && typeof call.fields === 'object') ? call.fields : {},
          state: (call && call.state) || null,
          root: (typeof root === 'string' && root) ? root : undefined,
          session: (call && typeof call.session === 'string' && call.session) ? call.session : undefined,
          // Live overlay (Flowglass live stream): pass the Client event-window snapshot to the tool handler; validate its shape on the Host side.
          live: (call && call.live && typeof call.live === 'object') ? call.live : undefined,
        })
        // panel always validates that the handler returns an HTML string.
        if (!res || typeof res.html !== 'string') return { ok: false, error: 'The tool returned invalid panel content' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
        // Flowglass subagent following: one-time Client navigation instruction. Pass through only narrowed scalar values
        // to avoid carrying arbitrary objects from the tool handler across the Host-to-Client boundary.
        if (res.navigateSession && typeof res.navigateSession === 'object' && typeof res.navigateSession.sessionId === 'string') {
          out.navigateSession = {
            sessionId: res.navigateSession.sessionId,
            ...(typeof res.navigateSession.parentSessionId === 'string' ? { parentSessionId: res.navigateSession.parentSessionId } : {}),
            ...(res.navigateSession.kind === 'subagent' || res.navigateSession.kind === 'session' ? { kind: res.navigateSession.kind } : {}),
          }
        }
        if (res.flowContext && typeof res.flowContext === 'object' && typeof res.flowContext.text === 'string') {
          out.flowContext = {
            text: res.flowContext.text,
            ...(typeof res.flowContext.sourceSessionId === 'string' ? { sourceSessionId: res.flowContext.sourceSessionId } : {}),
            ...(Array.isArray(res.flowContext.seqs) ? { seqs: res.flowContext.seqs.filter((v) => typeof v === 'number') } : {}),
          }
        }
        return out
      } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    },
    has(root) { return root ? tables.has(root) : false },
    roots() { return [...tables.keys()] },
    clear() { tables.clear(); buildRoot = null; lastRoot = null },
  }
}
