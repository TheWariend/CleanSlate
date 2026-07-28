# CleanSlate CLI

CleanSlate is the terminal surface for the same native agent engine and tool
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
provider, model, reasoning level, permission mode, and endpoint settings.
Provider credentials are stored globally in `~/.cleanslate/auth.json` with
owner-only (`0600`) permissions, independently of workspaces and sessions.
Legacy macOS Keychain credentials are migrated on first use. Run
`cleanslate --setup` whenever you want to reconnect or change provider
credentials.

Use `cleanslate --auth-list`, `cleanslate --logout`, and
`cleanslate --doctor` without opening the TUI for credential and installation
maintenance.

After provider connection, setup loads that provider's available models and
opens a terminal picker. A manual model-ID fallback remains for
custom endpoints that do not expose a model catalog. Azure alone asks for a
resource deployment name because Azure inference routes requests through
deployments rather than public model IDs.

Choose **CleanSlate** to sign in with your TheWariend account and use the same
managed models and entitlements as the IDE. CleanSlate opens the existing
TheWariend sign-in page in the system browser and completes a one-time device
authorization. Your password never passes through the CLI; the returned session
token is kept in the same owner-only global auth file as provider API keys.

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
- `/delete-session <id>` — delete an inactive saved session
- `/models` — fetch and select a provider model
- `/model <id>` — switch directly to a model
- `/provider <name> <model>` — switch provider and model using environment credentials
- `/reasoning <level>` — change reasoning effort without restarting
- `/permissions read-only|default|full` — choose the host-enforced tool policy
- `/plan <task>` — run one turn with write tools filtered
- `Shift+Tab` — enter or leave plan mode
- `/fix`, `/explain`, `/test`, `/rewrite`, `/doc`, `/review`, `/optimize`,
  `/scaffold`, `/migrate` — the IDE agent’s task-specific slash commands
- `/clear` — clear the visible transcript
- `/context` — inspect loaded project instructions and context usage
- `/changes` — inspect the Git branch and working tree
- `/diff` — review staged and unstaged changes
- `/doctor` — validate the CLI, provider, workspace, Git, and MCP configuration
- `/logout` — remove the active provider credential
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

At session start CleanSlate deterministically loads project instructions from
`AGENTS.md`, `CLAUDE.md`, and `.cleanslate/instructions.md` when present.
Mention a text file inside the workspace as `@path/to/file` to attach its
contents to that turn. Mention PNG, JPEG, WebP, or GIF files the same way to
send them as native multimodal image parts. Attachments are
workspace-contained and size-bounded.

## One-shot and automation

Use `--no-tui` for streaming, script-friendly execution:

```sh
cleanslate --no-tui -C /path/to/repo "fix the failing tests"
cleanslate --no-tui --permission-mode read-only "audit the repository"
cleanslate --no-tui --permission-mode full "run the tests and fix failures"
cleanslate --json --permission-mode read-only "inspect the project"
cleanslate --no-tui --resume "continue the refactor"
cleanslate --list-sessions -C /path/to/repo
cleanslate --delete-session <id> -C /path/to/repo
```

`--json` emits one JSON object per stream event for scripts and higher-level
clients while preserving the same session, permission, and tool semantics as
the interactive surface.

In default mode, the TUI asks before each shell command: `y` allows it once,
`a` allows commands for the current session, and `n` refuses. Read-only mode
blocks mutations. Full mode permits commands without prompts. Non-interactive
default-mode stdin refuses command prompts.

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
