// ===== build/templates/cordis.patch.yml.mjs: DSH bundle patch template =====
// Row IDs derive from the bundle ID (rather than all using toolbox-bootstrap). The name is the package name:
// after the bundle is installed in the profile's node_modules, Node's parent lookup resolves the bare package
// name from the configuration directory to the package itself (exports "." -> lib/index.js).
export const renderCordisPatch = ({ bundleId, packageName, componentRows = [] }) => `# ${packageName} - native static Host/Client ${bundleId === 'flowglass-en' ? 'Flowglass' : 'toolbox'} patch layer
- insert:
    - id: toolbox-bundle-${bundleId}
      name: '${packageName}'
${componentRows.map((row) => `    - id: toolbox-bundle-${bundleId}-${row.key}
      name: '${packageName}/feature/${row.key}'`).join('\n')}${componentRows.length ? '\n' : ''}`
