# Flowglass English (`dsh-flowglass-en`)

An English-only live session flow visualizer for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). Flowglass turns users, assistant responses, tool calls, parallel work, and subagents into an interactive execution graph.

This package has its own npm and runtime identities, so it can be installed without colliding with the original Chinese package.

## Features

- Live three-lane visualization for user messages, assistant work, tool calls, and results.
- Clickable details for messages, tools, models, token usage, and subagents.
- Nested subagent navigation and session-aware branch continuation.
- Flow Zoom views for concurrent sessions, including compact, detailed, and map layouts.
- Persistent topology history for evolving `1-to-N` branches.
- Configurable refresh interval, default branch count, default view, and tool presentation rules.
- Native right-sidebar integration, Better Sidebar compatibility, and a built-in fallback panel.
- English-only interface, settings, errors, logs, and package metadata. No translation engine is included.

## Requirements

- Node.js 22.19 or newer
- DeepSeek Harness 0.1.5-rc.1 or newer

## Install

From npm after publication:

```sh
dsh plugin --profile web add dsh-flowglass-en@0.6.1
```

From a local package tarball:

```sh
dsh plugin --profile web add ./dsh-flowglass-en-0.6.1.tgz
```

Restart DeepSeek Harness after installation. To remove it:

```sh
dsh plugin --profile web remove dsh-flowglass-en
```

## Build from source

```sh
npm run build
npm run check:english
npm pack
```

The generated native package is synchronized to `flowglass/`. The English-only check scans the source files and generated package for Han characters.

## Runtime architecture

- `flowglass/lib/index.js`: native Host plugin.
- `flowglass/lib/client.js`: native web Client plugin.
- `flowglass/lib/remote.js`: Host/Client Remote contract.
- Bundle ID: `flowglass-en`.
- Package and configuration identity: `dsh-flowglass-en`.
- No `dynamicCordisRunner` or generated `dyn/*` packages are used.

## Development

The source of truth is:

- `plugins/flow/tool.js`
- `plugins/toolbox/client.js`
- `plugins/toolbox/host.js`
- `shared/`
- `build/`

Run the complete local verification with:

```sh
npm test
```

## Credits

This English-only standalone package is based on the original Chinese [Iwctwbh/dsh-flowglass](https://github.com/Iwctwbh/dsh-flowglass) project. Thanks to its author and contributors for the original Flowglass design and implementation.

This repository is independently maintained and is not an official English release of the upstream project.

## License

[MIT](LICENSE). The upstream copyright and license notice are preserved.
