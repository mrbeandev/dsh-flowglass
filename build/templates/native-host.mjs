// ===== build/templates/native-host.mjs: native DSH Host plugin entry point =====
// Does not use dynamicCordisRunner; selected feature sources are wrapped in plain functions at build time and mounted directly by the static Loader.

export const renderNativeHost = ({
  packageName, profile, runtimeSource, sharedHostSource, hostFeatures, inject, bridgeMethods, hasModelTools, exposeBridge = false,
}) => {
  const factories = hostFeatures.map(({ key, source }) => {
    const id = key.replace(/[^A-Za-z0-9_$]/g, '_')
    return `const create_${id} = () => {\n${source}\n}`
  }).join('\n\n')
  const factoryCalls = hostFeatures.map(({ key }) => 'create_' + key.replace(/[^A-Za-z0-9_$]/g, '_') + '()').join(', ')

  const bridgeRemoteMethods = bridgeMethods.map(({ rpc, method }) => `
  ${method}(request) {
    return callNativeBridge(${JSON.stringify(rpc)}, request || {})
  }`).join('')
  const exposedMethods = ['tools', 'panel', 'plugins', 'sessionInfo'].concat(bridgeMethods.map(({ method }) => method))
  const bridgeRuntime = exposeBridge ? `const nativeBridgeHandlers = new Map()
const nativeBridge = {
  register(name, handler) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return () => {}
    nativeBridgeHandlers.set(name, handler)
    return () => { if (nativeBridgeHandlers.get(name) === handler) nativeBridgeHandlers.delete(name) }
  },
  async call(name, request) {
    const handler = nativeBridgeHandlers.get(name)
    if (!handler) return { ok: false, error: 'Native RPC is not registered: ' + name }
    return await handler(request)
  },
}
const callNativeBridge = async (name, request) => {
  return await nativeBridge.call(name, request)
}` : `const nativeBridgeHandlers = new Map()
const callNativeBridge = async (name, request) => {
  const handler = nativeBridgeHandlers.get(name)
  if (!handler) return { ok: false, error: 'Native RPC is not registered: ' + name }
  return await handler(request)
}`
  const bridgeHandle = exposeBridge
    ? 'return nativeBridge.register(name, handler)'
    : `if (typeof name !== 'string' || !name || typeof handler !== 'function') return () => {}
    nativeBridgeHandlers.set(name, handler)
    return () => { if (nativeBridgeHandlers.get(name) === handler) nativeBridgeHandlers.delete(name) }`
  const bridgeProvide = exposeBridge ? '\n  ctx.provide(TOOLBOX_RUNTIME.bridgeService, nativeBridge)' : ''

  return `// ===== ${profile.displayName} · native static DSH Host (generated at build time; do not edit manually) =====
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
${hasModelTools ? "import { defineTool } from '@deepseek-ai/dsh-tools'" : ''}

export const name = ${JSON.stringify(packageName)}
export const inject = ${JSON.stringify(inject)}

const TOOLBOX_RUNTIME_OVERRIDES = ${JSON.stringify(profile, null, 2)}
${runtimeSource}

// Static registry: each feature is mounted once; handlers receive the current root/session on every call and work with any workspace.
const makeStaticRegistry = () => {
  const entries = new Map()
  return {
    register(desc, handler) {
      if (!desc || typeof desc.id !== 'string' || !desc.id || typeof handler !== 'function') return () => {}
      const entry = { id: desc.id, label: desc.label || desc.id, order: typeof desc.order === 'number' ? desc.order : 0, icon: desc.icon || null, handler }
      entries.set(desc.id, entry)
      return () => { if (entries.get(desc.id) === entry) entries.delete(desc.id) }
    },
    tools() {
      return [...entries.values()].sort((a, b) => a.order - b.order).map((x) => ({ id: x.id, label: x.label, order: x.order, icon: x.icon || null }))
    },
    async panel(root, call) {
      const toolId = call && typeof call.tool === 'string' ? call.tool : ''
      const entry = entries.get(toolId)
      if (!entry) return { ok: false, error: 'Tool is not registered: ' + (toolId || '(empty)') }
      try {
        const res = await entry.handler({
          action: call && typeof call.action === 'string' ? call.action : '',
          fields: call && call.fields && typeof call.fields === 'object' ? call.fields : {},
          state: call && call.state || null,
          root: typeof root === 'string' && root ? root : undefined,
          session: call && typeof call.session === 'string' && call.session ? call.session : undefined,
        })
        if (!res || typeof res.html !== 'string') return { ok: false, error: 'Tool returned invalid panel content' }
        const out = { ok: true, html: res.html, state: res.state == null ? null : res.state }
        if (typeof res.copy === 'string' && res.copy) out.copy = res.copy
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
      } catch (error) { return { ok: false, error: String(error && error.message || error) } }
    },
  }
}

${sharedHostSource}

// Compatibility seam for features shared with dynamic mode. In a static
// bundle harness.handle is backed by native Remote methods, while model tools
// are registered directly against DSH's tools service.
${bridgeRuntime}
const harness = {
  handle(name, handler) {
    ${bridgeHandle}
  },
  ${hasModelTools ? `defineTool,
  registerTool(ctx, tool) {
    const service = ctx.get('tools')
    if (!service || typeof service.register !== 'function') throw new Error('tools service is unavailable')
    const dispose = service.register(tool)
    if (typeof dispose === 'function') ctx.effect(() => dispose)
    return dispose
  },` : `defineTool(tool) { return tool },
  registerTool() { throw new Error('The current static bundle does not enable the model tools service') },`}
}

${factories}

// Remote uses standard decorator runtime markers; generated code is plain JS, so run the decorator initializer explicitly.
const exposeRemote = (klass, method, exportName) => {
  const initializers = []
  Remote(exportName || method)(klass.prototype[method], {
    private: false, static: false, name: method,
    addInitializer(fn) { initializers.push(fn) },
  })
  const marker = Object.create(klass.prototype)
  for (const init of initializers) init.call(marker)
}

class NativeToolboxRemote extends TypertRemoteService {
  constructor(ctx, registry) {
    super(ctx, ${JSON.stringify(profile.remoteService)}, { namespace: ${JSON.stringify(profile.remoteNamespace)} })
    this.registry = registry
  }
  tools(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return { ok: true, root: root || null, tools: this.registry.tools() }
  }
  panel(request) {
    const root = request && typeof request.root === 'string' ? request.root : undefined
    return this.registry.panel(root, request || {})
  }
  plugins(request) {
    void request
    return { ok: true, plugins: [], capabilities: TOOLBOX_RUNTIME.capabilities }
  }
  async sessionInfo(request) {
    const sid = request && typeof request.session === 'string' ? request.session : ''
    if (!sid) return { ok: false, error: 'Missing session id' }
    const sessions = this.ctx.get('sessions')
    if (sessions && typeof sessions.get === 'function') {
      try {
        const session = sessions.get(sid)
        const cwd = session && session.header && session.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    const query = this.ctx.get('sessionQuery')
    if (query && typeof query.listSessions === 'function') {
      try {
        const rows = await query.listSessions()
        const hit = (rows || []).find((row) => row && row.id === sid)
        const cwd = hit && hit.header && hit.header.cwd
        if (typeof cwd === 'string' && cwd) return { ok: true, cwd }
      } catch (error) {}
    }
    return { ok: false, error: 'Session does not exist or is unreadable: ' + sid }
  }${bridgeRemoteMethods}
}
for (const method of ${JSON.stringify(exposedMethods)}) exposeRemote(NativeToolboxRemote, method)

export async function apply(ctx) {
  const registry = makeStaticRegistry()
  ctx.provide(TOOLBOX_RUNTIME.registryService, registry)${bridgeProvide}
  const features = [${factoryCalls}]
  for (const feature of features) {
    if (!feature || typeof feature.apply !== 'function') throw new Error('Static feature did not return a valid plugin object')
    const disposer = await feature.apply(ctx)
    if (typeof disposer === 'function') ctx.effect(() => disposer)
  }
  new NativeToolboxRemote(ctx, registry)
  console.log(TOOLBOX_RUNTIME.logTag() + ' Flowglass Host loaded (features: ' + registry.tools().map((x) => x.id).join(', ') + ')')
}
`
}
