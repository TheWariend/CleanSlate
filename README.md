<p align="center">
  <picture>
    <source srcset="vscode-fork/c_transparent.png" media="(prefers-color-scheme: dark)">
    <source srcset="vscode-fork/resources/linux/CleanSlate.png" media="(prefers-color-scheme: light)">
    <img src="vscode-fork/c_transparent.png" width="150" height="150" alt="CleanSlate">
  </picture>
</p>
<p align="center"><b>CleanSlate</b></p>
<p align="center">The open source coding agent.</p>
<p align="center">
  <a href="vscode-fork/LICENSE.txt"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
  <a href="https://github.com/TheWariend/CleanSlate-Releases/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/TheWariend/CleanSlate-Releases?display_name=tag&style=flat-square&label=release" /></a>
  <img alt="Built on VS Code" src="https://img.shields.io/badge/built%20on-VS%20Code-007ACC?style=flat-square" />
</p>

![CleanSlate](assets/screenshot.png)

---

### Installation

The current release is **CleanSlate 1.0.4**. See the [release notes](https://github.com/TheWariend/CleanSlate-Releases/releases/tag/v1.0.4) or download it directly:

| Platform | Download |
| -------- | -------- |
| macOS (Apple Silicon) | [DMG](https://github.com/TheWariend/CleanSlate-Releases/releases/latest/download/CleanSlate-darwin-arm64.dmg) · [ZIP](https://github.com/TheWariend/CleanSlate-Releases/releases/latest/download/CleanSlate-darwin-arm64.zip) |

Builds are signed and notarized.

> [!NOTE]
> Intel macOS, Windows, and Linux aren't published yet. Build from source on those platforms.

### In the terminal

![CleanSlate CLI](assets/screenshot-cli.png)

The same agent runs without the editor:

```sh
npm install -g @cleanslate/cli
cleanslate
```

Or try it without installing:

```sh
npx @cleanslate/cli "fix the failing test"
```

Node 20 or later. It walks you through provider setup on first run, and works
against any repository — the full tool set, not a reduced one.

See [packages/cleanslate-cli](packages/cleanslate-cli) for options, slash
commands, sessions, and MCP configuration.

### Building on the runtime

The engine behind both surfaces is published on its own:

```sh
npm install @cleanslate/sdk
```

It carries the execution loop, all 60 tools, the edit engine and a Node host,
with no editor dependency. A surface supplies host capabilities — a filesystem,
a way to run commands, optionally diagnostics and a browser — and the runtime
drives the loop.

See [packages/cleanslate-sdk](packages/cleanslate-sdk).

| Package | Version |
| ------- | ------- |
| [`@cleanslate/cli`](https://www.npmjs.com/package/@cleanslate/cli) | `1.0.5` · ![npm](https://img.shields.io/npm/v/@cleanslate/cli?style=flat-square&label=npm) |
| [`@cleanslate/sdk`](https://www.npmjs.com/package/@cleanslate/sdk) | `1.0.5` · ![npm](https://img.shields.io/npm/v/@cleanslate/sdk?style=flat-square&label=npm) |

> [!NOTE]
> The CLI and SDK follow semantic versioning. Breaking changes require a major
> version release.

### Building from source

Requires Node.js 22.21.1 (see [`.nvmrc`](vscode-fork/.nvmrc)).

```bash
cd vscode-fork
npm install
npm run watch
./scripts/code.sh
```

### Modes

CleanSlate has two modes you can switch between per message.

- **Execution** — Default, full-access mode for building things
- **Plan** — Read-only mode for analysis and code exploration
  - Cannot edit files or run commands
  - Can still read, search, browse the web, and drive a browser
  - Ideal for exploring unfamiliar codebases or planning changes

### Models

CleanSlate is not coupled to any provider. Bring your own key for OpenAI, Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock, xAI Grok, NVIDIA, OpenRouter, or any OpenAI-compatible endpoint.

Or sign in to **CleanSlate Pro** for managed models, higher limits, and pay-as-you-go credits. Pro is optional — everything works with your own key, and no account is required.

### What the agent can do

- Read, search, and edit across your whole codebase
- Run commands, including long-running ones in the background
- Drive a real browser to check its own work
- Search and fetch from the web
- Call any MCP server you configure

Code search runs on your machine. Indexing and embeddings use a bundled model, so your code is never sent anywhere to be searched.

### Extensions

CleanSlate installs extensions from [Open VSX](https://open-vsx.org). The Visual Studio Marketplace is Microsoft-only and can't be used by forks.

### Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security issue, see [SECURITY.md](SECURITY.md).

### License

CleanSlate is MIT licensed.

It is a fork of [Visual Studio Code](https://github.com/microsoft/vscode) (MIT, © Microsoft Corporation) — see [LICENSE.txt](vscode-fork/LICENSE.txt). CleanSlate is not affiliated with, endorsed by, or sponsored by Microsoft.
