/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.window ??= globalThis;
globalThis.window.location ??= { href: 'http://localhost/' };
globalThis.HTMLElement ??= class HTMLElement { };
globalThis.Element ??= globalThis.HTMLElement;
globalThis.SVGElement ??= class SVGElement extends globalThis.Element { };
globalThis.customElements ??= { define() { }, get() { return undefined; } };

function collectTestFiles(root) {
	const files = [];
	const visit = entry => {
		const stat = fs.statSync(entry);
		if (stat.isDirectory()) {
			for (const child of fs.readdirSync(entry)) {
				visit(path.join(entry, child));
			}
			return;
		}
		if (entry.endsWith('.test.js')) {
			files.push(entry);
		}
	};

	if (fs.existsSync(root)) {
		visit(root);
	}
	return files.sort();
}

const root = path.resolve('out/vs/workbench/contrib/cleanSlate/test');
Promise.all(collectTestFiles(root).map(file => import(pathToFileURL(file).href))).then(() => {
	if (typeof global.run === 'function') {
		global.run();
	}
}).catch(error => {
	setTimeout(() => { throw error; }, 0);
});
