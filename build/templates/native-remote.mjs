// ===== build/templates/native-remote.mjs: native Client Remote contribution =====
export const renderNativeRemote = ({ packageName, profile, bridgeMethods }) => `// Native static DSH toolbox Remote description (generated at build time; do not edit manually)
// The toolbox protocol itself performs structural validation in Host registry.panel; Remote payloads are generic JSON-safe objects.
const json = Object.freeze({ parse(value) { return value } })
const descriptor = (method, implementation) => ({
  id: ${JSON.stringify(packageName + '/remote')} + '#' + ${JSON.stringify(profile.remoteNamespace)} + '/' + method,
  service: ${JSON.stringify(profile.remoteService)},
  namespace: ${JSON.stringify(profile.remoteNamespace)},
  method,
  ...(implementation && implementation !== method ? { implementation } : {}),
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request', wire: 'request', source: 'json',
    codec: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonRequest')}, schema: json, create: () => json },
  }],
  result: { mode: 'strict', typeSymbol: ${JSON.stringify(packageName + '#JsonResult')}, schema: json, create: () => json },
})

export default Object.freeze({
  package: ${JSON.stringify(packageName)},
  descriptors: Object.freeze([
    descriptor('tools'),
    descriptor('panel'),
    descriptor('plugins'),
    descriptor('sessionInfo'),
${bridgeMethods.map(({ method }) => `    descriptor(${JSON.stringify(method)}),`).join('\n')}
  ]),
})
`
