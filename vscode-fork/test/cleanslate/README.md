# CleanSlate regression QA

`CleanSlate CI` runs on every pull request, push to `main`, manual run, and before a desktop release. Require the **Regression gate** status in GitHub branch protection. It fails when any area fails or is skipped. Checks use the committed lockfiles and the Node version in `.nvmrc`.

## What runs

| Area | Automated coverage |
| --- | --- |
| SDK and CLI | All workspace tests and type checks on Linux, macOS and Windows. This includes provider adapters, execution, cancellation, permissions, files, sessions, workers, IPC and terminal behavior. Linux explicitly enables the real SDK browser scenario against an installed Chromium. |
| Editor integration | Full editor/extension compilation; every CleanSlate common unit test; build script tests; host IPC integration; native embedded browser and SQLite persistence. |
| Real desktop app | A temporary profile/workspace launches the development Electron app. Journeys cover initial chat, settings and returning with a draft, switching to the IDE, opening a file, returning to Agent Manager, search/empty results, window resizing and pane toggles. A local fake API exercises provider setup through settings, real streamed turns through the host, cancellation, a following turn, provider failure and recovery. |
| Browser scenarios | Production components and styles run in Chromium with dark/light themes and a narrow chat panel. Checks cover composer controls, native/external agent changes, plan mode, send/stop/next turn, command approval/rejection, plan revision/dismissal, questions, pending edits, slash commands, settings navigation, saved configuration, account recovery and custom agent forms. Controls are checked for visibility, clipping and hit testing. |
| Existing regressions | Every `*-browser.mjs` script is discovered automatically: streaming markdown, copy/link behavior, reasoning/tool animations, reduced motion, scroll anchoring, history cleanup, sidebar refresh/navigation and managed token refresh. Browser Mocha tests in `test/browser/` are discovered from source and run with a real DOM. |
| Appearance | Reviewed screenshots for the composer with approvals and model settings. Comparisons use the pinned Playwright Linux image, fonts, browser, theme and viewport. Missing baselines fail CI. |
| Static checks | Introduced whitespace errors; ESLint correctness rules for the SDK, CLI, CleanSlate integration and QA; native type boundaries, field initialization, public API declarations and Trusted Types. |

Independent QA steps continue after another check fails, as long as compilation succeeded. This keeps one failure from concealing other failures. The release workflow calls this same suite before signing or publishing.

## Read a failure

Download the `browser-qa` or `desktop-qa` artifact from the Actions run. Open the HTML report in `results/ui-report` or `results/desktop-report`. Browser failures include screenshots, expected/actual/diff images for screenshot failures, and Playwright traces. Desktop reports include screenshots, a trace and application logs. JUnit reports are included too. A trace can be opened with:

```sh
cd vscode-fork
node node_modules/@playwright/test/cli.js show-trace path/to/trace.zip
```

## Run locally

Install dependencies at the repository root and in `vscode-fork`, then build the SDK and compile the editor. Use the Node version from `.nvmrc`.

After installing dependencies, `npm run test:qa` at the repository root runs the main product suites, including a fresh editor build and Electron download. Docker must be running; Linux also needs a display (for example `xvfb-run -a npm run test:qa`). CI runs the areas independently to preserve evidence when more than one area fails. Individual commands are useful when investigating:

```sh
npm ci
npm run build --workspace @cleanslate/sdk
cd vscode-fork
npm ci
npm run compile:diagnostic
npm run test-node
npm run test:integration
npm run electron
npm run test:desktop
```

Linux desktop tests require a display, for example `xvfb-run -a npm run test:desktop`. They use isolated temporary profiles and workspaces. Browser component fixtures abort external network requests; scripted integration tests use fake provider responses.

For functional browser checks on the host, install Chromium for the pinned test runner, then run:

```sh
node node_modules/@playwright/test/cli.js install chromium
npm run test:ui -- --grep-invert @visual
```

To compare screenshots in the same environment as CI, run `npm run test:ui:container`. Docker must be running. This uses `mcr.microsoft.com/playwright:v1.58.2-noble`, matching CI and `@playwright/test` in the lockfile. Run `npm run test:ui:container -- --update-snapshots` to create proposed baselines. Review the generated images in `ui/snapshots/` before committing. Never update screenshots automatically in CI to clear a failure. The helper prepares browser assertions on the host and reuses that bundle inside Docker.

## Keep coverage useful

For a new feature, add scenarios for its intended behavior and for existing features it shares space or state with. Include success, empty/loading, error, cancellation, recovery, keyboard use and relevant window sizes. Every fixed regression should get a test that reproduces it. Add component scenarios under `ui/` and complete application journeys under `desktop/`.

These checks exercise documented scenarios. They do not infer every possible UX requirement or cover all inherited VS Code integration tests. Live provider/service compatibility, signed packaging on every OS, assistive technology review, and subjective design review need separate coverage. Broad compilation and a passing test count alone do not establish complete product coverage.

The inherited `hygiene` task enforces upstream product/distribution policies, and the inherited ESLint config requires a missing `.eslint-plugin-local` directory. CI uses the repository's `lint:qa` config and a commit whitespace check instead of those incompatible tasks.

The full upstream `valid-layers-check` TypeScript configuration matrix also has existing worker/browser dependency violations in this fork. CI runs its native-type boundary checker plus full editor compilation. Repairing the remaining upstream layer configuration matrix is separate work; it is not claimed as passing coverage here.

The optional MuscleMemory SDK integration test requires an external `MUSCLEMEMORY_SDK_NODE_MODULE` build and remains explicitly skipped without that module. This repository's pipeline does not claim to verify that external SDK integration.
