/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';

export async function finishProjectSetup(page) {
	const trust = page.getByRole('button', { name: 'Trust Folder & Continue', exact: true });
	const skipImport = page.getByRole('button', { name: 'Not now', exact: true });
	await expect(trust.or(skipImport)).toBeVisible({ timeout: 30_000 });
	if (await trust.isVisible()) { await trust.click(); }
	await expect(skipImport).toBeVisible({ timeout: 30_000 });
	await skipImport.click();
	await expect(page.locator('.monaco-dialog-modal-block')).toBeHidden();
}
