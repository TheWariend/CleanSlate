/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.cleanslate/instructions.md'] as const;
const MAX_INSTRUCTION_BYTES = 32 * 1024;
const MAX_MENTION_BYTES = 64 * 1024;
const MAX_TOTAL_MENTION_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export interface ICliProjectContextInventory {
	instructionFiles: string[];
	mentionedFiles: string[];
}

export interface ICliImageAttachment {
	path: string;
	dataUrl: string;
}

function isInside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readTextFile(target: string, maxBytes: number): string | undefined {
	try {
		const stat = fs.statSync(target);
		if (!stat.isFile() || stat.size > maxBytes) {
			return undefined;
		}
		const value = fs.readFileSync(target, 'utf8');
		return value.includes('\0') ? undefined : value;
	} catch {
		return undefined;
	}
}

export class CliProjectContext {
	readonly root: string;

	constructor(root: string) {
		this.root = fs.realpathSync(path.resolve(root));
	}

	inventory(task = ''): ICliProjectContextInventory {
		return {
			instructionFiles: this.instructionFiles().map(target => path.relative(this.root, target)),
			mentionedFiles: this.mentionedFiles(task).map(target => path.relative(this.root, target))
		};
	}

	build(task = ''): string {
		const sections: string[] = [];
		for (const target of this.instructionFiles()) {
			const content = readTextFile(target, MAX_INSTRUCTION_BYTES);
			if (content?.trim()) {
				sections.push(`[Project instructions: ${path.relative(this.root, target)}]\n${content.trim()}`);
			}
		}
		let remainingBudget = MAX_TOTAL_MENTION_BYTES;
		for (const target of this.mentionedFiles(task)) {
			if (remainingBudget <= 0) {
				break;
			}
			if (IMAGE_MEDIA_TYPES[path.extname(target).toLowerCase()]) {
				continue;
			}
			const content = readTextFile(target, Math.min(MAX_MENTION_BYTES, remainingBudget));
			if (content !== undefined) {
				sections.push(`[Attached file: ${path.relative(this.root, target)}]\n${content}`);
				remainingBudget -= Buffer.byteLength(content);
			}
		}
		return sections.join('\n\n');
	}

	imageAttachments(task = ''): ICliImageAttachment[] {
		return this.mentionedFiles(task).flatMap(target => {
			const mediaType = IMAGE_MEDIA_TYPES[path.extname(target).toLowerCase()];
			if (!mediaType) {
				return [];
			}
			try {
				const content = fs.readFileSync(target);
				if (content.byteLength > MAX_IMAGE_BYTES) {
					return [];
				}
				return [{
					path: path.relative(this.root, target),
					dataUrl: `data:${mediaType};base64,${content.toString('base64')}`
				}];
			} catch {
				return [];
			}
		});
	}

	private instructionFiles(): string[] {
		return INSTRUCTION_FILES
			.map(relative => path.join(this.root, relative))
			.flatMap(target => {
				const safeTarget = this.safeExistingFile(target);
				return safeTarget && readTextFile(safeTarget, MAX_INSTRUCTION_BYTES) !== undefined ? [safeTarget] : [];
			});
	}

	private mentionedFiles(task: string): string[] {
		const matches = task.matchAll(/(?:^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/g);
		const result: string[] = [];
		for (const match of matches) {
			const raw = (match[1] ?? match[2] ?? match[3] ?? '').replace(/[).!?]+$/, '');
			if (!raw) {
				continue;
			}
			const target = this.safeExistingFile(path.resolve(this.root, raw));
			if (target && !result.includes(target)) {
				result.push(target);
			}
		}
		return result;
	}

	private safeExistingFile(target: string): string | undefined {
		if (!isInside(this.root, target)) {
			return undefined;
		}
		try {
			const canonicalTarget = fs.realpathSync(target);
			return isInside(this.root, canonicalTarget) && fs.statSync(canonicalTarget).isFile()
				? canonicalTarget
				: undefined;
		} catch {
			return undefined;
		}
	}
}
