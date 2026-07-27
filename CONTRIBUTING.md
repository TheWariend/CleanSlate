# Contributing to CleanSlate

We want to make it easy for you to contribute. These are the kinds of changes that get merged most readily:

- Bug fixes
- Support for new model providers
- New or improved agent tools
- Fixes for environment-specific quirks
- Improvements to agent-loop reliability
- Documentation improvements

UI and core agent-behavior changes should go through a design conversation before implementation. If you're unsure whether a change would be accepted, open an issue and ask first.

> [!NOTE]
> CleanSlate is a fork of Visual Studio Code. Bugs in the editor itself — not in CleanSlate's AI features — usually belong [upstream](https://github.com/microsoft/vscode/issues).

## Developing CleanSlate

Requirements: Node.js 22.21.1 (see [`.nvmrc`](vscode-fork/.nvmrc)).

```bash
cd vscode-fork
npm install
npm run watch
./scripts/code.sh
```

`npm run watch` compiles the client and extensions incrementally and stays running; `./scripts/code.sh` launches the built app. Keep the watcher going in one terminal and relaunch as needed.

### Repository layout

Everything ships from `vscode-fork/`. CleanSlate's own code lives in four places:

| Path | Contents |
| ---- | -------- |
| `src/vs/workbench/contrib/cleanSlate/` | Agent loop, tools, chat UI, Agent Manager, settings, artifacts |
| `src/vs/workbench/services/cleanSlate/` | Model routing, provider adapters, configuration, entitlements |
| `src/vs/editor/browser/cleanSlate/` | Inline edit widget and edit parsing |
| `resources/cleanslate/` | Bundled local embedding model |

Everything else is upstream VS Code.

### Touching upstream files

Prefer adding code in the `cleanSlate` directories over modifying upstream files. Every edit to an upstream file is a merge conflict on the next rebase against VS Code. When you must change one, keep the diff as small as possible and explain why it couldn't live in a CleanSlate module.

### Tests

```bash
npm run test-node          # Node unit tests
npm run eslint             # Lint
npm run precommit          # Hygiene checks (headers, formatting)
```

CleanSlate's unit tests live in `src/vs/workbench/contrib/cleanSlate/test/`. Agent-loop changes should come with a test — the loop's stop conditions, plan-mode barriers, and tool-argument handling are all covered there, and regressions in them are hard to spot by hand.

## Pull request expectations

### Issue first

**PRs should reference an issue.** Open one describing the bug or feature before writing code. This prevents duplicate work and lets maintainers flag problems before you've spent the effort. Use `Fixes #123` in the description to link it.

For small fixes a brief issue is fine — just enough context to understand the problem.

### General requirements

- Keep pull requests small and focused
- Explain the problem and why your change fixes it
- Check that the functionality doesn't already exist elsewhere in the codebase

### UI changes

Include before/after screenshots or a short video. CleanSlate's chat and Agent Manager surfaces are dense, and screenshots get you feedback far faster than a description.

### Logic changes

Explain **how you verified it works**: what you tested, and how a reviewer can reproduce it. For agent-behavior changes, describe the prompt or scenario you ran.

### No AI-generated walls of text

Long, AI-generated PR and issue descriptions may be ignored. Write short descriptions in your own words. If you can't explain the change briefly, it's probably too large.

### PR titles

Follow conventional commit style:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation changes
- `chore:` maintenance, dependency updates
- `refactor:` restructuring without behavior change
- `test:` adding or updating tests

Examples:

- `fix: stop the agent loop retrying failed compaction`
- `feat: add support for a new provider`
- `docs: clarify build instructions`

## Feature requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach, and why it belongs in CleanSlate. Please wait for a maintainer's response before opening a feature PR.

## Security

Do not report security vulnerabilities through public issues. See [SECURITY.md](SECURITY.md).

## Code of conduct

By participating, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).
