<p align="center">
  <picture>
    <source srcset="vscode-fork/c_transparent.png" media="(prefers-color-scheme: dark)">
    <source srcset="vscode-fork/resources/linux/CleanSlate.png" media="(prefers-color-scheme: light)">
    <img src="vscode-fork/c_transparent.png" width="150" height="150" alt="CleanSlate">
  </picture>
</p>
<p align="center"><b>CleanSlate</b></p>
<p align="center">An AI workspace with shared procedural memory as reusable skills.</p>
<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
  <a href="https://github.com/TheWariend/CleanSlate-Releases/releases/latest"><img alt="Latest CleanSlate desktop release" src="https://img.shields.io/github/v/release/TheWariend/CleanSlate-Releases?display_name=tag&style=flat-square&label=Desktop" /></a>
  <a href="https://github.com/microsoft/vscode"><img alt="Workspace built on VS Code" src="https://img.shields.io/badge/built%20on-VS%20Code-007ACC?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@cleanslate/sdk"><img alt="CleanSlate SDK npm version" src="https://img.shields.io/npm/v/@cleanslate/sdk?style=flat-square&label=SDK" /></a>
  <a href="https://www.npmjs.com/package/@cleanslate/cli"><img alt="CleanSlate CLI npm version" src="https://img.shields.io/npm/v/@cleanslate/cli?style=flat-square&label=CLI" /></a>
</p>

