/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const ENTER_ALTERNATE_SCREEN = '\u001b[?1049h\u001b[?1007h\u001b[?1000h\u001b[?1006h\u001b[2J\u001b[H';
const LEAVE_ALTERNATE_SCREEN = '\u001b[?1006l\u001b[?1000l\u001b[?1007l\u001b[?25h\u001b[?1049l';
const CLEAR_SCREEN = '\u001b[2J\u001b[H';
const ENGINE_LOG_PREFIX = '[CleanSlateAgent]';
const SGR_MOUSE_EVENT = /^\u001b?\[<(\d+);\d+;\d+[Mm]$/;

export function isTerminalMouseEvent(input: string): boolean {
	return SGR_MOUSE_EVENT.test(input);
}

/** Returns -1 for wheel up, 1 for wheel down, and 0 for other input. */
export function terminalMouseWheelDirection(input: string): -1 | 0 | 1 {
	const match = SGR_MOUSE_EVENT.exec(input);
	if (!match) {
		return 0;
	}
	const button = Number(match[1]);
	if ((button & 64) === 0) {
		return 0;
	}
	switch (button & 3) {
		case 0: return -1;
		case 1: return 1;
		default: return 0;
	}
}

export function clearInteractiveScreen(output: NodeJS.WriteStream = process.stdout): void {
	if (output.isTTY) {
		output.write(CLEAR_SCREEN);
	}
}

export function enterInteractiveScreen(output: NodeJS.WriteStream = process.stdout): () => void {
	if (!output.isTTY) {
		return () => undefined;
	}
	output.write(ENTER_ALTERNATE_SCREEN);

	const originalLog = console.log;
	const originalInfo = console.info;
	const originalWarn = console.warn;
	const suppressEngineLog = (original: (...data: any[]) => void) => (...data: any[]) => {
		if (typeof data[0] === 'string' && data[0].startsWith(ENGINE_LOG_PREFIX)) {
			return;
		}
		original(...data);
	};
	console.log = suppressEngineLog(originalLog);
	console.info = suppressEngineLog(originalInfo);
	console.warn = suppressEngineLog(originalWarn);

	let disposed = false;
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		console.log = originalLog;
		console.info = originalInfo;
		console.warn = originalWarn;
		output.write(LEAVE_ALTERNATE_SCREEN);
	};
}
