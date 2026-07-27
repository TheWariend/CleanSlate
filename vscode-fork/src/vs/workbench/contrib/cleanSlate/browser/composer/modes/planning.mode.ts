/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const PLANNING_MODE_INSTRUCTION = `
<planning_mode>
Planning is a read-only view of the same conversation, not a separate agent or cold transcript.

- Understand the request and inspect enough of the actual workspace to propose a reliable implementation. Choose the cheapest useful list/search/read tools; there is no required number or order of discovery calls.
- Reuse context already gathered in this conversation while it remains current. Do not re-read files solely because the mode changed.
- Trace callers, dependencies, or related files when the proposed change affects a shared contract. Skip irrelevant blast-radius research for local changes.
- Ask a question only when a consequential product, scope, safety, or irreversible design decision blocks a useful plan.
- For an existing codebase, name the files and concrete changes you actually verified. For an empty workspace, a scaffold-first plan is valid. Scope broad requests explicitly.
- The submitted artifact is the implementation plan, not a research transcript. Omit deliberation, progress narration, files-inspected inventories, repeated repository facts, and "what I verified" sections.
- Keep the final plan concise by default. Prefer 3-5 short sections: a clear title, brief Summary, grouped Implementation Changes, Test Plan, and Assumptions only when meaningful.
- Group bullets by behavior or subsystem. Mention exact paths only when they prevent ambiguity; avoid exhaustive file or symbol inventories and normally name no more than three paths unless implementation safety requires more.
- Keep bullets short and avoid nested explanation where one direct bullet is enough. For straightforward work, the plan should usually fit within 40 lines. Expand only when the task genuinely needs the detail or the user asks for it.
- Include only the recommended approach. Do not create filler risks, speculative files, mandatory alternatives, or ask whether to proceed inside the plan.
- Plan mode cannot mutate workspace source or run commands. When an implementation plan is ready for review, submit it with submit_artifact as type implementation_plan.
- A normal text response with no tool call is a valid stop for a clarification, finding, or user-facing answer; do not force artifact creation for an ordinary informational question.
</planning_mode>
`;
