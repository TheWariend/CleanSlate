# CleanSlate CLI

CleanSlate is the terminal surface for the same native agent engine and 59-tool
registry used by the CleanSlate IDE. It runs directly against a repository
without building or launching the VS Code fork.

## Install from this checkout

Build and link it once:

```sh
cd packages/cleanslate-cli
npm install
npm run build
npm link
```

Then, from any repository, run:

```sh
cleanslate
```

The first launch opens provider setup inside the TUI. CleanSlate remembers the
provider, model, reasoning level, and endpoint settings. On macOS, API keys are
stored in Keychain; on other platforms they are stored in an owner-only
credentials file. Run `cleanslate --setup` whenever you want to reconnect or
change provider credentials.

Choose **CleanSlate** to sign in with your TheWariend account and use the same
managed models and entitlements as the IDE. CleanSlate opens the existing
TheWariend sign-in page in the system browser and completes a one-time device
authorization. Your password never passes through the CLI; the returned session
token is kept in the operating system credential store.

Common provider examples:

```sh
ANTHROPIC_API_KEY=... cleanslate -p anthropic -m claude-sonnet-4-5
GOOGLE_API_KEY=... cleanslate -p gemini -m gemini-2.5-pro
OPENROUTER_API_KEY=... cleanslate -p openrouter -m openai/gpt-5.4
AZURE_OPENAI_API_KEY=... cleanslate -p azure -m my-deployment \
  --azure-endpoint https://example.openai.azure.com
AWS_PROFILE=my-profile cleanslate -p bedrock -m model-id --aws-region us-east-1
```

Provider/model availability changes over time; use the IDs enabled for your
account.

## Interactive use

Run `cleanslate` in a terminal to open the TUI. Useful commands:

- `/setup` — change provider, credentials, and model without leaving the TUI
- `/new` — start a clean session
- `/sessions` — browse and resume workspace sessions
- `/resume <id>` — resume a specific session
- `/models` — fetch and select a provider model
- `/model <id>` — switch directly to a model
- `/provider <name> <model>` — switch provider and model using environment credentials
- `/reasoning <level>` — change reasoning effort without restarting
- `/mode plan` or `/mode execution` — switch agent phase
- `/plan <task>` — run one turn with write tools filtered
- `/fix`, `/explain`, `/test`, `/rewrite`, `/doc`, `/review`, `/optimize`,
  `/scaffold`, `/migrate` — the IDE agent’s task-specific slash commands
- `/clear` — clear the visible transcript
- `/exit` — save and quit

Use Page Up and Page Down for transcript scrollback. Escape cancels the active
turn. Ctrl-C exits when idle.

Typing `/` opens the searchable command palette. Use the arrow keys to select a
command and Enter to insert it.

The interactive agent uses the terminal's alternate screen, so redraws and
provider setup replace the current view instead of accumulating in scrollback.

Sessions are isolated by workspace and stored under
`~/.cleanslate/sessions/`. They include the native provider/tool transcript, so
resuming does not flatten or reconstruct tool calls.

## One-shot and automation

Use `--no-tui` for streaming, script-friendly execution:

```sh
cleanslate --no-tui -C /path/to/repo "fix the failing tests"
cleanslate --no-tui --resume "continue the refactor"
cleanslate --list-sessions -C /path/to/repo
```

Shell commands default to refusal. In the TUI, each command asks for approval:
`y` allows it once, `a` allows commands for the current session, and `n`
refuses. Non-interactive stdin always refuses commands.

## Browser, web, and MCP

The CLI browser tools launch installed Chrome through Playwright. To use a
different browser:

```sh
CLEANSLATE_BROWSER_EXECUTABLE=/path/to/chrome cleanslate
```

If Chrome is not installed, install Playwright Chromium with
`npx playwright install chromium`.

Web search uses a configured SearXNG endpoint first and can fall back to the
agent's anonymous hosted MCP search providers. Web fetch rejects localhost,
private IPs, embedded credentials, oversized responses, and unsafe redirects.

Put stdio MCP servers in the workspace's `.mcp.json`:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["./tools/example-mcp.js"],
      "env": {
        "EXAMPLE_TOKEN": "..."
      }
    }
  }
}
```

Mutating or open-world MCP tools use the same fail-safe approval path as shell
commands.
