# @cleanslate/sdk

The Slate agent runtime: execution loop, tool protocol, edit engine and Node
host. It is the engine behind [CleanSlate](https://github.com/TheWariend/CleanSlate)
— the same code drives the editor and the terminal.

It has no editor dependency. A surface supplies host capabilities; the runtime
drives the loop.

> **Current release: 1.0.2.** The SDK follows semantic versioning.

## Install

```bash
npm install @cleanslate/sdk
```

Node 20 or later.

## What is in it

- **The execution loop** — turn management, budgets, an evidence ledger, and the
  completion boundary that decides when a task is actually finished.
- **59 tools**, listed below.
- **The edit engine** — exact-string matching with anchors, version guards and
  atomic multi-file application.
- **A Node host** — filesystem-backed text models and child-process commands, so
  the runtime works with no editor present.

## The tools

`ALL_TOOLS` exports 59 tools. Availability depends on what the host provides —
a surface with no browser has no browser tools.

| Group | Count | Tools |
| --- | --- | --- |
| Discovery | 12 | `read_file`, `read_file_range`, `semantic_search`, `search_workspace`, `search_codebase`, `find_by_name`, `grep_search`, `web_search`, `web_fetch`, `list_dir`, `read_lints`, `find_references` |
| Browser | 26 | `browser_open`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_type`, `browser_key`, `browser_scroll`, `browser_screenshot`, `browser_diagnostics`, tab and annotation control, … |
| System | 8 | `spawn_worker`, `list_skills`, `mcp_list_tools`, `mcp_call_tool`, `read_reference`, `update_todo`, `ask_question`, `submit_artifact` |
| Edit | 4 | `apply_edit`, `multi_file_replace`, `write_file`, `file_history_rewind` |
| Execution | 4 | `execute_command`, `start_background_command`, `read_background_command`, `stop_background_command` |
| Symbols | 3 | `read_symbols`, `get_definitions`, `undo_edit` |
| Context | 1 | `get_open_files` |
| Creation | 1 | `create_multiple_files` |

```js
import { ALL_TOOLS, getToolByName } from '@cleanslate/sdk';

ALL_TOOLS.length;                  // 59
getToolByName('multi_file_replace');
```

Every command-running tool passes through the host's approval gate first, which
refuses by default.

## Entry points

| Import | Contains |
| --- | --- |
| `@cleanslate/sdk` | The runtime: the loop, the tools, the edit engine, the host contracts. Touches no Node built-in, so an editor renderer can load it. |
| `@cleanslate/sdk/node` | The Node host: filesystem-backed models, child-process commands, the provider bridge, Playwright. |
| `@cleanslate/sdk/<module>.js` | Any single module, e.g. `@cleanslate/sdk/tools/ReadFileTool.js`. For surfaces that want one piece rather than the barrel. |

## Shape

```js
import { ALL_TOOLS } from '@cleanslate/sdk';
import { createNodeHost } from '@cleanslate/sdk/node';

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
