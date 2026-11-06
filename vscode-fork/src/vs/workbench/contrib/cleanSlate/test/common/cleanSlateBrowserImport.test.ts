/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { browserBookmark, parseBrowserBookmarksHTML, parseChromiumBookmarks } from '../../../../../platform/native/common/browserIntegration.js';
import { discoverBrowserImportSources, discoverInstalledBrowserApplications, matchBrowserApplication, readBrowserApplicationIcon, importBrowserBookmarks, importBrowserData, readBrowserHistory, readBrowserImportFile } from '../../../../../platform/native/node/browserImport.js';
import { parseChromiumSession } from '../../../../../platform/native/node/browserSessionImport.js';
import { mergeCleanSlateBrowserData, readCleanSlateBrowserHistory, readCleanSlateImportedTabs } from '../../browser/agentManager/cleanSlateBrowserData.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { cleanSlateBrowserBookmarksKey, importCleanSlateBrowserBookmarks, readCleanSlateBrowserBookmarks } from '../../browser/agentManager/cleanSlateBrowserBookmarks.js';

suite('CleanSlate browser import', () => {
	const environmentKeys = ['XDG_CONFIG_HOME', 'LOCALAPPDATA', 'APPDATA'] as const;
	let originalEnvironment: Array<string | undefined>;
	setup(() => {
		originalEnvironment = environmentKeys.map(key => process.env[key]);
		for (const key of environmentKeys) { delete process.env[key]; }
	});
	teardown(() => {
		for (const [index, key] of environmentKeys.entries()) {
			const value = originalEnvironment[index];
			if (value === undefined) { delete process.env[key]; }
			else { process.env[key] = value; }
		}
	});

	const chromium = JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
		{ type: 'folder', name: 'Research', children: [{ type: 'url', name: 'Reference', url: 'https://example.test/docs?a=1&b=2' }] },
		{ type: 'url', name: 'Unsafe', url: 'javascript:alert(1)' }
	] } } });

	test('imports Chromium folders and skips unsupported schemes', () => {
		const imported = parseChromiumBookmarks(chromium);
		assert.deepStrictEqual(imported.bookmarks, [{ title: 'Reference', url: 'https://example.test/docs?a=1&b=2', folders: ['Bookmarks bar', 'Research'] }]);
		assert.strictEqual(imported.skipped, 1);
		assert.throws(() => parseChromiumBookmarks('{}'), /does not contain browser bookmarks/);
	});

	test('imports HTML exports with nested folders, escaped text and unquoted attributes', () => {
		const result = parseBrowserBookmarksHTML(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
		<DT><H3>Work &amp; research</H3><DL><DT><A HREF="https://example.test/?a=1&amp;b=2">A &quot;reference&quot; &#x1f4da;</A>
		<DT><H3>Nested</H3><DL><DT><A HREF='https://second.test'>Second</A></DL></DL>
		<DT><A HREF=https://third.test>Third</A><DT><A HREF="data:text/html,unsafe">Skip</A></DL>`);
		assert.deepStrictEqual(result.bookmarks.map(bookmark => [bookmark.title, bookmark.url, bookmark.folders]), [
			['A "reference" 📚', 'https://example.test/?a=1&b=2', ['Work & research']],
			['Second', 'https://second.test/', ['Work & research', 'Nested']],
			['Third', 'https://third.test/', []]
		]);
		assert.strictEqual(result.skipped, 1);
		assert.throws(() => parseBrowserBookmarksHTML('<h1>Other document</h1>'), /bookmarks HTML export/);
	});

	test('never treats scripts, styles or comments as bookmark entries', () => {
		const result = parseBrowserBookmarksHTML('<DL><!--<A HREF="https://comment.test">Comment</A>--><script><style></style><A HREF="https://script.test">Script</A></script><style><A HREF="https://style.test">Style</A></style><A HREF="https://real.test">Real</A></DL>');
		assert.deepStrictEqual(result.bookmarks.map(bookmark => bookmark.url), ['https://real.test/']);
		assert.strictEqual(browserBookmark('javascript:alert(1)', 'Bad'), undefined);
	});

	test('merges imports without changing existing bookmarks or duplicating URLs', () => {
		const storage = new InMemoryStorageService();
		try {
			const imported = parseChromiumBookmarks(chromium);
			assert.deepStrictEqual(importCleanSlateBrowserBookmarks(storage, imported, 'Browser profile'), { added: 1, duplicates: 0, skipped: 1 });
			const before = readCleanSlateBrowserBookmarks(storage);
			assert.deepStrictEqual(before[0].folders, ['Browser profile', 'Bookmarks bar', 'Research']);
			assert.deepStrictEqual(importCleanSlateBrowserBookmarks(storage, imported, 'Second profile'), { added: 0, duplicates: 1, skipped: 1 });
			assert.deepStrictEqual(readCleanSlateBrowserBookmarks(storage), before);
			storage.store(cleanSlateBrowserBookmarksKey, '{bad-json', StorageScope.PROFILE, StorageTarget.MACHINE);
			assert.deepStrictEqual(readCleanSlateBrowserBookmarks(storage), []);
		} finally { storage.dispose(); }
	});

	test('discovers readable profiles by platform without exposing paths in source IDs', async () => {
		const home = await fs.mkdtemp(join(tmpdir(), 'browser-import-'));
		try {
			for (const [platform, path] of [
				['darwin', ['Library', 'Application Support', 'Google', 'Chrome']],
				['linux', ['.config', 'google-chrome']],
				['win32', ['AppData', 'Local', 'Google', 'Chrome', 'User Data']]
			] as const) {
				const root = join(home, ...path);
				await fs.mkdir(join(root, 'Profile 2'), { recursive: true });
				await fs.writeFile(join(root, 'Profile 2', 'Bookmarks'), chromium);
				await fs.writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 2': { name: 'Research profile' } } } }));
				const sources = await discoverBrowserImportSources(home, platform, {});
				assert.strictEqual(sources.length, 1);
				assert.strictEqual(sources[0].browser, platform === 'linux' ? 'google-chrome' : 'Chrome');
				assert.strictEqual(sources[0].profile, 'Research profile');
				assert.match(sources[0].id, /^[a-f0-9]{32}$/);
			}
			const original = await fs.readFile(join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 2', 'Bookmarks'), 'utf8');
			const sources = await discoverBrowserImportSources(home, process.platform, {});
			assert.strictEqual(parseChromiumBookmarks(await readBrowserImportFile(sources[0].file)).bookmarks.length, 1);
			assert.strictEqual(await fs.readFile(join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 2', 'Bookmarks'), 'utf8'), original);
			await assert.rejects(importBrowserBookmarks('../../Bookmarks', home), /no longer available/);
			const large = join(home, 'large.html');
			await fs.writeFile(large, 'x'.repeat(10 * 1024 * 1024 + 1));
			await assert.rejects(readBrowserImportFile(large), /smaller than 10 MB/);
		} finally { await fs.rm(home, { recursive: true, force: true }); }
	});
	test('discovers an unknown browser and nonstandard profile without brand or profile-name allowlists', async () => {
		const home = await fs.mkdtemp(join(tmpdir(), 'browser-dynamic-'));
		try {
			const root = join(home, 'Library', 'Application Support', 'Example Navigator', 'User Data');
			await fs.mkdir(join(root, 'Guest workspace'), { recursive: true });
			await fs.writeFile(join(root, 'Guest workspace', 'AccountBookmarks'), chromium);
			await fs.writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Guest workspace': { name: 'Reference profile' } } } }));
			const sources = await discoverBrowserImportSources(home, 'darwin', {});
			assert.strictEqual(sources.length, 1); assert.strictEqual(sources[0].browser, 'Example Navigator');
			assert.strictEqual(sources[0].profile, 'Reference profile'); assert.strictEqual(sources[0].available.bookmarks, true);
			assert.strictEqual(sources[0].available.tabs, false); assert.strictEqual(sources[0].available.history, false);
			const elsewhere = join(home, 'custom-location', 'Profile');
			await fs.mkdir(elsewhere, { recursive: true }); await fs.writeFile(join(elsewhere, 'Bookmarks'), chromium);
			assert.strictEqual((await discoverBrowserImportSources(home, 'darwin', {}, [elsewhere])).length, 2);
		} finally { await fs.rm(home, { recursive: true, force: true }); }
	});

	test('reads a selected tab navigation, preserves order and pins, and excludes closed or unsafe tabs', () => {
		const header = Buffer.alloc(8); header.write('SNSS'); header.writeInt32LE(3, 4);
		const command = (id: number, payload: Buffer) => { const prefix = Buffer.alloc(3); prefix.writeUInt16LE(payload.length + 1); prefix[2] = id; return Buffer.concat([prefix, payload]); };
		const ints = (...values: number[]) => { const buffer = Buffer.alloc(values.length * 4); values.forEach((value, index) => buffer.writeInt32LE(value, index * 4)); return buffer; };
		const string = (value: string, utf16 = false) => { const data = Buffer.from(value, utf16 ? 'utf16le' : 'utf8'); const padded = Buffer.alloc((data.length + 3) & ~3); data.copy(padded); return Buffer.concat([ints(utf16 ? value.length : data.length), padded]); };
		const navigation = (tab: number, index: number, url: string) => {
			const payload = Buffer.concat([ints(tab, index), string(url), string('Reference 📚', true), string(''), ints(0)]);
			return command(6, Buffer.concat([ints(payload.length), payload]));
		};
		const data = Buffer.concat([header, command(0, ints(1, 10)), command(2, ints(10, 1)), navigation(10, 0, 'https://old.test'), navigation(10, 1, 'https://current.test'), command(7, ints(10, 1)), command(12, Buffer.concat([ints(10), Buffer.from([1])])),
			command(0, ints(1, 20)), command(2, ints(20, 0)), navigation(20, 0, 'https://first.test'),
			command(0, ints(1, 30)), navigation(30, 0, 'https://closed.test'), command(16, ints(30)),
			command(0, ints(1, 40)), navigation(40, 0, 'https://previous.test'), navigation(40, 1, 'javascript:alert(1)'), command(7, ints(40, 1))]);
		assert.deepStrictEqual(parseChromiumSession(data), [
			{ url: 'https://first.test/', title: 'Reference 📚', pinned: false }, { url: 'https://current.test/', title: 'Reference 📚', pinned: true }
		]);
		assert.throws(() => parseChromiumSession(data.subarray(0, data.length - 1)), /incomplete/);
		const encrypted = Buffer.from(header); encrypted.writeInt32LE(5, 4); assert.throws(() => parseChromiumSession(encrypted), /encrypted/);
	});

	test('imports history read-only and reads only the selected categories', async () => {
		const home = await fs.mkdtemp(join(tmpdir(), 'browser-history-'));
		const { default: sqlite } = await import('@vscode/sqlite3');
		try {
			const parts = process.platform === 'darwin' ? ['Library', 'Application Support'] : process.platform === 'win32' ? ['AppData', 'Local'] : ['.config'];
			const root = join(home, ...parts, 'Example Navigator'); const profile = join(root, 'Default');
			await fs.mkdir(profile, { recursive: true }); await fs.writeFile(join(profile, 'Bookmarks'), chromium);
			await fs.writeFile(join(profile, 'Preferences'), '{}');
			const file = join(profile, 'History');
			const database = await new Promise<import('@vscode/sqlite3').Database>((resolve, reject) => { const db = new sqlite.Database(file, error => error ? reject(error) : resolve(db)); });
			await new Promise<void>((resolve, reject) => database.exec("CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER, visit_count INTEGER); INSERT INTO urls VALUES ('https://visited.test/', 'Visited reference', 13300000000000000, 4), ('javascript:alert(1)', 'Unsafe', 13300000000000000, 1);", error => error ? reject(error) : resolve()));
			await new Promise<void>((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
			const before = await fs.readFile(file);
			const history = await readBrowserHistory(file); assert.strictEqual(history.length, 1); assert.strictEqual(history[0].visits, 4); assert.strictEqual(history[0].lastVisit, 1655526400000);
			assert.deepStrictEqual(await fs.readFile(file), before);
			const source = (await discoverBrowserImportSources(home))[0];
			const result = await importBrowserData([source.id], ['history'], home);
			assert.strictEqual(result[0].bookmarks, undefined); assert.strictEqual(result[0].tabs, undefined); assert.deepStrictEqual(result[0].history, history);
			const storage = new InMemoryStorageService();
			try {
				const data = [{ ...result[0], tabs: [{ url: 'https://tab.test/', title: 'Saved tab', pinned: true }] }];
				const summary = mergeCleanSlateBrowserData(storage, data); assert.strictEqual(summary.tabs, 1); assert.strictEqual(summary.history, 1);
				assert.strictEqual(mergeCleanSlateBrowserData(storage, data).duplicates, 2);
				assert.strictEqual(readCleanSlateImportedTabs(storage)[0].pinned, true); assert.deepStrictEqual(readCleanSlateBrowserHistory(storage), history);
			} finally { storage.dispose(); }
		} finally { await fs.rm(home, { recursive: true, force: true }); }
	});

	test('skips absent categories across selected profiles and reports genuine read errors', async () => {
		const home = await fs.mkdtemp(join(tmpdir(), 'browser-mixed-profiles-'));
		try {
			const parts = process.platform === 'darwin' ? ['Library', 'Application Support'] : process.platform === 'win32' ? ['AppData', 'Local'] : ['.config'];
			const root = join(home, ...parts, 'Example Navigator');
			for (const profile of ['Bookmarks only', 'No bookmarks', 'Invalid bookmarks']) {
				await fs.mkdir(join(root, profile), { recursive: true });
				await fs.writeFile(join(root, profile, 'Preferences'), '{}');
			}
			await fs.writeFile(join(root, 'Bookmarks only', 'Bookmarks'), chromium);
			await fs.mkdir(join(root, 'No bookmarks', 'Sessions'));
			await fs.writeFile(join(root, 'Invalid bookmarks', 'Bookmarks'), '{bad-json');
			const sources = await discoverBrowserImportSources(home);
			assert.strictEqual(sources.length, 3);
			const results = await importBrowserData(sources.map(source => source.id), ['tabs', 'bookmarks', 'history'], home);
			assert.strictEqual(results.find(result => result.source.profile === 'Bookmarks only')?.bookmarks?.bookmarks.length, 1);
			assert.deepStrictEqual(results.find(result => result.source.profile === 'No bookmarks')?.issues, []);
			const issues = results.flatMap(result => result.issues);
			assert.strictEqual(issues.length, 1);
			assert.strictEqual(issues[0].kind, 'bookmarks');
			assert.ok(!issues[0].message.includes('Close the source browser'));
		} finally { await fs.rm(home, { recursive: true, force: true }); }
	});

	for (const mode of ['WAL', 'DELETE']) {
		test(`imports committed history from an exclusively locked ${mode} database without changing the source`, async function () {
			this.timeout(10_000);
			const directory = await fs.mkdtemp(join(tmpdir(), 'browser-locked-history-'));
			const file = join(directory, 'History');
			const { default: sqlite } = await import('@vscode/sqlite3');
			const database = await new Promise<import('@vscode/sqlite3').Database>((resolve, reject) => { const db = new sqlite.Database(file, error => error ? reject(error) : resolve(db)); });
			const exec = (sql: string) => new Promise<void>((resolve, reject) => database.exec(sql, error => error ? reject(error) : resolve()));
			try {
				await exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=${mode}; CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER, visit_count INTEGER); INSERT INTO urls VALUES ('https://committed.test/', 'Committed page', 13300000000000000, 4);`);
				// Force dirty rollback pages to disk while leaving the transaction open.
				await exec("PRAGMA cache_size=1; BEGIN EXCLUSIVE; UPDATE urls SET title='Uncommitted page'; CREATE TABLE pending (data BLOB); INSERT INTO pending VALUES (zeroblob(100000));");
				const files = await fs.readdir(directory);
				const before = await Promise.all(files.map(name => fs.readFile(join(directory, name))));
				const history = await readBrowserHistory(file);
				assert.deepStrictEqual(history.map(page => [page.url, page.title, page.visits]), [['https://committed.test/', 'Committed page', 4]]);
				assert.deepStrictEqual(await fs.readdir(directory), files);
				for (const [index, name] of files.entries()) { assert.deepStrictEqual(await fs.readFile(join(directory, name)), before[index]); }
			} finally {
				await new Promise<void>((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
				await fs.rm(directory, { recursive: true, force: true });
			}
		});
	}

	test('resolves an installed browser logo from its bundle metadata without a name allowlist', async function () {
		if (process.platform !== 'darwin') { this.skip(); }
		const home = await fs.mkdtemp(join(tmpdir(), 'browser-icon-'));
		try {
			const applications = join(home, 'Applications'); const contents = join(applications, 'Reference Navigator.app', 'Contents');
			await fs.mkdir(join(contents, 'Resources'), { recursive: true });
			await fs.writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>Reference Navigator</string><key>CFBundleIdentifier</key><string>org.example.navigator</string><key>CFBundleIconFile</key><string>Brand.png</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>http</string><string>https</string></array></dict></array></dict></plist>`);
			await fs.writeFile(join(contents, 'Resources', 'Brand.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=', 'base64'));
			const apps = await discoverInstalledBrowserApplications(home, [applications]);
			assert.strictEqual(apps.length, 1); const app = matchBrowserApplication('org.example.navigator', apps); assert.ok(app);
			assert.strictEqual(matchBrowserApplication('Reference Navigator', apps), app);
			const icon = await readBrowserApplicationIcon(app); assert.ok(icon); assert.ok(icon.startsWith('data:image/png;base64,'));
			assert.strictEqual(Buffer.from(icon.split(',')[1], 'base64').toString('ascii', 1, 4), 'PNG');
		} finally { await fs.rm(home, { recursive: true, force: true }); }
	});

});
