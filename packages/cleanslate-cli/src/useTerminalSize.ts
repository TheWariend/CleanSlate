/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';

export interface ITerminalSize {
	columns: number;
	rows: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 30;

function readSize(stream: NodeJS.WriteStream): ITerminalSize {
	return {
		columns: Math.max(20, stream.columns ?? DEFAULT_COLUMNS),
		rows: Math.max(1, stream.rows ?? DEFAULT_ROWS)
	};
}

/**
 * Terminal dimensions, as React state.
 *
 * Reading `stdout.columns` during render is not enough: the value changes
 * without React knowing, so no re-render happens and the frame is never
 * repainted. That is what made the UI go blank after a resize — the alternate
 * screen was cleared, but nothing drew onto it, because Ink diffs against its
 * own model of the screen and that model still matched the frame it had
 * already painted.
 *
 * Subscribing here turns a resize into a state change, which re-renders and so
 * gives Ink a frame to paint.
 */
export function useTerminalSize(stream: NodeJS.WriteStream): ITerminalSize {
	const [size, setSize] = useState<ITerminalSize>(() => readSize(stream));

	useEffect(() => {
		if (!stream.isTTY) {
			return;
		}

		const onResize = () => {
			const next = readSize(stream);
			// Only update on a real change: some terminals emit `resize`
			// repeatedly while a drag is in progress, and re-rendering on every
			// one of them makes the drag visibly stutter.
			setSize(current =>
				current.columns === next.columns && current.rows === next.rows ? current : next
			);
		};

		stream.on('resize', onResize);
		// The terminal may have changed between the initial state and this
		// effect running.
		onResize();

		return () => {
			stream.off('resize', onResize);
		};
	}, [stream]);

	return size;
}
