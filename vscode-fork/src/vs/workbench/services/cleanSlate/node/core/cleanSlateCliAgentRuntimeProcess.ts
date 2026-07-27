/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as readline from 'readline';
import type { CleanSlateCliAgentRequest, CleanSlateCliAgentResponse } from './cleanSlateCliAgentProtocol.js';
import { CleanSlateCliAgentRuntime } from './cleanSlateCliAgentRuntime.js';

const runtime = new CleanSlateCliAgentRuntime();
const activeExecutions = new Map<number, AbortController>();

function send(message: CleanSlateCliAgentResponse): void {
	try {
		process.stdout.write(`${JSON.stringify(message)}\n`);
	} catch (error) {
		process.stderr.write(`[CleanSlateCliAgentRuntime] Failed to write response: ${error instanceof Error ? error.message : String(error)}\n`);
	}
}

function sendError(id: number, error: unknown): void {
	send({
		id,
		type: 'error',
		error: error instanceof Error ? error.message : String(error)
	});
}

async function handleRequest(request: CleanSlateCliAgentRequest): Promise<void> {
	switch (request.type) {
		case 'execute': {
			const controller = new AbortController();
			activeExecutions.set(request.id, controller);
			try {
				const result = await runtime.executeCommand(
					request.options,
					event => send({ id: request.id, type: 'event', event }),
					controller.signal
				);
				send({ id: request.id, type: 'executeResult', result });
			} catch (error) {
				sendError(request.id, error);
			} finally {
				activeExecutions.delete(request.id);
			}
			break;
		}
		case 'startBackground':
			try {
				const result = await runtime.startBackgroundCommand(request.options);
				send({ id: request.id, type: 'backgroundResult', result });
			} catch (error) {
				sendError(request.id, error);
			}
			break;
		case 'stopBackground':
			try {
				const result = await runtime.stopBackgroundCommand(request.processId);
				send({ id: request.id, type: 'stopResult', result });
			} catch (error) {
				sendError(request.id, error);
			}
			break;
		case 'getBackground':
			try {
				const result = await runtime.getBackgroundCommand(request.processId);
				send({ id: request.id, type: 'backgroundResult', result });
			} catch (error) {
				sendError(request.id, error);
			}
			break;
		case 'listBackground':
			try {
				const result = await runtime.listBackgroundCommands();
				send({ id: request.id, type: 'backgroundList', result });
			} catch (error) {
				sendError(request.id, error);
			}
			break;
		case 'cancel': {
			const controller = activeExecutions.get(request.targetId);
			if (controller) {
				controller.abort();
			}
			send({ id: request.id, type: 'cancelled' });
			break;
		}
		case 'shutdown':
			runtime.dispose();
			send({ id: request.id, type: 'shutdownAck' });
			process.exit(0);
	}
}

const reader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity
});

reader.on('line', line => {
	const trimmed = line.trim();
	if (!trimmed) {
		return;
	}
	let request: CleanSlateCliAgentRequest;
	try {
		request = JSON.parse(trimmed);
	} catch (error) {
		process.stderr.write(`[CleanSlateCliAgentRuntime] Invalid request JSON: ${error instanceof Error ? error.message : String(error)}\n`);
		return;
	}
	void handleRequest(request);
});

const shutdown = () => {
	runtime.dispose();
	process.exit(0);
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.once('disconnect', shutdown);
