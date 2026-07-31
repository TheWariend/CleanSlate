/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Paced streaming reveal, shared by every front-end.
 *
 * Providers do not deliver text at a readable cadence. Measured against a proxied
 * `claude-sonnet-4.5`, 24 of 27 raw SSE deltas arrived in the same millisecond as the one before
 * them: the response is buffered upstream and flushed in bursts. A surface that renders each
 * delta as it lands therefore shows a paragraph appearing all at once rather than typing out.
 *
 * The reveal is expressed as a typing *rate* over elapsed wall time rather than a fixed number of
 * characters per tick, so a late or dropped frame catches up on its own instead of falling
 * permanently behind the stream.
 */

export const REVEAL_TICK_MS = 24;

/**
 * Characters per second. The rate rises with the backlog so a long burst drains quickly, but
 * grows sub-linearly (square root) so the text keeps a readable cadence rather than snapping to
 * the end. Tune `REVEAL_CEILING_CPS` for the fastest acceptable reveal.
 */
export const REVEAL_FLOOR_CPS = 45;
export const REVEAL_CEILING_CPS = 320;
export const REVEAL_BACKLOG_GAIN = 17;
/** How far the cut may retreat to land on a word boundary. */
export const REVEAL_BOUNDARY_REACH = 12;

export function revealRateForBacklog(backlog: number): number {
	return Math.min(REVEAL_CEILING_CPS, REVEAL_FLOOR_CPS + Math.sqrt(Math.max(0, backlog)) * REVEAL_BACKLOG_GAIN);
}

/**
 * Cut point for this frame: advance by rate × elapsed time, then walk back to the nearest
 * preceding whitespace so the visible text never ends inside a word. Falls through to the raw
 * cut when no boundary is close enough.
 */
export function revealCutPoint(text: string, shown: number, elapsedMs: number): number {
	const backlog = text.length - shown;
	if (backlog <= 0) {
		return text.length;
	}
	const seconds = Math.max(elapsedMs, 1) / 1000;
	const advance = Math.max(1, Math.round(revealRateForBacklog(backlog) * seconds));
	const cut = Math.min(text.length, shown + advance);
	if (cut >= text.length) {
		return text.length;
	}
	const floor = Math.max(shown + 1, cut - REVEAL_BOUNDARY_REACH);
	for (let i = cut; i > floor; i--) {
		const ch = text.charCodeAt(i - 1);
		// space, tab, newline, carriage return
		if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
			return i;
		}
	}
	return cut;
}

/**
 * Tracks how much of a growing string has been revealed. A non-append change (an edit or reset)
 * invalidates the paced reveal, so the caller should start a fresh tracker.
 */
export class CleanSlateStreamReveal {
	private shown = 0;
	private lastTickAt = Date.now();

	/** True when `text` still continues what has been revealed so far. */
	isContinuationOf(text: string, previous: string): boolean {
		return text.startsWith(previous);
	}

	/** Reveals the next slice of `text`, or all of it when `flush` is set. */
	advance(text: string, flush = false): string {
		const now = Date.now();
		if (flush) {
			this.shown = text.length;
			this.lastTickAt = now;
			return text;
		}
		if (this.shown > text.length) {
			this.shown = 0;
		}
		this.shown = revealCutPoint(text, this.shown, now - this.lastTickAt);
		this.lastTickAt = now;
		return text.slice(0, this.shown);
	}

	/** True when everything delivered so far has been revealed. */
	hasCaughtUp(text: string): boolean {
		return this.shown >= text.length;
	}

	reset(): void {
		this.shown = 0;
		this.lastTickAt = Date.now();
	}
}
