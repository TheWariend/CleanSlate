/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDiffSummary {
	readonly filename: string;
	readonly diff: string;
}

export function buildCommitMessagePrompt(diffSummaries: IDiffSummary[]): string {
	const diffText = diffSummaries
		.map(s => `--- ${s.filename} ---\n${s.diff}`)
		.join('\n\n');

	return `Generate a concise and descriptive commit message based on the following code changes.

Follow the Conventional Commits standard:
- feat: for a new feature
- fix: for a bug fix
- refactor: for code changes that neither fix a bug nor add a feature
- chore: for mundane tasks or maintenance
- docs: for documentation changes
- style: for formatting/linting changes
- test: for adding or correcting tests

Constraints:
1. Output ONLY the commit message text.
2. Do NOT use markdown or any other explanation.
3. Keep the first line under 72 characters if possible.
4. Use the information in the diffs below to understand what exactly was changed.

Code Changes:
${diffText}`;
}
