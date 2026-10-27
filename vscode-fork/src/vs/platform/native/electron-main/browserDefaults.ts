/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, shell } from 'electron';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { dirname, join } from '../../../base/common/path.js';
import { IDefaultBrowserState } from '../common/browserIntegration.js';

const run = promisify(execFile);
const desktopFile = 'cleanslate-browser.desktop';

export async function getDefaultBrowserState(): Promise<IDefaultBrowserState> {
	if (process.platform === 'linux') {
		try {
			const results = await Promise.all([
				run('xdg-settings', ['get', 'default-web-browser'], { timeout: 5000 }),
				run('xdg-mime', ['query', 'default', 'x-scheme-handler/http'], { timeout: 5000 }),
				run('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], { timeout: 5000 })
			]);
			return { isDefault: results.every(result => result.stdout.trim() === desktopFile), canSetDefault: true };
		} catch { return { isDefault: false, canSetDefault: false, message: 'Default browser settings require xdg-settings and xdg-mime in a desktop session.' }; }
	}
	if (process.platform === 'win32') {
		const results = await Promise.all(['http', 'https'].map(async scheme => {
			try {
				const result = await run('reg.exe', ['query', `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`, '/v', 'ProgId'], { timeout: 5000 });
				return /REG_SZ\s+CleanSlate\.Browser\s*$/i.test(result.stdout);
			} catch { return false; }
		}));
		return { isDefault: results.every(Boolean), canSetDefault: true };
	}
	const isDefault = app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
	if (process.platform === 'darwin') {
		try {
			const plist = await run('/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', join(dirname(app.getPath('exe')), '..', 'Info.plist')], { timeout: 5000 });
			const types: { CFBundleURLSchemes?: string[] }[] = JSON.parse(plist.stdout);
			const schemes = Array.isArray(types) ? types.flatMap(type => type.CFBundleURLSchemes ?? []) : [];
			if (!schemes.includes('http') || !schemes.includes('https')) {
				return { isDefault, canSetDefault: false, message: 'This app build does not register web links yet. Rebuild or update CleanSlate to enable default-browser selection.' };
			}
		} catch { return { isDefault, canSetDefault: false, message: 'Run CleanSlate from its installed application bundle to set it as the default browser.' }; }
	}
	return { isDefault, canSetDefault: process.platform === 'darwin' };
}

export async function setAsDefaultBrowser(appRoot: string, isBuilt: boolean, name: string): Promise<IDefaultBrowserState> {
	const state = await getDefaultBrowserState();
	if (!state.canSetDefault || state.isDefault) { return state; }
	if (process.platform === 'linux') {
		const applications = join(process.env['XDG_DATA_HOME'] || join(app.getPath('home'), '.local', 'share'), 'applications');
		const quote = (value: string) => `"${value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%')}"`;
		const command = [quote(process.execPath), ...(!isBuilt ? [quote(appRoot)] : []), '--open-url', '--', '%U'].join(' ');
		await fs.mkdir(applications, { recursive: true });
		await fs.writeFile(join(applications, desktopFile), `[Desktop Entry]\nType=Application\nName=${name}\nExec=${command}\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n`);
		await run('xdg-settings', ['set', 'default-web-browser', desktopFile], { timeout: 10000 });
		await run('xdg-mime', ['default', desktopFile, 'x-scheme-handler/http', 'x-scheme-handler/https'], { timeout: 10000 });
	} else if (process.platform === 'win32') {
		const protocolId = 'CleanSlate.Browser';
		const capabilities = 'Software\\Clients\\StartMenuInternet\\CleanSlate\\Capabilities';
		const launchCommand = `"${process.execPath}"${isBuilt ? '' : ` "${appRoot}"`}`;
		const command = `${launchCommand} --open-url -- "%1"`;
		for (const [key, field, value] of [
			['Software\\Clients\\StartMenuInternet\\CleanSlate', '', name],
			['Software\\Clients\\StartMenuInternet\\CleanSlate\\shell\\open\\command', '', launchCommand],
			[`Software\\Classes\\${protocolId}`, '', `${name} web link`],
			[`Software\\Classes\\${protocolId}`, 'URL Protocol', ''],
			[`Software\\Classes\\${protocolId}\\DefaultIcon`, '', `"${process.execPath}",0`],
			[`Software\\Classes\\${protocolId}\\shell\\open\\command`, '', command],
			[capabilities, 'ApplicationName', name],
			[capabilities, 'ApplicationDescription', 'Browse the web in CleanSlate.'],
			[capabilities, 'ApplicationIcon', `"${process.execPath}",0`],
			[`${capabilities}\\Startmenu`, 'StartMenuInternet', 'CleanSlate'],
			[`${capabilities}\\URLAssociations`, 'http', protocolId],
			[`${capabilities}\\URLAssociations`, 'https', protocolId],
			['Software\\RegisteredApplications', name, capabilities],
		]) {
			await run('reg.exe', ['add', `HKCU\\${key}`, ...(field ? ['/v', field] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'], { timeout: 5000 });
		}
		await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(name)}`);
	} else {
		app.setAsDefaultProtocolClient('http');
		app.setAsDefaultProtocolClient('https');
		if (!(await getDefaultBrowserState()).isDefault) { await shell.openExternal('x-apple.systempreferences:com.apple.Desktop-Settings.extension'); }
	}
	const updated = await getDefaultBrowserState();
	return updated.isDefault ? updated : { ...updated, message: 'Choose CleanSlate in your system default-browser settings, then return here to check the result.' };
}
