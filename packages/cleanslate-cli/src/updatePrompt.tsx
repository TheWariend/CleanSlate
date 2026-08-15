/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { spawnSync } from 'child_process';
import { Box, Text, useApp, useInput } from 'ink';

const PACKAGE_NAME = '@cleanslate/cli';
const REGISTRY_URL = 'https://registry.npmjs.org/@cleanslate%2fcli/latest';

export type UpdatePromptChoice = 'update' | 'skip';

export function isNewerVersion(latest: string, current: string): boolean {
	const parse = (value: string) => value.replace(/^v/, '').split('-')[0].split('.').map(part => Number(part));
	const latestParts = parse(latest);
	const currentParts = parse(current);
	if (latestParts.some(Number.isNaN) || currentParts.some(Number.isNaN)) {
		return false;
	}
	for (let index = 0; index < Math.max(latestParts.length, currentParts.length); index++) {
		const difference = (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
		if (difference !== 0) {
			return difference > 0;
		}
	}
	return false;
}

export async function latestCliVersion(
	fetcher: typeof fetch = fetch,
	timeoutMs = 2500
): Promise<string | undefined> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(REGISTRY_URL, {
			signal: controller.signal,
			headers: { accept: 'application/json' }
		});
		if (!response.ok) {
			return undefined;
		}
		const value = await response.json() as { version?: unknown };
		return typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
}

export function installLatestCli(): { ok: boolean; error?: string } {
	const result = spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], { stdio: 'inherit' });
	return result.status === 0
		? { ok: true }
		: { ok: false, error: result.error?.message ?? `npm exited with status ${result.status ?? 'unknown'}` };
}

export function CleanSlateUpdatePrompt({
	currentVersion,
	latestVersion,
	onSelect
}: {
	currentVersion: string;
	latestVersion: string;
	onSelect: (choice: UpdatePromptChoice) => void;
}) {
	const { exit } = useApp();
	const [selected, setSelected] = useState<UpdatePromptChoice>('update');
	const choose = (choice: UpdatePromptChoice) => {
		onSelect(choice);
		exit();
	};
	useInput((input, key) => {
		if (key.upArrow || key.downArrow || input === 'j' || input === 'k') {
			setSelected(value => value === 'update' ? 'skip' : 'update');
		} else if (input === '1') {
			choose('update');
		} else if (input === '2' || key.escape) {
			choose('skip');
		} else if (key.return) {
			choose(selected);
		}
	});
	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Text bold color="cyan">✨ New update available!</Text>
			<Text dimColor>{currentVersion} → {latestVersion}</Text>
			<Text> </Text>
			<Text inverse={selected === 'update'}>  1. Update now  </Text>
			<Text inverse={selected === 'skip'}>  2. Skip        </Text>
			<Text> </Text>
			<Text dimColor>↑/↓ select · enter confirm</Text>
		</Box>
	);
}
