/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import es from 'event-stream';
import * as path from 'path';
import { createReporter } from './reporter.ts';

const root = path.dirname(path.dirname(import.meta.dirname));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const defaultDiagnosticsTailLines = 40;

type TsgoOutputStream = 'stdout' | 'stderr';

export interface ITsgoSpawnOptions {
	readonly label?: string;
	readonly diagnosticsTailLines?: number;
}

function pushTail(lines: string[], value: string, maxLines: number): void {
	lines.push(value);

	if (lines.length > maxLines) {
		lines.splice(0, lines.length - maxLines);
	}
}

export function spawnTsgo(projectPath: string, onComplete?: () => Promise<void> | void, options?: ITsgoSpawnOptions): Promise<void> {
	const reporter = createReporter('extensions');
	let report: NodeJS.ReadWriteStream | undefined;
	const diagnosticsTailLines = Math.max(options?.diagnosticsTailLines ?? defaultDiagnosticsTailLines, 1);
	const resolvedProjectPath = path.isAbsolute(projectPath) ? projectPath : path.join(root, projectPath);

	const beginReport = (emitError: boolean) => {
		if (report) {
			report.end();
		}
		report = reporter.end(emitError);
	};

	const endReport = () => {
		if (!report) {
			return;
		}
		report.end();
		report = undefined;
	};

	const args = ['tsgo', '--project', resolvedProjectPath, '--pretty', 'false', '--sourceMap', '--inlineSources'];
	const outputTail: string[] = [];
	const buffers: Record<TsgoOutputStream, string> = { stdout: '', stderr: '' };

	beginReport(false);

	const child = cp.spawn(npx, args, {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: true
	});

	const handleLine = (line: string) => {
		const trimmed = line.replace(ansiRegex, '').trim();
		if (!trimmed) {
			return;
		}
		if (/Starting compilation|File change detected/i.test(trimmed)) {
			beginReport(false);
			return;
		}
		if (/Compilation complete/i.test(trimmed)) {
			endReport();
			return;
		}

		const match = /(.*\(\d+,\d+\): )(.*: )(.*)/.exec(trimmed);

		if (match) {
			const fullpath = path.isAbsolute(match[1]) ? match[1] : path.join(root, match[1]);
			const message = match[3];
			reporter(fullpath + message);
		} else {
			reporter(trimmed);
		}
	};

	const captureLine = (stream: TsgoOutputStream, line: string) => {
		const normalized = line.replace(/\r$/, '');
		const stripped = normalized.replace(ansiRegex, '').trim();
		if (!stripped) {
			return;
		}

		pushTail(outputTail, `[${stream}] ${stripped}`, diagnosticsTailLines);
	};

	const handleData = (stream: TsgoOutputStream) => (data: Buffer) => {
		buffers[stream] += data.toString('utf8');
		const lines = buffers[stream].split(/\r?\n/);
		buffers[stream] = lines.pop() ?? '';

		for (const line of lines) {
			captureLine(stream, line);
			handleLine(line);
		}
	};

	const flushBuffer = (stream: TsgoOutputStream) => {
		const line = buffers[stream];
		if (!line.trim()) {
			return;
		}

		captureLine(stream, line);
		handleLine(line);
	};

	const renderFailureMessage = (code: number | null, reason?: string) => {
		const relativeProjectPath = path.relative(root, resolvedProjectPath);
		const target = options?.label ? `${options.label} (${relativeProjectPath})` : relativeProjectPath;
		const command = `${npx} ${args.join(' ')}`;
		const output = outputTail.length > 0 ? outputTail.join('\n') : '<no stdout/stderr output captured>';
		const details = [
			`tsgo exited with code ${code ?? 'unknown'}`,
			`target: ${target}`,
			`cwd: ${root}`,
			`command: ${command}`,
			`recent output:`,
			output
		];
		if (reason) {
			details.splice(1, 0, `reason: ${reason}`);
		}
		return details.join('\n');
	};

	child.stdout?.on('data', handleData('stdout'));
	child.stderr?.on('data', handleData('stderr'));

	const done = new Promise<void>((resolve, reject) => {
		child.on('exit', code => {
			flushBuffer('stdout');
			flushBuffer('stderr');
			endReport();
			if (code === 0) {
				Promise.resolve(onComplete?.()).then(() => resolve(), reject);
				return;
			}
			reject(new Error(renderFailureMessage(code)));
		});
		child.on('error', err => {
			flushBuffer('stdout');
			flushBuffer('stderr');
			endReport();
			reject(new Error(renderFailureMessage(null, err.message)));
		});
	});

	return done;
}

export function createTsgoStream(projectPath: string, onComplete?: () => Promise<void> | void, options?: ITsgoSpawnOptions): NodeJS.ReadWriteStream {
	const stream = es.through();

	spawnTsgo(projectPath, onComplete, options).then(() => {
		stream.emit('end');
	}).catch(() => {
		// Errors are already reported by spawnTsgo via the reporter.
		// Don't emit 'error' on the stream as that would exit the watch process.
		stream.emit('end');
	});

	return stream;
}
