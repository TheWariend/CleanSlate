/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

type ProcessTreeCommand = (file: string, args: readonly string[]) => Promise<boolean>;

const runProcessTreeCommand: ProcessTreeCommand = (file, args) => new Promise(resolve => {
	execFile(file, [...args], { windowsHide: true, timeout: 5_000, killSignal: 'SIGKILL' }, error => resolve(!error));
});

export async function terminateWindowsProcessTree(pid: number, run: ProcessTreeCommand = runProcessTreeCommand): Promise<boolean> {
	if (!Number.isSafeInteger(pid) || pid <= 0) { return false; }
	const system = win32.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32');
	try {
		if (await run(win32.join(system, 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'])) { return true; }
	} catch { /* Try an independent whole-tree fallback while the parent still exists. */ }
	// Snapshot descendants before terminating any parent, otherwise reparenting
	// would prevent the remaining children from being found. Each command is bounded.
	const script = [
		'$ErrorActionPreference = "Stop"',
		'$processes = @(Get-CimInstance Win32_Process)',
		'function Stop-CommandTree([int]$processId) {',
		'  foreach ($entry in $processes) {',
		'    if ($entry.ParentProcessId -eq $processId) { Stop-CommandTree ([int]$entry.ProcessId) }',
		'  }',
		'  $target = Get-Process -Id $processId -ErrorAction SilentlyContinue',
		'  if ($target) {',
		'    try { $target | Stop-Process -Force -ErrorAction Stop }',
		'    catch { if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw } }',
		'  }',
		'}',
		`Stop-CommandTree ${pid}`
	].join('\n');
	try {
		return await run(win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]);
	} catch { return false; }
}
