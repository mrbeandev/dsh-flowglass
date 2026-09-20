// ===== build/templates/native-client.mjs: DSH script-loader Client bundle =====
// Native DSH Client files are not browser ESM; they must be preregistered with window.__ModuleLoader__.
export const renderNativeClient = ({
  packageName, profile, runtimeSource, toolboxClientSource, clientFeatures, bridgeMethods,
}) => {
  const factories = clientFeatures.map(({ key, source }) => {
    const id = key.replace(/[^A-Za-z0-9_$]/g, '_')
    return `const create_${id} = () => {\n${source}\n}`
  }).join('\n\n')
  const calls = clientFeatures.map(({ key }) => 'create_' + key.replace(/[^A-Za-z0-9_$]/g, '_') + '()').join(', ')
  const descriptorId = packageName + '/remote#' + profile.remoteNamespace + '/'
  const remoteMethodNames = ['tools', 'panel', 'plugins', 'sessionInfo'].concat(bridgeMethods.map(({ method }) => method))
  const bridgeMappings = bridgeMethods.map(({ rpc, method }) => `
        [${JSON.stringify(rpc)}]: (args) => remote.${method}(args || {}),`).join('')
  // The primary Flowglass package enhances assistant detail rails with the
  // Harness-native renderer. Other toolbox bundles retain their dependency-free
  // HTML panel fallback and never load these modules.
  const markdownRuntime = profile.bundleId === 'flowglass-en'
    ? `    const { MarkdownText: TOOLBOX_MARKDOWN_TEXT, Button: TOOLBOX_BUTTON, Switch: TOOLBOX_SWITCH, Input: TOOLBOX_INPUT } = require('@deepseek-ai/dsh-client-ui-primitives')
    const TOOLBOX_UI_PRIMITIVES = Object.freeze({ Button: TOOLBOX_BUTTON, Switch: TOOLBOX_SWITCH, Input: TOOLBOX_INPUT })
    const { createPortal: TOOLBOX_CREATE_PORTAL } = require('react-dom')`
    : `    const TOOLBOX_MARKDOWN_TEXT = null
    const TOOLBOX_UI_PRIMITIVES = null
    const TOOLBOX_CREATE_PORTAL = null`
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageName)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
${markdownRuntime}
    const name = ${JSON.stringify(packageName + '/client')}
    const inject = ['slots', 'remote', 'timer', 'sessions']

    const TOOLBOX_RUNTIME_OVERRIDES = ${JSON.stringify(profile, null, 2)}
${runtimeSource}

    const json = Object.freeze({ parse(value) { return value } })
    const descriptor = (method) => ({
      id: ${JSON.stringify(descriptorId)} + method,
      service: ${JSON.stringify(profile.remoteService)},
      namespace: ${JSON.stringify(profile.remoteNamespace)},
      method,
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request', wire: 'request', source: 'json',
        codec: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonRequest')}, schema: json, create: () => json },
      }],
      result: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonResult')}, schema: json, create: () => json },
    })
    const remoteContribution = Object.freeze({
      package: ${JSON.stringify(packageName)},
      descriptors: Object.freeze(${JSON.stringify(remoteMethodNames)}.map(descriptor)),
    })

    const styleDisposers = new Set()
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return () => {}
        const node = document.createElement('style')
        node.setAttribute('data-dsh-toolbox-style', TOOLBOX_RUNTIME.bundleId)
        node.textContent = String(css || '')
        ;(document.head || document.body || document.documentElement).appendChild(node)
        let active = true
        const dispose = () => { if (active) { active = false; styleDisposers.delete(dispose); node.remove() } }
        styleDisposers.add(dispose)
        return dispose
      },
    }
    const unwrap = async (promise) => {
      const answered = await promise
      if (!answered || answered.ok !== true) {
        const error = answered && answered.error
        throw new Error(error ? String(error.code || 'remote') + ': ' + String(error.message || error) : 'Remote call failed')
      }
      return answered.value
    }
    // The toolbox/client.js factory is created at module scope, and its React effects run after apply;
    // The Host facade must be in the same lexical closure, while apply only assigns it after Remote is mounted.
    let host = null

    const createToolboxClient = () => {
${toolboxClientSource}
    }

${factories}

    async function apply(ctx) {
      try {
      const disposeRemote = await ctx.remote.$mount(remoteContribution)
      ctx.effect(() => () => { void disposeRemote() })
      ctx.effect(() => () => { for (const dispose of [...styleDisposers]) dispose() })
      const remote = ctx.get('remote.' + ${JSON.stringify(profile.remoteNamespace)})
      if (!remote) throw new Error('Static toolbox Remote namespace is not mounted: ' + ${JSON.stringify(profile.remoteNamespace)})
      const methods = {
        [TOOLBOX_RUNTIME.rpc('tools')]: (args) => remote.tools(args || {}),
        [TOOLBOX_RUNTIME.rpc('panel')]: (args) => remote.panel(args || {}),
        [TOOLBOX_RUNTIME.rpc('plugins')]: (args) => remote.plugins(args || {}),
        [TOOLBOX_RUNTIME.rpc('session-info')]: (args) => remote.sessionInfo(args || {}),
${bridgeMappings}
      }
      host = {
        call(methodName, args) {
          const method = methods[methodName]
          if (!method) return Promise.resolve({ ok: false, error: 'The native static bundle does not support management actions: ' + methodName })
          return unwrap(method(args))
        },
      }
      const plugins = [createToolboxClient(), ${calls}].filter(Boolean)
      for (const plugin of plugins) {
        if (!plugin || typeof plugin.apply !== 'function') throw new Error('Static Client feature did not return a valid plugin object')
        const disposer = await plugin.apply(ctx)
        if (typeof disposer === 'function') ctx.effect(() => disposer)
      }
      console.log(TOOLBOX_RUNTIME.logTag() + ' Native static Client loaded (no dynamic approval)')
      } catch (error) {
        console.error(TOOLBOX_RUNTIME.logTag() + ' Native static Client failed to load', error)
        throw error
      }
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
`
}
