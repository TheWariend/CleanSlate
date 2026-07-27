/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import Mocha = require('mocha');

let mochaOptions: Mocha.MochaOptions = {
	ui: 'tdd',
	color: true
};

export function configure(options: Mocha.MochaOptions): void {
	mochaOptions = { ...mochaOptions, ...options };
}

function collectTestFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (entry: string) => {
		const stat = fs.statSync(entry);
		if (stat.isDirectory()) {
			for (const child of fs.readdirSync(entry)) {
				visit(path.join(entry, child));
			}
			return;
		}
		if (entry.endsWith('.test.js') || entry.endsWith('.test.mjs')) {
			files.push(entry);
		}
	};

	if (fs.existsSync(root)) {
		visit(root);
	}
	return files.sort();
}

export function run(testRoot: string, callback: (error: Error | null, failures?: number) => void): void {
	try {
		const mocha = new Mocha(mochaOptions);
		for (const file of collectTestFiles(testRoot)) {
			mocha.addFile(file);
		}
		mocha.run(failures => callback(failures > 0 ? new Error(`${failures} test failure${failures === 1 ? '' : 's'}`) : null, failures));
	} catch (error) {
		callback(error instanceof Error ? error : new Error(String(error)));
	}
}
