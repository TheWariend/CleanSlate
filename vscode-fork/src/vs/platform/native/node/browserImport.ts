/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { homedir, tmpdir } from 'os';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { basename, dirname, join } from '../../../base/common/path.js';
import { browserBookmark, BrowserImportKind, IBrowserBookmarkImport, IBrowserHistoryEntry, IBrowserImportSource, IBrowserProfileImport, parseChromiumBookmarks } from '../common/browserIntegration.js';
import { parseChromiumSession } from './browserSessionImport.js';

interface ISource extends IBrowserImportSource { readonly file: string; readonly accountBookmarks: string; readonly historyFile: string; readonly sessionFile?: string }

export async function readBrowserImportFile(path: string): Promise<string> {
	return (await readLimitedFile(path, 10 * 1024 * 1024)).toString('utf8');
}

async function readLimitedFile(path: string, limit: number): Promise<Buffer> {
	const handle = await fs.open(path, 'r');
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > limit) { throw new Error(`Choose a browser data file smaller than ${limit / 1024 / 1024} MB.`); }
		const data = Buffer.alloc(stat.size + 1);
		let bytesRead = 0;
		while (bytesRead < data.length) { const result = await handle.read(data, bytesRead, data.length - bytesRead, bytesRead); if (!result.bytesRead) { break; } bytesRead += result.bytesRead; }
		if (bytesRead > stat.size) { throw new Error('The browser data changed during import. Close that browser and try again.'); }
		return data.subarray(0, bytesRead);
	} finally { await handle.close(); }
}

async function readable(path: string): Promise<boolean> {
	try { await fs.access(path, fs.constants.R_OK); return (await fs.stat(path)).isFile(); } catch { return false; }
}

async function sessionFile(profile: string): Promise<string | undefined> {
	try {
		const names = (await fs.readdir(join(profile, 'Sessions'))).filter(name => /^Session_\d+$/.test(name));
		names.sort((a, b) => a.length === b.length ? b.localeCompare(a) : b.length - a.length);
		if (names.length) { return join(profile, 'Sessions', names[0]); }
	} catch { /* Older browsers store the session in the profile directory. */ }
	for (const name of ['Current Session', 'Last Session']) { const file = join(profile, name); if (await readable(file)) { return file; } }
	return undefined;
}

async function sessionAvailability(path: string | undefined): Promise<{ available: boolean; reason?: string }> {
	if (!path) { return { available: false, reason: 'No saved tab session is available in this profile.' }; }
	try {
		const handle = await fs.open(path, 'r');
		try {
			const header = Buffer.alloc(8); await handle.read(header, 0, 8, 0);
			const version = header.readInt32LE(4);
			if (header.toString('ascii', 0, 4) === 'SNSS' && (version === 1 || version === 3)) { return { available: true }; }
			return { available: false, reason: version === 5 ? 'This browser encrypts its saved tabs. Direct tab import is not supported for this profile.' : 'This browser uses an unsupported tab session format.' };
		} finally { await handle.close(); }
	} catch { return { available: false, reason: 'The saved tab session could not be read. Close the source browser and scan again.' }; }
}

export interface IInstalledBrowserApplication { readonly name: string; readonly path: string; readonly id: string; readonly iconPath?: string }

