/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILiveTurnSnapshot {
	reasoning: string;
	text: string;
}

export class LiveTurnBuffer {
	private reasoning = '';
	private text = '';

	appendReasoning(content: string): ILiveTurnSnapshot {
		this.reasoning += content;
		return this.snapshot();
	}

	appendText(content: string): ILiveTurnSnapshot {
		this.text += content;
		return this.snapshot();
	}

	resetReasoning(): ILiveTurnSnapshot {
		this.reasoning = '';
		return this.snapshot();
	}

	resetText(): ILiveTurnSnapshot {
		this.text = '';
		return this.snapshot();
	}

	flushWorking(): string {
		const working = `${this.reasoning}${this.reasoning && this.text ? '\n\n' : ''}${this.text}`.trim();
		this.clear();
		return working;
	}

	finish(): { reasoning: string; answer: string } {
		const result = {
			reasoning: this.reasoning.trim(),
			answer: this.text.trim()
		};
		this.clear();
		return result;
	}

	snapshot(): ILiveTurnSnapshot {
		return { reasoning: this.reasoning, text: this.text };
	}

	private clear(): void {
		this.reasoning = '';
		this.text = '';
	}
}
