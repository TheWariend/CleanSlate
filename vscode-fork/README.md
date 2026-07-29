<p align="center">
  <picture>
    <source srcset="c_transparent.png" media="(prefers-color-scheme: dark)">
    <source srcset="resources/linux/CleanSlate.png" media="(prefers-color-scheme: light)">
    <img src="c_transparent.png" width="150" height="150" alt="CleanSlate">
  </picture>
</p>
<p align="center"><b>CleanSlate</b></p>
<p align="center">The open source coding agent.</p>

---

This directory holds the CleanSlate product — the editor fork, workbench UI, agent loop, model routing, and tools. It's the whole application; there is no separate server stack in this repository.

**Documentation lives at the repository root:**

- [README](../README.md) — installation, models, tools, and what CleanSlate does
- [CONTRIBUTING](../CONTRIBUTING.md) — development setup and pull request guidelines
- [SECURITY](../SECURITY.md) — threat model and vulnerability reporting
- [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md)

## Building

Requires Node.js 22.21.1 (see [`.nvmrc`](.nvmrc)).

```bash
npm install
npm run watch
./scripts/code.sh
```

## Where the code lives

| Path | Contents |
| ---- | -------- |
| `src/vs/workbench/contrib/cleanSlate/` | Agent loop, tools, chat UI, Agent Manager, settings, artifacts |
| `src/vs/workbench/services/cleanSlate/` | Model routing, provider adapters, configuration, entitlements |
| `src/vs/editor/browser/cleanSlate/` | Inline edit widget and edit parsing |
| `resources/cleanslate/` | Bundled local embedding model |

Everything else is upstream [Visual Studio Code](https://github.com/microsoft/vscode).

## License

MIT — see [LICENSE.txt](LICENSE.txt). CleanSlate is a fork of Visual Studio Code (MIT, © Microsoft Corporation) and is not affiliated with, endorsed by, or sponsored by Microsoft.