/** Uses registered URL schemes in app metadata, without a browser-brand allowlist. */
export async function discoverInstalledBrowserApplications(home: string, roots: readonly string[] = ['/Applications', '/System/Applications', join(home, 'Applications')]): Promise<IInstalledBrowserApplication[]> {
	if (process.platform !== 'darwin') { return []; }
	const applications: IInstalledBrowserApplication[] = [];
	for (const root of roots) {
		let names: string[];
		try { names = (await fs.readdir(root)).filter(name => name.endsWith('.app')); } catch { continue; }
		for (const name of names) {
			const path = join(root, name);
			try {
				const { stdout } = await promisify(execFile)('plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')], { timeout: 2000, maxBuffer: 1024 * 1024 });
				const info = JSON.parse(stdout);
				if (!Array.isArray(info.CFBundleURLTypes) || !['http', 'https'].every(scheme => info.CFBundleURLTypes.some((type: { CFBundleURLSchemes?: string[] }) => type.CFBundleURLSchemes?.includes(scheme)))) { continue; }
				const icon = typeof info.CFBundleIconFile === 'string' ? basename(info.CFBundleIconFile) : undefined;
				applications.push({ name: info.CFBundleDisplayName || info.CFBundleName || name.slice(0, -4), path, id: info.CFBundleIdentifier || name, iconPath: icon ? join(path, 'Contents', 'Resources', /\.[a-z0-9]+$/i.test(icon) ? icon : `${icon}.icns`) : undefined });
			} catch { /* An inaccessible app does not prevent discovery of other apps. */ }
		}
	}
	return applications;
}

