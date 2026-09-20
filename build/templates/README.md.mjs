// ===== build/templates/README.md.mjs: generated package README template =====
export const renderReadme = ({ packageName, version, bundleId, displayName, featureLines, isFlowglass }) => {
  const positioning = isFlowglass
    ? 'This is the default product and build target of the dsh-flowglass repository. It is a **native static DSH Host/Client plugin**.'
    : 'This is an **optional toolbox product** from the dsh-flowglass repository, independent of the default Flowglass package. If you only need the session flow visualization, install `dsh-flowglass-en`. Install this package only when you need the complete tool set listed below.\n\nThis package is a native static DSH Host/Client plugin.'
  const flowglassPresentation = isFlowglass
    ? '\n- Configure Flowglass through Harness sidebar **Plugins** → `flowglass-en` using the official `plugins.bundle.config` interface. Settings cover persistent expansion across session switches, large graphs, default branch/view, polling, and display rules; controls reuse the official UI primitives. Six default rules for Git, GitHub CLI, pnpm, npm, DSH, and Python ship with the package. User settings remain in the browser.\n'
    : ''
  return `# ${displayName} (${packageName})

${positioning}

- bundleId: \`${bundleId}\`
- Version: ${version}
- Dynamic approval: **not required** (does not use dynamicCordisRunner or generate dyn/*)
- Features:
${featureLines}
${flowglassPresentation}

## Install, upgrade, or remove

\`\`\`powershell
npm pack
dsh plugin --profile web add <tgz>
# Or install directly after publication to the npm registry:
dsh plugin --profile web add ${packageName}
# Restart DSH; the native Loader then mounts the Host and Client directly.
dsh plugin --profile web remove ${packageName}
\`\`\`

To upgrade, increment the version, rebuild and publish, then run add for the new version and restart DSH.

## Runtime structure

- \`lib/index.js\`: native Host plugin;
- \`lib/client.js\`: loaded natively through package.json \`dsh.client\` and \`exports["./client"]\`;
- \`lib/remote.js\`: Host/Client Remote description;
- does not read loader.js, plugins.json, or payload.json from the source repository;
- does not call dynamicCordisRunner;
- tool-specific business data remains under \`.dsh-dynamic-toolbox/\` in the current workspace.
`
}
