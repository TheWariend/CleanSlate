// Scoped mocha runner for the cleanSlate suite.
// Loads the already-compiled tests from out/ and drives them through mocha's
// tdd interface, with the minimal DOM shims the browser-layer modules touch.
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const FORK = '/Users/mohammedmazin/WARIEND/CleanSlate/vscode-fork';
// Resolve mocha out of the fork's node_modules — this runner lives outside it.
const Mocha = (await import(pathToFileURL(path.join(FORK, 'node_modules/mocha/index.js')).href)).default;
const TESTDIR = path.join(FORK, 'out/vs/workbench/contrib/cleanSlate/test/common');

// --- DOM shims -----------------------------------------------------------
// Enough of a browser for modules that reach for globals at import time.
const noop = () => { };
const el = () => ({
	style: {}, classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
	appendChild: noop, removeChild: noop, remove: noop, setAttribute: noop, getAttribute: () => null,
	removeAttribute: noop, addEventListener: noop, removeEventListener: noop, focus: noop, blur: noop,
	querySelector: () => null, querySelectorAll: () => [], children: [], childNodes: [],
	getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
	innerHTML: '', textContent: '', tagName: 'DIV', ownerDocument: null, parentNode: null,
	insertBefore: noop, cloneNode() { return el(); }, dispatchEvent: () => true, dataset: {}
});
const documentShim = {
	createElement: el, createElementNS: el, createTextNode: () => el(),
	createDocumentFragment: el, body: el(), head: el(), documentElement: el(),
	addEventListener: noop, removeEventListener: noop, querySelector: () => null,
	querySelectorAll: () => [], getElementById: () => null, activeElement: null,
	visibilityState: 'visible', hasFocus: () => true, styleSheets: [], fonts: { ready: Promise.resolve() }
};
const windowShim = {
	document: documentShim, navigator: { userAgent: 'node', language: 'en', platform: 'darwin', clipboard: {} },
	location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' },
	addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
	getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: cb => setTimeout(cb, 0),
	cancelAnimationFrame: clearTimeout, devicePixelRatio: 1, innerWidth: 1024, innerHeight: 768,
	setTimeout, clearTimeout, setInterval, clearInterval, MutationObserver: class { observe() { } disconnect() { } },
	ResizeObserver: class { observe() { } unobserve() { } disconnect() { } }, IntersectionObserver: class { observe() { } disconnect() { } }
};
// Constructor-shaped DOM globals: some modules subclass or instanceof these at
// import time, so they must be real classes rather than plain objects.
class NodeShim { }
class ElementShim extends NodeShim { }
class HTMLElementShim extends ElementShim { }
globalThis.Node = globalThis.Node ?? NodeShim;
globalThis.Element = globalThis.Element ?? ElementShim;
globalThis.HTMLElement = globalThis.HTMLElement ?? HTMLElementShim;
globalThis.HTMLDivElement = globalThis.HTMLDivElement ?? class extends HTMLElementShim { };
globalThis.HTMLInputElement = globalThis.HTMLInputElement ?? class extends HTMLElementShim { };
globalThis.HTMLTextAreaElement = globalThis.HTMLTextAreaElement ?? class extends HTMLElementShim { };
globalThis.HTMLAnchorElement = globalThis.HTMLAnchorElement ?? class extends HTMLElementShim { };
globalThis.DocumentFragment = globalThis.DocumentFragment ?? class extends NodeShim { };
globalThis.Event = globalThis.Event ?? class { constructor(t) { this.type = t; } };
globalThis.KeyboardEvent = globalThis.KeyboardEvent ?? class extends globalThis.Event { };
globalThis.MouseEvent = globalThis.MouseEvent ?? class extends globalThis.Event { };

globalThis.customElements = globalThis.customElements ?? {
	define: noop, get: () => undefined, whenDefined: () => Promise.resolve(), upgrade: noop
};
globalThis.getComputedStyle = globalThis.getComputedStyle ?? windowShim.getComputedStyle;
globalThis.DOMParser = globalThis.DOMParser ?? class { parseFromString() { return documentShim; } };

globalThis.window = globalThis.window ?? windowShim;
globalThis.document = globalThis.document ?? documentShim;
// node >=21 defines navigator as a getter-only global; only define if absent.
if (!globalThis.navigator) {
	Object.defineProperty(globalThis, 'navigator', { value: windowShim.navigator, configurable: true });
}
globalThis.self = globalThis.self ?? globalThis;
globalThis.MutationObserver = globalThis.MutationObserver ?? windowShim.MutationObserver;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? windowShim.ResizeObserver;
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? windowShim.requestAnimationFrame;
globalThis.matchMedia = globalThis.matchMedia ?? windowShim.matchMedia;

// --- mocha ---------------------------------------------------------------
const mocha = new Mocha({ ui: 'tdd', timeout: 15000, reporter: process.env.REPORTER || 'spec' });
const suite = mocha.suite;
suite.emit('pre-require', globalThis, 'cleanslate', mocha);

const filter = process.argv[2];
const files = readdirSync(TESTDIR)
	.filter(f => f.endsWith('.test.js'))
	.filter(f => !filter || f.includes(filter))
	.sort();

let loadFailures = 0;
for (const f of files) {
	try {
		await import(pathToFileURL(path.join(TESTDIR, f)).href);
	} catch (e) {
		loadFailures++;
		console.error(`\n!! FAILED TO LOAD ${f}: ${e && e.message}`);
	}
}

console.log(`\nloaded ${files.length - loadFailures}/${files.length} test files\n`);

mocha.run(failures => {
	console.log(`\n== load failures: ${loadFailures} | test failures: ${failures} ==`);
	process.exitCode = 0; // report, don't gate — the caller reads the summary
});
