// Native static DSH toolbox Remote description (generated at build time; do not edit manually)
// The toolbox protocol itself performs structural validation in Host registry.panel; Remote payloads are generic JSON-safe objects.
const json = Object.freeze({ parse(value) { return value } })
const descriptor = (method, implementation) => ({
  id: "dsh-flowglass-en/remote" + '#' + "toolboxNativeFlowglassEn" + '/' + method,
  service: "toolboxNativeFlowglassEn",
  namespace: "toolboxNativeFlowglassEn",
  method,
  ...(implementation && implementation !== method ? { implementation } : {}),
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request', wire: 'request', source: 'json',
    codec: { mode: 'strict', typeSymbol: "dsh-flowglass-en#JsonRequest", schema: json, create: () => json },
  }],
  result: { mode: 'strict', typeSymbol: "dsh-flowglass-en#JsonResult", schema: json, create: () => json },
})

export default Object.freeze({
  package: "dsh-flowglass-en",
  descriptors: Object.freeze([
    descriptor('tools'),
    descriptor('panel'),
    descriptor('plugins'),
    descriptor('sessionInfo'),

  ]),
})
