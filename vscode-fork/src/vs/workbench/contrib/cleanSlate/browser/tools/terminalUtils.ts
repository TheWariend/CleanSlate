/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { CleanSlateToolContext } from './types.js';

export const AGENT_TERMINAL_NAME = 'CleanSlate Agent';

export async function waitForTerminalProcessReady(terminal: ITerminalInstance): Promise<void> {
    if (typeof terminal.processId === 'number') {
        return;
    }

    await Promise.race([
        Event.toPromise(Event.once(terminal.onProcessIdReady)).then(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 5000))
    ]);
}

export async function getOrCreateAgentTerminal(context: CleanSlateToolContext): Promise<ITerminalInstance> {
    const existing = context.terminalService.instances.find((terminal: ITerminalInstance) =>
        !terminal.isDisposed &&
        terminal.shellLaunchConfig.name === AGENT_TERMINAL_NAME &&
        terminal.shellLaunchConfig.isFeatureTerminal
    );
    if (existing) {
        await waitForTerminalProcessReady(existing);
        return existing;
    }

    const terminal = await context.terminalService.createTerminal({
        config: {
            name: AGENT_TERMINAL_NAME,
            hideFromUser: true,
            forcePersist: true,
            isFeatureTerminal: true,
            useShellEnvironment: true
        }
    } as any);

    await waitForTerminalProcessReady(terminal);
    return terminal;
}

export function normalizeTerminalOutput(text: string): string {
    //  Normalize line endings to LF
    const normalized = text.replace(/\r\n/g, '\n');

    // Process carriage returns within each line to simulate overwriting
    const lines = normalized.split('\n');
    const processedLines = lines.map(line => {
        if (!line.includes('\r')) {
            return line;
        }

        const segments = line.split('\r');
        let result = '';
        for (const segment of segments) {
            // Standard terminal behavior: \r moves cursor to column 0.
            // Text after \r overwrites text before it.
            if (segment.length >= result.length) {
                result = segment;
            } else {
                result = segment + result.slice(segment.length);
            }
        }
        return result;
    });

    return processedLines.join('\n');
}

/**
 * Strip ANSI escape codes from a string (Duplicate of utils.ts to avoid circular deps if any)
 */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|(?:\u001b\u009b]|\u001b\]).*?(?:\u0007|\u001b\\)/g, '');
}

/**
 * Detects if the given terminal output appears to be awaiting user input.
 */
export function isAwaitingInput(rawOutput: string): boolean {
    const normalized = normalizeTerminalOutput(rawOutput);
    const stripped = stripAnsi(normalized).trim();
    if (!stripped) return false;

    // We look at the very end of the output (last 150 chars)
    const tail = stripped.slice(-150);

    const patterns = [
        /\? \s*.*$/,            // Generic prompt prefix '? '
        /[\[\(][yYnN/]+[\]\)]/i,  // [y/n] or (y/n) anywhere in the tail
        /password:/i,           // Case-insensitive password prompt
        /input:?/i,             // "input:" or "input"
        /confirm\??/i,          // "confirm" or "confirm?"
        /proceed\??/i,          // "proceed?"
        /:\s*[›»>]/,            // Colon + chevron
        /:\s*$/,                 // Generic trailing colon
        /Package name:/i,       // Specific Vite/scaffold prompt
        /\b(?:more|next|quit)\b[\s\.]{0,3}$/i, // --More-- or similar pagers
        /[›»>]\s*(?:Use arrow keys|Return to submit)/i // Interactive selection hints
    ];

    return patterns.some(p => p.test(tail));
}

/**
 * Detects if the given terminal output appears to end with a shell prompt,
 * suggesting that the previous command has finished.
 */
export function isShellPrompt(rawOutput: string): boolean {
    const normalized = normalizeTerminalOutput(rawOutput);
    const stripped = stripAnsi(normalized).trim();
    if (!stripped) return false;

    // Use a small tail for prompt detection to avoid matches deep in command output
    const tail = stripped.slice(-30);

    const promptPatterns = [
        /(?:^|\n)[^\n]*[\$#%]\s*$/,       // Standard POSIX prompts: $, #, %
        /(?:^|\n)[^\n]*>\s*$/,            // Windows CMD/PS prompt or some chevrons
        /(?:^|\n)[^\n]*[»›]\s*$/,          // Common modern shell chevrons
        /subsh>\s*$/,                     // Custom subshell prompt seen in user env
        /\(.*\)\s*[\$#%>\-]\s*$/,         // Prompts ending in (cwd) $ or similar
        /\|\s*\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M\s*$/i // Timestamped prompts: system | 03:45:58 AM
    ];

    return promptPatterns.some(p => p.test(tail));
}
