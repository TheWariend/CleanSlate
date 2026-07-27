/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IAnsiRgbColor {
	readonly kind: 'rgb';
	readonly red: number;
	readonly green: number;
	readonly blue: number;
}

interface IAnsiThemeColor {
	readonly kind: 'theme';
	readonly index: number;
}

type AnsiColor = IAnsiRgbColor | IAnsiThemeColor;

interface IAnsiStyleState {
	foreground?: AnsiColor;
	background?: AnsiColor;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	inverse?: boolean;
	hidden?: boolean;
	strikethrough?: boolean;
}

const ANSI_THEME_COLOR_NAMES = [
	'Black',
	'Red',
	'Green',
	'Yellow',
	'Blue',
	'Magenta',
	'Cyan',
	'White',
	'BrightBlack',
	'BrightRed',
	'BrightGreen',
	'BrightYellow',
	'BrightBlue',
	'BrightMagenta',
	'BrightCyan',
	'BrightWhite'
] as const;

// Match OSC sequences and CSI sequences. Only SGR (CSI ... m) changes
// presentation; the remaining terminal-control sequences are discarded.
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)|(?:\u001b\[|\u009b)([0-?]*)([ -/]*)([@-~])/g;

export function renderAnsiToHtml(value: string): string {
	const state: IAnsiStyleState = {};
	const parts: string[] = [];
	let textStart = 0;
	ANSI_SEQUENCE.lastIndex = 0;

	for (let match = ANSI_SEQUENCE.exec(value); match; match = ANSI_SEQUENCE.exec(value)) {
		parts.push(renderText(value.slice(textStart, match.index), state));
		if (match[3] === 'm') {
			applySgr(match[1] ?? '', state);
		}
		textStart = match.index + match[0].length;
	}

	parts.push(renderText(value.slice(textStart), state));
	return parts.join('');
}

function applySgr(parameters: string, state: IAnsiStyleState): void {
	const codes = (parameters.length > 0 ? parameters.split(';') : ['0'])
		.map(parameter => parameter.length === 0 ? 0 : Number(parameter))
		.filter(Number.isFinite);

	for (let index = 0; index < codes.length; index++) {
		const code = codes[index];
		if (code === 0) {
			resetState(state);
		} else if (code === 1) {
			state.bold = true;
		} else if (code === 2) {
			state.dim = true;
		} else if (code === 3) {
			state.italic = true;
		} else if (code === 4) {
			state.underline = true;
		} else if (code === 7) {
			state.inverse = true;
		} else if (code === 8) {
			state.hidden = true;
		} else if (code === 9) {
			state.strikethrough = true;
		} else if (code === 22) {
			state.bold = false;
			state.dim = false;
		} else if (code === 23) {
			state.italic = false;
		} else if (code === 24) {
			state.underline = false;
		} else if (code === 27) {
			state.inverse = false;
		} else if (code === 28) {
			state.hidden = false;
		} else if (code === 29) {
			state.strikethrough = false;
		} else if (code >= 30 && code <= 37) {
			state.foreground = themeColor(code - 30);
		} else if (code === 38) {
			const extended = readExtendedColor(codes, index);
			if (extended.color) {
				state.foreground = extended.color;
			}
			index += extended.consumed;
		} else if (code === 39) {
			state.foreground = undefined;
		} else if (code >= 40 && code <= 47) {
			state.background = themeColor(code - 40);
		} else if (code === 48) {
			const extended = readExtendedColor(codes, index);
			if (extended.color) {
				state.background = extended.color;
			}
			index += extended.consumed;
		} else if (code === 49) {
			state.background = undefined;
		} else if (code >= 90 && code <= 97) {
			state.foreground = themeColor(code - 90 + 8);
		} else if (code >= 100 && code <= 107) {
			state.background = themeColor(code - 100 + 8);
		}
	}
}

function readExtendedColor(codes: number[], index: number): { color?: AnsiColor; consumed: number } {
	const mode = codes[index + 1];
	if (mode === 5 && Number.isFinite(codes[index + 2])) {
		return { color: indexedColor(codes[index + 2]), consumed: 2 };
	}

	if (mode === 2
		&& Number.isFinite(codes[index + 2])
		&& Number.isFinite(codes[index + 3])
		&& Number.isFinite(codes[index + 4])) {
		return {
			color: rgbColor(codes[index + 2], codes[index + 3], codes[index + 4]),
			consumed: 4
		};
	}

	return { consumed: 0 };
}

function indexedColor(index: number): AnsiColor {
	const normalized = Math.max(0, Math.min(255, Math.round(index)));
	if (normalized < ANSI_THEME_COLOR_NAMES.length) {
		return themeColor(normalized);
	}

	if (normalized >= 232) {
		const channel = 8 + (normalized - 232) * 10;
		return rgbColor(channel, channel, channel);
	}

	const cubeIndex = normalized - 16;
	const levels = [0, 95, 135, 175, 215, 255];
	const red = levels[Math.floor(cubeIndex / 36) % 6];
	const green = levels[Math.floor(cubeIndex / 6) % 6];
	const blue = levels[cubeIndex % 6];
	return rgbColor(red, green, blue);
}

function themeColor(index: number): IAnsiThemeColor {
	return { kind: 'theme', index };
}

function rgbColor(red: number, green: number, blue: number): IAnsiRgbColor {
	return {
		kind: 'rgb',
		red: clampColorChannel(red),
		green: clampColorChannel(green),
		blue: clampColorChannel(blue)
	};
}

function clampColorChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function resetState(state: IAnsiStyleState): void {
	state.foreground = undefined;
	state.background = undefined;
	state.bold = false;
	state.dim = false;
	state.italic = false;
	state.underline = false;
	state.inverse = false;
	state.hidden = false;
	state.strikethrough = false;
}

function renderText(value: string, state: IAnsiStyleState): string {
	const escaped = escapeHtml(stripUnsupportedControlCharacters(value));
	if (!escaped) {
		return '';
	}

	let foreground = state.foreground ? colorValue(state.foreground) : undefined;
	let background = state.background ? colorValue(state.background) : undefined;
	if (state.inverse) {
		[foreground, background] = [
			background ?? 'var(--vscode-terminal-background, var(--vscode-editor-background))',
			foreground ?? 'var(--vscode-terminal-foreground, var(--vscode-foreground))'
		];
	}

	const declarations: string[] = [];
	if (foreground) {
		declarations.push(`color: ${foreground}`);
	}
	if (background) {
		declarations.push(`background-color: ${background}`);
	}
	if (state.bold) {
		declarations.push('font-weight: 700');
	}
	if (state.dim) {
		declarations.push('opacity: 0.72');
	}
	if (state.italic) {
		declarations.push('font-style: italic');
	}
	const decorations = [state.underline ? 'underline' : '', state.strikethrough ? 'line-through' : ''].filter(Boolean);
	if (decorations.length > 0) {
		declarations.push(`text-decoration: ${decorations.join(' ')}`);
	}
	if (state.hidden) {
		declarations.push('visibility: hidden');
	}

	return declarations.length > 0
		? `<span style="${declarations.join('; ')}">${escaped}</span>`
		: escaped;
}

function colorValue(color: AnsiColor): string {
	if (color.kind === 'rgb') {
		return `rgb(${color.red}, ${color.green}, ${color.blue})`;
	}
	const name = ANSI_THEME_COLOR_NAMES[color.index] ?? ANSI_THEME_COLOR_NAMES[7];
	return `var(--vscode-terminal-ansi${name})`;
}

function stripUnsupportedControlCharacters(value: string): string {
	// Preserve tabs and line feeds; discard remaining C0 controls that have no
	// useful static representation in a transcript.
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
