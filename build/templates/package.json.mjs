// ===== build/templates/package.json.mjs: native DSH Host/Client package manifest =====
export const renderPackageJson = ({ packageName, version, description, bundleId, repositoryDirectory, hasModelTools, featureExports = [] }) => JSON.stringify({
  name: packageName,
  version,
  description,
  type: 'module',
  main: './lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './remote': './lib/remote.js',
    ...Object.fromEntries(featureExports.map((key) => ['./feature/' + key, './lib/features/' + key + '.js'])),
    './package.json': './package.json',
  },
  repository: {
    type: 'git',
    url: 'https://github.com/mrbeandev/dsh-flowglass.git',
    ...(repositoryDirectory ? { directory: repositoryDirectory } : {}),
  },
  license: 'MIT',
  author: 'mrbeandev',
  keywords: [...new Set(['deepseek-harness', 'dsh', 'plugin', 'toolbox'].concat(bundleId ? [bundleId] : []))],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      platform: 'web',
      // inject declares informational package dependency edges for boot-graph prefetching and HMR diffs:
      //   ui-session / api-session-controller provide ctx.sessions and event windows (binding().eventSource);
      //   ui-sidebar-right provides ctx.sidebarRightTabs / ctx.sidebarRight and the sidebar.right.pane.tab slot;
      //   ui-layout / ui-sidebar provide fallbacks for shell.overlay and navigation injection.
      inject: bundleId === 'flowglass-en' || bundleId === 'dynamic-toolbox' ? [
        '@deepseek-ai/dsh-client-ui-session',
        '@deepseek-ai/dsh-api-session-controller',
        '@deepseek-ai/dsh-api-workspace-controller',
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-ui-workspace',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-sidebar-right',
      ] : [
        '@deepseek-ai/dsh-client-ui-session',
        '@deepseek-ai/dsh-api-session-controller',
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
      ],
    },
  },
  files: ['lib/**', 'manifest.json', 'BUILDINFO.json', 'cordis.patch.yml', 'README.md', 'LICENSE'],
  engines: { node: '>=22.19' },
  peerDependencies: {
    // Host-side lib/index.js imports this protocol package directly (TypertRemoteService/Remote).
    // The host Harness supplies the implementation; this package only declares the relationship.
    // DSH baseline 0.1.5-rc.1+: compatible with the 0.1.5 line (including rc.2+), later 0.1.x,
    // and the stable 0.2.0 release.
    '@deepseek-ai/dsh-typert-protocol': '^0.1.5-rc.1 || ^0.1.6-alpha.2',
    ...(hasModelTools ? { '@deepseek-ai/dsh-tools': '^0.1.5-rc.1 || ^0.1.6-alpha.2' } : {}),
    ...(bundleId === 'flowglass-en' ? {
      '@deepseek-ai/dsh-client-ui-primitives': '^0.1.5-rc.1 || ^0.1.6-alpha.2',
      'dsh-better-sidebar': '>=0.19.0',
      'react-dom': '^18.3.1',
    } : {}),
    react: '^18.3.1',
  },
  ...(bundleId === 'flowglass-en' ? {
    peerDependenciesMeta: {
      'dsh-better-sidebar': { optional: true },
    },
  } : {}),
}, null, 2) + '\n'
