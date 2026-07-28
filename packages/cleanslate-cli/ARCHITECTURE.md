# CleanSlate CLI architecture

The CLI is a headless host for the shared Slate agent engine. It does not copy
the IDE UI or maintain a second agent implementation.

## Boundaries

- `@slate/sdk` owns model transports, structured conversation state, execution
  phases, tool protocols, edit safety, and the shared tool registry.
- `projectContext.ts` owns deterministic project instructions and explicit
  workspace-contained `@file` attachments.
- `permissions.ts` owns host policy. The model cannot bypass this layer.
- `workspaceReview.ts` owns read-only Git status and diff presentation.
- `doctor.ts` owns local installation and configuration diagnostics.
- `config.ts` owns atomic global configuration and credential persistence.
- `sessions.ts` owns workspace-isolated session snapshots.
- `tui.tsx` is presentation and input routing. It does not implement model,
  filesystem, Git, credential, or permission behavior.

## CLI-native parity

IDE-only presentation features are represented by terminal-native services:

- editor selection becomes explicit `@file` context;
- the review pane becomes `/changes` and `/diff`;
- settings become `/setup`, `/permissions`, `/doctor`, and `/logout`;
- IDE thread state becomes atomic workspace session snapshots;
- command and tool permissions are enforced by the headless host before tool
  execution.

Visual editor decorations and embedded panes intentionally remain IDE features.
Their absence must never change whether an edit, command, or policy decision is
correctly executed.
