/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CleanSlateRenderPayloadCodec } from '../../browser/chat/runtime/cleanSlateRenderPayloadCodec.js';
import { InteractionBlock } from '../../browser/chat/types/cleanSlateChatTypes.js';

suite('CleanSlateRenderPayloadCodec', () => {
	test('keeps complete live terminal output', () => {
		const codec = new CleanSlateRenderPayloadCodec();
		const output = 'terminal-output\n'.repeat(10_000);

		assert.strictEqual(codec.clampLiveTerminalOutput(output), output);
	});

	test('keeps complete terminal commands and output in persisted render state', () => {
		const codec = new CleanSlateRenderPayloadCodec();
		const command = `node -e "${'x'.repeat(1_000)}"`;
		const output = 'terminal-output\n'.repeat(10_000);
		const timeline: InteractionBlock[] = [{
			id: 'terminal-1',
			type: 'terminal',
			command,
			output,
			exitCode: 0,
			isStreaming: false
		}];

		const payload = codec.buildPersistedRenderPayload({}, timeline, {
			[command]: { output, exitCode: 0 }
		}, [command], 'execute_command');

		assert.ok(payload);
		const parsed = JSON.parse(payload!);
		const terminalBlock = parsed.timeline.find((block: InteractionBlock) => block.type === 'terminal');
		assert.strictEqual(terminalBlock.command, command);
		assert.strictEqual(terminalBlock.output, output);
		assert.strictEqual(terminalBlock.output.includes('truncated'), false);
	});
});
