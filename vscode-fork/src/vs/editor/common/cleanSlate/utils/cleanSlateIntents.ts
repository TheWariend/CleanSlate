export type CleanSlateIntent =
	| 'rewrite'
	| 'fix'
	| 'simplify'
	| 'explain';

export function buildPrompt(intent: CleanSlateIntent | string, text: string): string {
	if (intent === 'rewrite' || intent === 'fix' || intent === 'simplify' || intent === 'explain') {
		switch (intent) {
			case 'rewrite':
				return `
You are an AI text editor.
Task: Rewrite the input text with minimal changes.
Rules:
- Output ONLY the rewritten text.
- Do NOT repeat the input if no changes are needed.
- No conversational text.
- No markdown formatting.

Input:
${text}

Output:
`;

			case 'fix':
				return `
Fix grammar and spelling errors.
Do not change wording unless necessary.
Return ONLY the corrected text.

Text:
${text}
`;

			case 'simplify':
				return `
Simplify the text while preserving meaning.
Return ONLY the simplified text.

Text:
${text}
`;

			case 'explain':
				return `
Explain the following text clearly and concisely.

Text:
${text}
`;
		}
	}

	// Custom instruction
	return `
You are an AI text editor.
Task: ${intent}

Rules:
- Output ONLY the result.
- Do NOT repeat the input.
- Do NOT output "Output:" or "Input:".

Input:
${text}

Output:
`;
}