export async function readBrowserApplicationIcon(application: IInstalledBrowserApplication): Promise<string | undefined> {
	if (!application.iconPath) { return undefined; }
	const directory = await fs.mkdtemp(join(tmpdir(), 'browser-import-icon-'));
	try {
		const output = join(directory, 'icon.png');
		await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', application.iconPath, '--out', output], { timeout: 3000, maxBuffer: 1024 * 1024 });
		const icon = await readLimitedFile(output, 256 * 1024);
		return `data:image/png;base64,${icon.toString('base64')}`;
	} catch { return undefined; }
	finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export function matchBrowserApplication(label: string, applications: readonly IInstalledBrowserApplication[]): IInstalledBrowserApplication | undefined {
	const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
	const key = normalize(label);
	if (!key) { return undefined; }
	return applications.find(app => normalize(app.name) === key)
		?? applications.find(app => normalize(app.id) === key)
		?? applications.find(app => normalize(app.path.split('/').pop()!.replace(/\.app$/, '')) === key)
		?? applications.find(app => app.id.toLowerCase().split('.').includes(label.toLowerCase()))
		?? applications.find(app => key.length > 3 && normalize(app.name).endsWith(key));
}

export async function discoverBrowserImportSources(home = homedir(), platform = process.platform, environment: NodeJS.ProcessEnv = process.env, extraRoots: readonly string[] = []): Promise<ISource[]> {
	// These are OS configuration locations, not a list of browser products.
	const roots = platform === 'darwin' ? [join(home, 'Library', 'Application Support')]
		: platform === 'win32' ? [environment['LOCALAPPDATA'] || join(home, 'AppData', 'Local'), environment['APPDATA'] || join(home, 'AppData', 'Roaming')]
			: [environment['XDG_CONFIG_HOME'] || join(home, '.config')];
	const sources: ISource[] = [];
	const seen = new Set<string>();
	const queue = [...roots, ...extraRoots].map(path => ({ path, depth: 0 }));
	const ignored = /^(Cache|Caches|Code Cache|GPUCache|Service Worker|node_modules|Extensions|Crashpad|logs|Local Storage|IndexedDB|Session Storage|System Profile)$/i;
	for (let visited = 0; queue.length && visited < 4000; visited++) {
		const next = queue.shift()!;
		if (seen.has(next.path)) { continue; }
		seen.add(next.path);
		let entries: import('fs').Dirent[];
		try { entries = await fs.readdir(next.path, { withFileTypes: true }); } catch { continue; }
		const files = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
		const hasData = files.has('Bookmarks') || files.has('AccountBookmarks') || files.has('History') || files.has('Current Session') || files.has('Last Session') || files.has('Preferences') && entries.some(entry => entry.isDirectory() && entry.name === 'Sessions');
		const isProfile = hasData && (files.has('Preferences') || files.has('Bookmarks') || files.has('AccountBookmarks') || await readable(join(dirname(next.path), 'Local State')));
		if (isProfile) {
			const base = files.has('Local State') ? next.path : dirname(next.path);
			const name = next.path === base ? '' : basename(next.path);
			const baseLabel = /^(User Data|UserData)$/i.test(basename(base)) ? basename(dirname(base)) : basename(base);
			const browserId = createHash('sha256').update(base).digest('hex').slice(0, 24);
			let info: Record<string, { name?: string }> = {};
			try { info = JSON.parse(await readBrowserImportFile(join(base, 'Local State')))?.profile?.info_cache ?? {}; } catch { /* The directory name remains usable. */ }
			const file = join(next.path, 'Bookmarks'); const accountBookmarks = join(next.path, 'AccountBookmarks'); const historyFile = join(next.path, 'History');
			const tabsFile = await sessionFile(next.path); const tabs = await sessionAvailability(tabsFile);
			sources.push({ id: createHash('sha256').update(next.path).digest('hex').slice(0, 32), browserId, browser: baseLabel,
				profile: typeof info[name]?.name === 'string' ? info[name].name!.slice(0, 256) : name || 'Default',
				available: { bookmarks: await readable(file) || await readable(accountBookmarks), history: await readable(historyFile), tabs: tabs.available },
				tabsUnavailable: tabs.reason, file, accountBookmarks, historyFile, sessionFile: tabsFile });
			continue;
		}
		if (next.depth < 4) {
			for (const entry of entries) { if (entry.isDirectory() && !entry.name.startsWith('.') && !ignored.test(entry.name)) { queue.push({ path: join(next.path, entry.name), depth: next.depth + 1 }); } }
		}
	}
	return sources.sort((a, b) => a.browser.localeCompare(b.browser) || a.profile.localeCompare(b.profile));
}

export async function importBrowserBookmarks(sourceId: string, home = homedir()): Promise<IBrowserBookmarkImport> {
	const source = (await discoverBrowserImportSources(home)).find(source => source.id === sourceId);
	if (!source) { throw new Error('This browser profile is no longer available. Refresh the browser list or import an HTML export.'); }
	return readBookmarks(source);
}

export function publicBrowserImportSource({ id, browserId, browser, profile, available, tabsUnavailable }: IBrowserImportSource): IBrowserImportSource {
	return { id, browserId, browser, profile, available, tabsUnavailable };
}

async function readBookmarks(source: ISource): Promise<IBrowserBookmarkImport> {
	const bookmarks = []; let skipped = 0;
	for (const path of [source.file, source.accountBookmarks]) {
		if (!await readable(path)) { continue; }
		const imported = parseChromiumBookmarks(await readBrowserImportFile(path));
		bookmarks.push(...imported.bookmarks); skipped += imported.skipped;
	}
	return { bookmarks, skipped };
}

export async function readBrowserHistory(path: string): Promise<IBrowserHistoryEntry[]> {
	try {
		return await readHistoryDatabase(path);
	} catch (error) {
		if (!['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_READONLY'].includes((error as NodeJS.ErrnoException).code ?? '')) { throw error; }
	}

	// Chromium may hold an exclusive SQLite lock while running. Work on a stable
	// copy instead, including WAL/rollback journals but never the source's lock file.
	const directory = await fs.mkdtemp(join(tmpdir(), 'browser-import-history-'));
	const copy = join(directory, 'History');
	const suffixes = ['', '-wal', '-journal'];
	const stat = async (file: string) => {
		try { return await fs.stat(file, { bigint: true }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
	};
	type FileState = Awaited<ReturnType<typeof stat>>;
	const unchanged = (before: FileState, after: FileState) => before?.ino === after?.ino && before?.size === after?.size && before?.mtimeNs === after?.mtimeNs && before?.ctimeNs === after?.ctimeNs;
	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			for (const suffix of ['-wal', '-shm', '-journal']) { await fs.rm(`${copy}${suffix}`, { force: true }); }
			const before = await Promise.all(suffixes.map(suffix => stat(`${path}${suffix}`)));
			try {
				for (const [index, suffix] of suffixes.entries()) {
					if (index === 0 || before[index]) { await fs.copyFile(`${path}${suffix}`, `${copy}${suffix}`, fs.constants.COPYFILE_FICLONE); }
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT' && attempt < 2) { continue; }
				throw error;
			}
			const after = await Promise.all(suffixes.map(suffix => stat(`${path}${suffix}`)));
			// Recovery/checkpoint writes are allowed only on our disposable copy.
			if (before.every((state, index) => unchanged(state, after[index]))) { return await readHistoryDatabase(copy, false); }
		}
		throw Object.assign(new Error('Browser history changed while being copied.'), { code: 'SQLITE_BUSY' });
	} finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function readHistoryDatabase(path: string, readonly = true): Promise<IBrowserHistoryEntry[]> {
	const { default: sqlite } = await import('@vscode/sqlite3');
	const db = await new Promise<import('@vscode/sqlite3').Database>((resolve, reject) => {
		const connection = new sqlite.Database(path, readonly ? sqlite.OPEN_READONLY : sqlite.OPEN_READWRITE, error => error ? reject(error) : resolve(connection));
	});
	db.configure('busyTimeout', 3000);
	try {
		const rows = await new Promise<{ url: string; title: string; last_visit_time: number; visit_count: number }[]>((resolve, reject) => {
			db.all('SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 50000', (error: Error | null, rows: { url: string; title: string; last_visit_time: number; visit_count: number }[]) => error ? reject(error) : resolve(rows));
		});
		return rows.flatMap(row => {
			const page = browserBookmark(row.url, row.title); const lastVisit = Math.floor(row.last_visit_time / 1000 - 11644473600000);
			return page && Number.isFinite(lastVisit) && lastVisit > 0 ? [{ url: page.url, title: page.title, lastVisit, visits: Math.max(1, Math.min(Number(row.visit_count) || 1, 1_000_000)) }] : [];
		});
	} finally { await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}

/** Reads selected categories without modifying any of the source browser's files. */
export async function importBrowserData(sourceIds: readonly string[], kinds: readonly BrowserImportKind[], home = homedir(), extraRoots: readonly string[] = []): Promise<IBrowserProfileImport[]> {
	if (!sourceIds.length || sourceIds.length > 50 || !kinds.length || kinds.some(kind => !['tabs', 'bookmarks', 'history'].includes(kind))) { throw new Error('Choose browser profiles and data to import.'); }
	const sources = await discoverBrowserImportSources(home, process.platform, process.env, extraRoots);
	const results: IBrowserProfileImport[] = [];
	for (const id of new Set(sourceIds)) {
		const source = sources.find(source => source.id === id);
		if (!source) { throw new Error('A selected browser profile is no longer available. Scan for browsers again.'); }
		const result: { source: IBrowserImportSource; bookmarks?: IBrowserBookmarkImport; tabs?: ReturnType<typeof parseChromiumSession>; history?: IBrowserHistoryEntry[]; issues: { kind: BrowserImportKind; message: string }[] } = { source: publicBrowserImportSource(source), issues: [] };
		for (const kind of new Set(kinds)) {
			// Categories are selected across profiles. An absent category in one
			// profile is normal, and is already shown in the availability step.
			if (!source.available[kind]) { continue; }
			try {
				if (kind === 'bookmarks') { result.bookmarks = await readBookmarks(source); }
				if (kind === 'history') { result.history = await readBrowserHistory(source.historyFile); }
				if (kind === 'tabs') { result.tabs = parseChromiumSession(await readLimitedFile(source.sessionFile!, 50 * 1024 * 1024)); }
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				const message = code === 'EACCES' || code === 'EPERM' ? 'CleanSlate does not have permission to read this data.'
					: code === 'ENOENT' ? 'This data is no longer available. Scan for browsers again.'
						: kind === 'history' && (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') ? 'Browsing history is busy. Wait a moment, or close the source browser and try again.'
							: kind === 'history' && (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_ERROR') ? 'This history database is damaged or uses an unsupported format.'
								: 'Could not import this data. Scan again or try a browser export.';
				result.issues.push({ kind, message });
			}
		}
		results.push(result);
	}
	return results;
}
