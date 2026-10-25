import { test, expect, expectUsable } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
	await page.evaluate(async () => (await import('/qa/browser-fixtures.mjs')).mountComposer());
});

test('existing composer controls remain usable after model, mode and agent changes', async ({ page }) => {
	for (const selector of ['.model-dropdown', '.reasoning-dropdown', '.cleanSlate-edit-mode-chip', '.photo-button', '.cleanSlate-agent-dropdown', '.cleanSlate-send-button']) {
		await test.step(`usable ${selector}`, () => expectUsable(page.locator(selector)));
	}
	await page.locator('.model-dropdown').click();
	await page.locator('.reasoning-dropdown').click();
	await page.locator('.cleanSlate-edit-mode-chip').click();
	await page.locator('.cleanSlate-agent-dropdown').click();
	await expect.poll(() => page.evaluate(() => qa.events.map(e => e.name))).toEqual(['model', 'reasoning', 'editMode', 'agent']);
	await page.evaluate(() => { qa.composer.setExternalRuntime('External QA'); qa.composer.setExternalRuntime(undefined); qa.composer.updateModel('Restored QA Model', false, 'openai', 'qa'); qa.composer.updatePlanMode(true); });
	await expectUsable(page.locator('.reasoning-dropdown'));
	await expectUsable(page.locator('.cleanSlate-edit-mode-chip'));
	await expectUsable(page.locator('.cleanSlate-plan-mode-chip'));
	await page.locator('.cleanSlate-plan-mode-chip').click();
	await expect.poll(() => page.evaluate(() => qa.events.at(-1).name)).toBe('disablePlan');
});

test('send, multiline entry, stop and a subsequent turn keep separate actions', async ({ page }) => {
	const input = page.locator('textarea');
	await input.fill('First line');
	await input.press('Shift+Enter');
	await input.press('x');
	await expect(input).toHaveValue('First line\nx');
	await page.getByRole('button', { name: 'Send message', exact: true }).click();
	await page.evaluate(() => { qa.composer.setGenerating(true); qa.composer.setCommandApprovalPending(true); });
	await expect(input).toHaveAttribute('aria-readonly', 'true');
	await page.getByRole('button', { name: 'Stop generation', exact: true }).click();
	await page.evaluate(() => { qa.composer.setGenerating(false); qa.composer.setCommandApprovalPending(false); });
	await input.fill('Next turn');
	await input.press('Enter');
	await expect.poll(() => page.evaluate(() => qa.events.map(e => e.name))).toEqual(['submit', 'stop', 'submit']);
});

test('command approval supports session approval, rejection and re-entry', async ({ page }) => {
	const request = { id: 'command-1', command: 'npm run build', cwd: '/qa/workspace' };
	await page.evaluate(request => qa.command.update(request), request);
	await expectUsable(page.locator('.cleanSlate-command-approval-submit'));
	await page.locator('.cleanSlate-command-approval-option[data-choice="approveSession"]').click();
	await page.locator('.cleanSlate-command-approval-submit').click();
	await expect(page.locator('.cleanSlate-command-approval')).toBeHidden();
	await page.evaluate(request => qa.command.update({ ...request, id: 'command-2' }), request);
	await page.locator('textarea').press('Escape');
	await expect.poll(() => page.evaluate(() => qa.events.map(e => e.name))).toEqual(['approveSession', 'cancel']);
});

test('plan revision requires input and dismiss does not approve', async ({ page }) => {
	await page.evaluate(() => qa.plan.updateVisibility(true));
	await page.locator('.cleanSlate-plan-approval-option[data-choice="revise"]').click();
	await page.locator('.cleanSlate-plan-approval-submit').click();
	await expect(page.locator('.cleanSlate-plan-approval')).toBeVisible();
	await page.locator('textarea').fill('Keep the existing navigation');
	await page.locator('.cleanSlate-plan-approval-submit').click();
	await expect.poll(() => page.evaluate(() => qa.events.map(e => e.name))).toEqual(['planRevise']);
	await page.evaluate(() => qa.plan.updateVisibility(true));
	await page.locator('.cleanSlate-plan-approval-dismiss').click();
	await expect(page.locator('.cleanSlate-plan-approval')).toBeHidden();
	await expect(page.locator('textarea')).toBeFocused();
});

test('question choices, custom answers and cancellation preserve the composer', async ({ page }) => {
	await page.evaluate(() => qa.question.show({ question: 'Which route?', options: [{ label: 'Keep sidebar' }, { label: 'Use tabs' }], allowCustom: true }));
	await page.locator('textarea').press('ArrowDown');
	await expect(page.locator('.cleanSlate-planning-question-option.selected')).toContainText('Use tabs');
	const submission = await page.evaluate(() => qa.question.consumeSubmission());
	expect(submission.message).toContain('Selected option: Use tabs');
	await page.evaluate(() => qa.question.show({ question: 'Anything else?', options: [{ label: 'Continue' }], allowCustom: true }));
	await page.locator('.cleanSlate-planning-question-dismiss').click();
	await expect(page.locator('.cleanSlate-planning-question')).toBeHidden();
	await expect(page.locator('textarea')).toBeFocused();
});

test('pending edits keep accept and reject usable and clear after resolution', async ({ page }) => {
	await page.evaluate(() => qa.edits.render([{ uri: qa.uri.file('/qa/feature.ts'), added: 12, deleted: 3 }]));
	for (const name of ['Accept all', 'Reject all']) { await expectUsable(page.getByRole('button', { name, exact: true })); }
	await page.getByRole('button', { name: 'Accept all', exact: true }).click();
	await page.getByRole('button', { name: 'Reject all', exact: true }).click();
	await expect.poll(() => page.evaluate(() => qa.events.map(e => e.name))).toEqual(['acceptAll', 'rejectAll']);
	await page.evaluate(() => qa.edits.render([]));
	await expect(page.locator('.cleanSlate-global-status-container')).toBeHidden();
});

test('slash command discovery remains inside the viewport and keyboard dismisses it', async ({ page }) => {
	await page.locator('textarea').fill('/');
	await expect(page.locator('.cleanSlate-agent-popup')).toBeVisible();
	await expectUsable(page.locator('.cleanSlate-agent-popup-item').first());
	await page.locator('textarea').press('Escape');
	await expect(page.locator('.cleanSlate-agent-popup')).not.toHaveClass(/visible/);
	await expect(page.locator('.cleanSlate-agent-popup')).toHaveCSS('opacity', '0');
	await expect(page.locator('.cleanSlate-agent-popup')).toHaveCSS('pointer-events', 'none');
});

test('composer and approval appearance @visual', async ({ page }) => {
	await page.locator('textarea').fill('Keep existing features working while adding the next one.');
	await page.evaluate(() => qa.command.update({ id: 'visual', command: 'npm run build', cwd: '/qa/project' }));
	await expect(page.locator('.cleanSlate-chat-input-container')).toHaveScreenshot('composer-approval.png');
});