[Download for macOS](https://github.com/TheWariend/CleanSlate-Releases/releases/latest) · [Shared procedural memory](#shared-procedural-memory) · [Connect MuscleMemory](#connect-musclememory) · [CLI](#in-the-terminal) · [SDK](#building-on-the-runtime)

[![CleanSlate desktop workspace demo](assets/cleanslate-desktop-preview.jpg)](assets/cleanslate-desktop.mp4)

[Watch the desktop demo](assets/cleanslate-desktop.mp4) (33 seconds).

CleanSlate is an open-source AI workspace that brings agents, project chats,
a browser, terminals, files, and change review together. Work with the built-in
agent or connect compatible external agents, and inspect their work alongside
the conversation.

Its procedural memory is powered by [MuscleMemory](https://github.com/TheWariend/MuscleMemory).
When connected, MuscleMemory learns reusable skills from verified work and
shares them with connected agents. A new chat or a different agent can start
with the procedure that worked before: which files to change, how to check the
result, and what to avoid.

### Shared procedural memory

Procedural memory keeps **how to do a task**. MuscleMemory records the steps,
edits, test results, and failed attempts behind a coding task, then makes the
useful procedure available as a reusable skill.

1. **Work on a task.** A connected agent reads files, makes changes, and runs tests.
2. **Learn from verified work.** A test must pass after the last code change before a session can teach a skill.
3. **Check and approve it.** A new skill needs two separate later passing checks and your approval by default before it is recalled.
4. **Reuse it.** A later similar task gets a short note with the relevant steps, checks, and pitfalls. Ready skills can also be exported as `SKILL.md` files for Claude Code or Codex.

For example, after an agent fixes a configuration-loading bug and the tests pass,
MuscleMemory can learn the files involved, the edits, and the test command. Once
the skill passes its later checks and is approved, another connected agent can
use it as a starting point for a similar fix while checking the current code.

**Shared** means agents connected to the same MuscleMemory workspace can reuse
its skills. A skill learned with Codex can be recalled by Claude Code, Cursor,
or CleanSlate; it is not tied to the conversation that produced it. Memory is
local by default, and a namespace controls which workspace shares it.

MuscleMemory is a separate, optional service. The integration in this checkout
supports CleanSlate's built-in desktop agent and CLI; external agents use their
own MuscleMemory connections. See [setup below](#connect-musclememory) and the
[learning rules and limits](https://github.com/TheWariend/MuscleMemory/blob/main/docs/how-it-works.md).

### Your AI workspace

- **Reusable skills** — Connect MuscleMemory to carry verified procedures between tasks and compatible agents.
- **Projects and chats** — Keep conversations grouped by project and return to ongoing work.
- **Agents** — Choose CleanSlate's built-in agent or a compatible external agent, import existing local chats, and hand off conversations with their visible context.
- **Browser** — Browse in workspace tabs with bookmarks and history, and let the agent drive a real browser to check its work.
- **Files and terminals** — Open files and run commands alongside the conversation, with the VS Code editor available for hands-on coding.
- **Review and artifacts** — Inspect changed files and diffs, and view artifacts produced during a task without leaving the workspace.

The desktop workspace is built on VS Code. The same agent runtime also powers
the standalone CLI and SDK below. Bring your own model key, or optionally use
CleanSlate Pro for managed models.

---

### Installation

The current release is **CleanSlate 1.2.0**. See the [release notes](https://github.com/TheWariend/CleanSlate-Releases/releases/tag/v1.2.0) or download it directly:

| Platform | Download |
| -------- | -------- |
| macOS (Apple Silicon) | [DMG](https://github.com/TheWariend/CleanSlate-Releases/releases/latest/download/CleanSlate-darwin-arm64.dmg) · [ZIP](https://github.com/TheWariend/CleanSlate-Releases/releases/latest/download/CleanSlate-darwin-arm64.zip) |

Developer ID signing and notarization are temporarily disabled while our Apple
Developer account is being renewed. New macOS builds use ad-hoc signatures to
seal the app bundle; these do not identify a verified publisher. These builds may be blocked by
macOS Gatekeeper and require manual installation; automatic updates from an
existing signed installation may reject them. Check the release notes for the
signing status of a particular build.

#### If macOS blocks CleanSlate

You may see the following message because the current build is not notarized:

![macOS blocks CleanSlate and offers an Open Anyway button](assets/macos-open-anyway.png)

If you trust the download and obtained it from the release links above:

1. Move **CleanSlate.app** to **Applications** and try opening it once.
2. Open **System Settings → Privacy & Security** and scroll to **Security**.
3. Click **Open Anyway** beside the CleanSlate message shown above.
4. Authenticate if prompted, then click **Open** to launch CleanSlate.

See [Apple’s instructions for opening a blocked app](https://support.apple.com/en-us/102445) for more details.

> [!NOTE]
> Intel macOS, Windows, and Linux aren't published yet. Build from source on those platforms.

### Connect MuscleMemory

MuscleMemory is [open source](https://github.com/TheWariend/MuscleMemory) and runs
as a local service by default. Install it separately, then connect the agents
that should share its skills:

```sh
# Requires Python 3.12+ and pipx.
pipx install thewariend-musclememory
musclememory init
musclememory start

# Run from the project you want to connect.
cd your-project
musclememory connect cleanslate
```

The connect command prints the host configuration and SDK module settings.
Follow those instructions, then launch CleanSlate from the same terminal.
The integration uses `CLEANSLATE_MUSCLEMEMORY_CONFIG` and the MuscleMemory
TypeScript SDK; `CLEANSLATE_MUSCLEMEMORY_NODE_MODULE` selects the SDK module.
For the desktop integration, use a build from this checkout and launch it from
that environment. Installing the desktop app alone
does not enable memory.

To share the same memory with external agents, run `musclememory connect codex`,
`musclememory connect claude`, or `musclememory connect cursor` for each agent
you use. Run `musclememory dashboard` to inspect captured activity, review
skills, and approve them for reuse.

See the [CleanSlate integration guide](https://github.com/TheWariend/MuscleMemory/blob/main/integrations/cleanslate/README.md)
for SDK setup and launch instructions, or the
[MuscleMemory quick start](https://github.com/TheWariend/MuscleMemory#quick-start)
for the other agents. Memory is opt-in; CleanSlate works without it.

### In the terminal

![CleanSlate CLI](assets/screenshot-cli.png)

The same agent runs from your terminal without the desktop workspace:

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

The engine behind the desktop workspace and CLI is published on its own:

```sh
npm install @cleanslate/sdk
```

It carries the execution loop, the tool registry, the edit engine and a Node host,
with no editor dependency. A surface supplies host capabilities — a filesystem,
a way to run commands, optionally diagnostics and a browser — and the runtime
drives the loop.

See [packages/cleanslate-sdk](packages/cleanslate-sdk).

| Package | Version |
| ------- | ------- |
| [`@cleanslate/cli`](https://www.npmjs.com/package/@cleanslate/cli) | `1.1.0` · ![npm](https://img.shields.io/npm/v/@cleanslate/cli?style=flat-square&label=npm) |
| [`@cleanslate/sdk`](https://www.npmjs.com/package/@cleanslate/sdk) | `1.2.0` · ![npm](https://img.shields.io/npm/v/@cleanslate/sdk?style=flat-square&label=npm) |

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

The desktop workspace includes a bundled model for local embeddings. The CLI and SDK can use configured embedding services; remote services receive the content being embedded.

### Extensions

CleanSlate installs extensions from [Open VSX](https://open-vsx.org). The Visual Studio Marketplace is Microsoft-only and can't be used by forks.

### External agents

CleanSlate can act as an Agent Client Protocol (ACP) client for compatible local
agents. Each external agent runs as a separate process and uses credentials that
the user configured directly with that agent. CleanSlate does not collect,
store, proxy, or resell external-agent account credentials.

OpenCode, Grok, and Claude are discovered from the user's `PATH`. Claude support
uses the Apache-2.0 ACP adapter for Anthropic's Claude Agent SDK and explicitly
launches the user's installed Claude executable, preserving Claude's own
authentication boundary. Codex support uses the
Apache-2.0 `@agentclientprotocol/codex-acp` adapter bundled with the desktop
application. Other agents can be registered explicitly by the user in settings;
their installation, license terms, authentication, and usage charges remain the
user's responsibility.

Use **Settings → General → Import chats**, or **CleanSlate: Import Claude and
Codex Chats** in the Command Palette, to select existing local conversations.
Imports retain their project, original agent session ID, and account data
folder. Choose a custom folder for additional accounts such as
`.codex-account2`. Continue with the original agent, or use the agent picker to
hand off to CleanSlate's built-in agent or another agent with the visible conversation as context.
Repeated imports skip existing chats. Source files stay unchanged. Individual
history files are limited to 64 MiB; compressed Codex history requires a host
with zstd support.

CleanSlate is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, xAI,
OpenCode, or any other external-agent provider. Product names and marks identify
compatible third-party services only.

### Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security issue, see [SECURITY.md](SECURITY.md).

### License

CleanSlate is MIT licensed. Bundled third-party components remain under their
respective licenses; see [NOTICE](NOTICE).

The CleanSlate desktop editor is based on [Visual Studio Code](https://github.com/microsoft/vscode) (MIT, © Microsoft Corporation) — see [LICENSE.txt](vscode-fork/LICENSE.txt). CleanSlate is not affiliated with, endorsed by, or sponsored by Microsoft.
