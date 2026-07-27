# Security

## Reporting a vulnerability

Please do not report security issues through public GitHub issues.

Report them through GitHub's Security Advisory ["Report a Vulnerability"](https://github.com/TheWariend/CleanSlate/security/advisories/new) tab. You'll get a response indicating the next steps, and we'll keep you informed of progress toward a fix.

We appreciate responsible disclosure and will make every effort to acknowledge your contribution.

> [!IMPORTANT]
> We do not accept AI-generated security reports. If you can't explain the vulnerability and its impact in your own words, don't submit it.

## Threat model

CleanSlate is an AI code editor that runs locally. The agent has access to powerful tools: shell execution, file reads and writes, browser automation, and network access.

### The agent is not sandboxed

CleanSlate does **not** sandbox the agent. There are safeguards, and they are real, but they are correctness and awareness features rather than a security boundary:

- **Plan mode** removes mutation tools and `execute_command` from the tool list and blocks them again at the call site, so a plan-mode turn cannot modify the workspace.
- **Command approval** — `execute_command` requests user approval before running, and a declined command returns as cancelled.
- **Shell-edit blocking** — source edits attempted through shell redirection, `sed -i`, or heredocs are refused and redirected to the edit tools.

In execution mode, an approved command runs with your full user privileges. If you need true isolation, run CleanSlate against a workspace inside a container or VM.

### Your keys and your code

- API keys are stored in the OS secret store, not in workspace files.
- Code indexing and semantic search run entirely on-device using a bundled embedding model. Nothing is sent anywhere for retrieval.
- Prompts and file context you send to a provider are governed by that provider's policies.

### Out of scope

| Category | Rationale |
| -------- | --------- |
| **Sandbox escapes** | The permission system is not a sandbox (see above) |
| **Approved command behavior** | If you approve a command, running it is expected behavior |
| **LLM provider data handling** | Data sent to your configured provider is governed by their policies |
| **MCP server behavior** | External MCP servers you configure are outside the trust boundary |
| **Malicious workspace or config files** | You control your own workspace and settings |
| **Upstream VS Code vulnerabilities** | Report these to [microsoft/vscode](https://github.com/microsoft/vscode/security/policy) |

Prompt injection through file contents, web pages, or tool output that causes the agent to take an action **is** in scope — tell us about it.
