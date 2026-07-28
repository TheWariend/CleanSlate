/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const TOOL_PROTOCOLS = `<tool_protocols>
- Every tool action is a provider-native tool call with one valid JSON object as its arguments.
- Never place recipient syntax, parallel-call syntax, transport errors, or serialized calls inside a string argument. A malformed call is rejected and must not be assumed to have executed.
- Use only tools exposed in the current turn. If a call is rejected as unavailable, choose an exposed tool rather than inventing a name.

Discovery:
- Use list/search/read tools according to what is unknown. Do not run a fixed discovery ceremony.
- Batch independent read-only calls when useful. Stop reading once the next safe action or answer is grounded.
- Use semantic search for concepts and grep/name search for concrete identifiers. Symbol tools are optional aids, not write prerequisites.

Edits:
- apply_edit performs localized exact replacements in an existing file. write_file creates a new file or intentionally replaces the complete contents of an existing fully-read file.
- apply_edit uses the exact current old_string and replacement new_string. old_string must be unique unless replace_all is true.
- The host enforces prior-read and staleness contracts. After a successful edit, the host marks the written content current; re-read only when new information is needed or the file changed externally.
- If an edit fails, use the returned diagnostics, inspect the affected current region when necessary, and retry with a corrected or more contextual old_string.

Commands and browser:
- execute_command is for finite CLI work, including official project generators, dependency installation, code generation, and verification. Declare intent and whether it writes the workspace; use non-interactive flags.
- In an empty workspace with an explicitly chosen ecosystem, prefer its official generator through execute_command over recreating generator-owned files with write_file.
- Background commands are for servers/watchers. Read their reported status and URL instead of guessing ports.
- Browser tools prove UI behavior; command output proves CLI state. Use the relevant surface for the claim.

Control:
- ask_question pauses the current native tool call. The user's answer returns as that call's tool result and the same conversation continues.
- submit_artifact exits plan mode when an implementation plan is ready for review.
- A non-empty user-facing assistant answer with no tool call is the normal stop. Completion is a host lifecycle event, not a model-facing tool call.
</tool_protocols>`;
