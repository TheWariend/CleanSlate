/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const ENTER_ALTERNATE_SCREEN = '\u001b[?1006l\u001b[?1000l\u001b[?1049h\u001b[?1007h\u001b[2J\u001b[H';
const LEAVE_ALTERNATE_SCREEN = '\u001b[?1006l\u001b[?1000l\u001b[?1007l\u001b[?25h\u001b[?1049l';
const CLEAR_SCREEN = '\u001b[2J\u001b[H';
// Every runtime log prefix, not just the agent loop: [CleanSlateEdit], [CleanSlateService] and
// [CleanSlateSync] reach the same console and corrupt Ink's frame in exactly the same way.
const ENGINE_LOG_PREFIX_RE = /^\[CleanSlate[A-Za-z]*\]/;
const SGR_MOUSE_EVENT = /^\u001b?\[<(\d+);(\d+);(\d+)([Mm])$/;

export interface ITerminalMouseEvent {
	button: number;
	x: number;
	y: number;
	action: 'press' | 'release' | 'wheel';
	wheelDirection: -1 | 0 | 1;
}

export function terminalMouseEvent(input: string): ITerminalMouseEvent | undefined {
	const match = SGR_MOUSE_EVENT.exec(input);
	if (!match) {
		return undefined;
	}
	const button = Number(match[1]);
	const wheel = (button & 64) !== 0;
	const wheelDirection = wheel
		? (button & 3) === 0 ? -1 : (button & 3) === 1 ? 1 : 0
		: 0;
	return {
		button: button & 3,
		x: Number(match[2]),
		y: Number(match[3]),
		action: wheel ? 'wheel' : match[4] === 'm' ? 'release' : 'press',
		wheelDirection
	};
}

export function isTerminalMouseEvent(input: string): boolean {
	return SGR_MOUSE_EVENT.test(input);
}

/** Returns -1 for wheel up, 1 for wheel down, and 0 for other input. */
export function terminalMouseWheelDirection(input: string): -1 | 0 | 1 {
	return terminalMouseEvent(input)?.wheelDirection ?? 0;
}

export function clearInteractiveScreen(output: NodeJS.WriteStream = process.stdout): void {
	if (output.isTTY) {
		output.write(CLEAR_SCREEN);
	}
}

/**
 * Silences the runtime's `[CleanSlateAgent] …` console output for the lifetime of an
 * interactive render. Ink owns the cursor while it draws, so an unrelated `console.log`
 * lands mid-frame: it scrolls the live region, strands rows the renderer still believes
 * it owns, and corrupts the layout. Returns a restore function.
 *
 * Kept separate from {@link enterInteractiveScreen} because the main chat TUI needs the
 * log suppression WITHOUT the alternate screen (the alternate screen has no scrollback,
 * which is what put earlier conversation out of reach).
 *
 * Install this AFTER Ink's `render()`: Ink's own `patchConsole` replaces the console
 * methods when its instance is constructed, so suppressing first would simply be
 * overwritten and the engine lines would surface above the live frame.
 */
export function suppressEngineLogs(): () => void {
	const originalLog = console.log;
	const originalInfo = console.info;
	const originalWarn = console.warn;
	const suppressEngineLog = (original: (...data: any[]) => void) => (...data: any[]) => {
		if (typeof data[0] === 'string' && ENGINE_LOG_PREFIX_RE.test(data[0])) {
			return;
		}
		original(...data);
	};
	console.log = suppressEngineLog(originalLog);
	console.info = suppressEngineLog(originalInfo);
	console.warn = suppressEngineLog(originalWarn);

	let restored = false;
	return () => {
		if (restored) {
			return;
		}
		restored = true;
		console.log = originalLog;
		console.info = originalInfo;
		console.warn = originalWarn;
	};
}

export function enterInteractiveScreen(output: NodeJS.WriteStream = process.stdout): () => void {
	if (!output.isTTY) {
		return () => undefined;
	}
	output.write(ENTER_ALTERNATE_SCREEN);

	// Terminal resizes invalidate every cursor position retained by the renderer.
	// Clear the alternate screen before Ink handles the resize so its next frame is
	// painted onto a known blank viewport instead of being diffed over stale rows.
	const handleResize = () => output.write(CLEAR_SCREEN);
	output.on('resize', handleResize);

	const restoreEngineLogs = suppressEngineLogs();

	let disposed = false;
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		output.off('resize', handleResize);
		restoreEngineLogs();
		output.write(LEAVE_ALTERNATE_SCREEN);
	};
}
