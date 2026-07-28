# @slate/sdk

The Slate agent runtime: execution loop, tool protocol, edit engine and Node
host. It is the engine behind [CleanSlate](https://github.com/TheWariend/CleanSlate)
— the same code drives the editor and the terminal.

It has no editor dependency. A surface supplies host capabilities; the runtime
drives the loop.

> **Status: 0.x.** The host interfaces are still settling. Expect breaking
> changes between minor versions.

## Install

```bash
npm install @slate/sdk
```

Node 20 or later.

## What is in it

- **The execution loop** — turn management, budgets, an evidence ledger, and the
  completion boundary that decides when a task is actually finished.
- **The tools** — reading, searching, editing, running commands, browser
  automation, MCP, skills.
- **The edit engine** — exact-string matching with anchors, version guards and
  atomic multi-file application.
- **A Node host** — filesystem-backed text models and child-process commands, so
  the runtime works with no editor present.

## Shape

```js
import { createNodeHost, ALL_TOOLS } from '@slate/sdk';

const context = createNodeHost({
  rootPath: process.cwd(),
  configuration: { /* provider settings */ },
  // Defaults to refusing every command, so a host that forgets a policy
  // fails safe rather than running whatever the model asks for.
  approveCommand: async ({ command }) => confirm(command)
});
```

A host implements as much as it can and leaves the rest undefined. Tools that
need an absent capability report it as unavailable instead of failing the run —
so a terminal without a browser view simply has no browser tools.

## Host capabilities

| Interface | Provides |
| --- | --- |
| `ISlateTextModel` / `IModelHost` | reading and replacing text |
| `IFileHost` | the filesystem |
| `IWorkspaceHost` | workspace roots |
| `ISearchHost` | text search |
| `IMarkerHost` | diagnostics |
| `ILanguageFeaturesHost` | definitions, references, symbols |
| `ITreeSitterHost` | grammars for structural queries |
| `ICleanSlateBulkEditHost` | applying edits as one unit |
| `ICleanSlateBrowserAutomationService` | a browser, if the surface has one |

`ISlateTextModel` is deliberately small — about fifteen members, all concerned
with reading and replacing text — so a host can back a document with a file
rather than an editor.

## Vendored code

`src/core/` contains modules copied from
[microsoft/vscode](https://github.com/microsoft/vscode) (MIT), with their
copyright headers intact. Four more were reimplemented rather than copied, to
avoid pulling a large subtree in for a handful of functions. What was copied,
what was rewritten, and why, is recorded in [VENDOR.md](./VENDOR.md).

## Licence

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
