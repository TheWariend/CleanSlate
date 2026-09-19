/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import type { IExternalAgentEvent } from '../../externalAgents/externalAgentTypes.js';

type ToolEvent = Extract<IExternalAgentEvent, { type: 'tool' }>;

/** Turn-local file evidence. Never changes the workspace or the user's Git index. */
export class ExternalFileSnapshots {
    private readonly files = new Map<string, string | undefined>();
    private readonly directories = new Set<string>();
    private readonly excludedDirectories = new Set<string>();
    private bytes = 0;
    private constructor(private readonly root: string, private readonly requestedRoot: string) {}

    static async capture(cwd: string): Promise<ExternalFileSnapshots> {
        const snapshot = new ExternalFileSnapshots(await realpath(cwd), resolve(cwd));
        await snapshot.scan(snapshot.root);
        return snapshot;
    }

    private async text(path: string): Promise<string | undefined> {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) { return undefined; }
        const content = await readFile(path);
        if (content.includes(0)) { return undefined; }
        return new TextDecoder('utf-8', { fatal: true }).decode(content);
    }

    private async scan(directory: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });
        this.directories.add(directory);
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (['.git', 'node_modules', '.build', 'dist', 'out', '.next', '.venv', 'venv'].includes(entry.name)) { this.excludedDirectories.add(path); }
                else { await this.scan(path).catch(() => { this.excludedDirectories.add(path); }); }
            } else if (entry.isFile()) {
                this.files.set(path, undefined);
                if (this.bytes < 64 * 1024 * 1024) {
                    const content = await this.text(path).catch(() => undefined);
                    if (content !== undefined) { this.files.set(path, content); this.bytes += Buffer.byteLength(content); }
                }
            } else {
                this.files.set(path, undefined);
                this.excludedDirectories.add(path);
            }
        }
    }

    async changes(event: ToolEvent): Promise<ToolEvent['fileChanges']> {
        const changes: NonNullable<ToolEvent['fileChanges']>[number][] = [];
        for (const location of new Set(event.locations ?? [])) {
            const requested = resolve(this.requestedRoot, location);
            const requestedRelative = relative(this.requestedRoot, requested);
            const canonicalRelative = relative(this.root, requested);
            const alreadyCanonical = canonicalRelative !== '..' && !canonicalRelative.startsWith(`..${sep}`) && !isAbsolute(canonicalRelative);
            const path = alreadyCanonical ? requested : resolve(this.root, requestedRelative);
            const local = relative(this.root, path);
            if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) { continue; }
            const actual = await realpath(path).catch(() => undefined);
            if (actual !== path) { continue; }
            const before = this.files.get(path);
            if (this.files.has(path) && before === undefined) { continue; }
            // Absence is evidence only in a directory inspected before execution.
            let parent = resolve(path, '..');
            let excluded = false;
            while (!this.directories.has(parent)) {
                if (this.excludedDirectories.has(parent) || parent === this.root) { excluded = true; break; }
                parent = resolve(parent, '..');
            }
            if (excluded) { continue; }
            const after = await this.text(path).catch(() => undefined);
            if (after === undefined || after === before) { continue; }
            changes.push({ path, beforeContent: before ?? '', afterContent: after, created: !this.files.has(path) });
            this.files.set(path, after);
        }
        return changes.length ? changes : undefined;
    }
}
