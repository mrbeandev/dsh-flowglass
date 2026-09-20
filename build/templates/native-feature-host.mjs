// ===== Native DSH Host feature sub-entry point =====
// Used only by component-split static toolboxes: each Loader row has an independent Fiber, and disabling it unmounts the corresponding tool.

export const renderNativeFeatureHost = ({
  packageName, profile, feature, runtimeSource, sharedHostSource, bridgeMethods, hasModelTools,
}) => {
  const id = feature.key.replace(/[^A-Za-z0-9_$]/g, '_')
  const inject = [...new Set([
    ...(feature.inject || []),
    profile.registryService,
    ...(bridgeMethods.length ? [profile.bridgeService] : []),
    ...(hasModelTools ? ['tools'] : []),
  ])]
  return `// ===== ${profile.displayName} · ${feature.key} native static Host component (generated at build time; do not edit manually) =====
${hasModelTools ? "import { defineTool } from '@deepseek-ai/dsh-tools'" : ''}

export const name = ${JSON.stringify(packageName + '/feature/' + feature.key)}
export const inject = ${JSON.stringify(inject)}

const TOOLBOX_RUNTIME_OVERRIDES = ${JSON.stringify(profile, null, 2)}
${runtimeSource}
${sharedHostSource}

let applyingContext = null
const harness = {
  handle(name, handler) {
    const bridge = applyingContext && applyingContext.get(TOOLBOX_RUNTIME.bridgeService)
    if (!bridge || typeof bridge.register !== 'function') throw new Error('Static toolbox Bridge service is unavailable')
    return bridge.register(name, handler)
  },
  ${hasModelTools ? `defineTool,
  registerTool(ctx, tool) {
    const service = ctx.get('tools')
    if (!service || typeof service.register !== 'function') throw new Error('tools service is unavailable')
    const dispose = service.register(tool)
    if (typeof dispose === 'function') ctx.effect(() => dispose)
    return dispose
  },` : `defineTool(tool) { return tool },
  registerTool() { throw new Error('The current static component does not enable the model tools service') },`}
}

const create_${id} = () => {
${feature.source}
}

export async function apply(ctx) {
  applyingContext = ctx
  try {
    const feature = create_${id}()
    if (!feature || typeof feature.apply !== 'function') throw new Error('Static feature did not return a valid plugin object')
    const disposer = await feature.apply(ctx)
    if (typeof disposer === 'function') ctx.effect(() => disposer)
    console.log(TOOLBOX_RUNTIME.logTag() + ' Native static component loaded: ${feature.key}')
  } finally {
    applyingContext = null
  }
}
`
}
