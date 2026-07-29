/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILiveTurnSnapshot {
	reasoning: string;
	text: string;
}

export type LiveTextPhase = 'assistant' | 'commentary' | 'final_answer';

export class LiveTurnBuffer {
	private reasoning = '';
	private text = '';
	private textPhase: LiveTextPhase | undefined;

	appendReasoning(content: string): ILiveTurnSnapshot {
		this.reasoning += content;
		return this.snapshot();
	}

	appendText(content: string, phase: LiveTextPhase = 'assistant'): ILiveTurnSnapshot {
		if (this.text && this.textPhase && this.textPhase !== phase && !/\s$/.test(this.text) && !/^\s/.test(content)) {
			this.text += '\n\n';
		}
		this.text += content;
		this.textPhase = phase;
		return this.snapshot();
	}

	resetReasoning(): ILiveTurnSnapshot {
		this.reasoning = '';
		return this.snapshot();
	}

	resetText(): ILiveTurnSnapshot {
		this.text = '';
		this.textPhase = undefined;
		return this.snapshot();
	}

	flushWorking(): string {
		const working = this.text.trim();
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
		this.textPhase = undefined;
	}
}
