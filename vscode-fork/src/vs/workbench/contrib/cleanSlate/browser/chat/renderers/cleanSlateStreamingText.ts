/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IStreamingTextState {
	value: string;
	committed: Text;
	pending: Array<{ element: HTMLSpanElement; animation: Animation; finished: boolean }>;
}

/** Reveals only newly arrived text. No character queue, layout measurement, or
 * animation of text the user has already read. Settled chunks fold into one node. */
export class CleanSlateStreamingText {
	private readonly states = new WeakMap<HTMLElement, IStreamingTextState>();
	private readonly animations = new Set<Animation>();

	update(target: HTMLElement, value: string, animate: boolean): void {
		let state = this.states.get(target);
		if (state?.value === value) { return; }
		if (!state || !value.startsWith(state.value)) {
			for (const chunk of state?.pending ?? []) { chunk.animation.cancel(); this.animations.delete(chunk.animation); }
			const committed = target.ownerDocument.createTextNode('');
			target.replaceChildren(committed);
			state = { value: '', committed, pending: [] };
			this.states.set(target, state);
		}
		const delta = value.slice(state.value.length);
		state.value = value;
		const win = target.ownerDocument.defaultView;
		if (!animate || !delta.trim() || win?.matchMedia('(prefers-reduced-motion: reduce)').matches || target.closest('.monaco-reduce-motion') || !target.animate) {
			// Preserve ordering even when whitespace arrives during a fade.
			const last = state.pending.at(-1);
			if (last) { last.element.append(delta); }
			else { state.committed.appendData(delta); }
			return;
		}
		const element = target.ownerDocument.createElement('span');
		element.className = 'cleanSlate-stream-chunk';
		element.textContent = delta;
		target.appendChild(element);
		const animation = element.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
		const chunk = { element, animation, finished: false };
		state.pending.push(chunk);
		this.animations.add(animation);
		animation.onfinish = () => {
			this.animations.delete(animation);
			chunk.finished = true;
			while (state!.pending[0]?.finished) {
				const first = state!.pending.shift()!;
				state!.committed.appendData(first.element.textContent || '');
				first.element.remove();
			}
		};
	}

	dispose(): void {
		for (const animation of this.animations) { animation.finish(); }
		this.animations.clear();
	}
}
