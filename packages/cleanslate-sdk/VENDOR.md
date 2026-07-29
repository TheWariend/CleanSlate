# Vendored code

`src/core/` contains modules taken from [microsoft/vscode](https://github.com/microsoft/vscode)
(MIT). They are copied rather than depended on: the fork's `vs/` tree is not a
published package, and importing it would tie the runtime to an editor build.

## Copied as-is

Each carries its original Microsoft copyright header plus a note naming its
source path. The only mechanical change is `export const enum` →`export enum`,
because `const enum` cannot cross a module boundary under `isolatedModules`.

| SDK path | Source |
| --- | --- |
| `core/uri.ts` | `vs/base/common/uri.ts` |
| `core/path.ts` | `vs/base/common/path.ts` |
| `core/charCode.ts` | `vs/base/common/charCode.ts` |
| `core/marshallingIds.ts` | `vs/base/common/marshallingIds.ts` |
| `core/event.ts` | `vs/base/common/event.ts` |
| `core/lifecycle.ts` | `vs/base/common/lifecycle.ts` |
| `core/cancellation.ts` | `vs/base/common/cancellation.ts` |
| `core/errors.ts` | `vs/base/common/errors.ts` |
| `core/functional.ts` | `vs/base/common/functional.ts` |
| `core/iterator.ts` | `vs/base/common/iterator.ts` |
| `core/linkedList.ts` | `vs/base/common/linkedList.ts` |
| `core/stopwatch.ts` | `vs/base/common/stopwatch.ts` |
| `core/collections.ts` | `vs/base/common/collections.ts` |
| `core/arrays.ts` | `vs/base/common/arrays.ts` |
| `core/arraysFind.ts` | `vs/base/common/arraysFind.ts` |
| `core/map.ts` | `vs/base/common/map.ts` |
| `core/types.ts` | `vs/base/common/types.ts` |
| `core/assert.ts` | `vs/base/common/assert.ts` |
| `core/position.ts` | `vs/editor/common/core/position.ts` |
| `core/range.ts` | `vs/editor/common/core/range.ts` |
| `core/diff/diff.ts` | `vs/base/common/diff/diff.ts` |
| `core/diff/diffChange.ts` | `vs/base/common/diff/diffChange.ts` |

There are no further changes. `path.ts` is carried across rather than replaced
with `node:path`, because the runtime also loads in an editor renderer, where
the `node:` scheme does not resolve.

## Reimplemented instead of copied

Four modules were rewritten. Each was a cut edge that would otherwise have
pulled a large subtree in for a handful of functions — following those edges
verbatim would have meant 32 files and ~16,200 lines instead of the 21 above.

| SDK path | Replaces | Why |
| --- | --- | --- |
| `core/platform.ts` | `vs/base/common/platform.ts` | The original resolves the UI locale, which is the sole reason it imports `vs/nls`. The runtime needs only the OS booleans. |
| `core/resources.ts` | `vs/base/common/resources.ts` | Six functions (`basename`, `dirname`, `joinPath`, `normalizePath`, `relativePath`, `isEqualOrParent`) were reaching `extpath` → `network` → `strings` → `nls`. Rewritten on `node:path`, preserving the original semantics; see the file header for the two deliberate simplifications. |
| `core/hash.ts` | `vs/base/common/hash.ts` | Only `stringHash` is used. The original also carries SHA-1 and structural hashing, pulling in `buffer` and `strings`. The algorithm is reproduced exactly, because diff output is keyed on it. |
| `core/buffer.ts` | `vs/base/common/buffer.ts` | The original carries streaming and chunked readers via `stream` and `lazy`, which nothing here uses. The rewrite is a `Uint8Array` wrapper on `TextEncoder`/`TextDecoder`. Its *instance* surface is not trimmed: a buffer built here is passed to the editor's `IFileService.writeFile`, and the two classes have to stay structurally interchangeable. |
| `core/process.ts` | `vs/base/common/process.ts` | `path.ts` needs `cwd`, `env` and `platform`. The original reads them through VS Code's sandbox bridge, which is absent here; a renderer falls through to the web branch and gets the same answers. |

Nothing from `vs/nls` is present, directly or transitively.

## Refreshing

`scripts/vendor.mjs` regenerates the copied files. Re-run it after rebasing the
fork on a newer VS Code, then re-run the SDK tests — `core/resources.ts` and
`core/hash.ts` are hand-written and will not be updated by it.

## The `Event` seam

`core/event.ts` is vendored, so the SDK's `Event<T>` and the editor's are two
declarations of the same type — and not assignable to each other in either
direction, because the third parameter is `DisposableStore`, a class with
private fields. Contracts a surface implements therefore use
`Subscribable<T>` from `host/events.ts` instead, which declares only the one
parameter that crosses the boundary. Inside the runtime, keep using `Event<T>`.
