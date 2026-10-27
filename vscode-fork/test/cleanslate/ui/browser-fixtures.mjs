import { CLEANSLATE_CHAT_STYLES } from '/vs/workbench/contrib/cleanSlate/browser/chat/styles/cleanSlateChatStyles.js';
import { CleanSlateComposerView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateComposerView.js';
import { CleanSlateCommandApprovalView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlateCommandApprovalView.js';
import { CleanSlatePlanApprovalView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePlanApprovalView.js';
import { CleanSlatePlanningQuestionView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePlanningQuestionView.js';
import { CleanSlatePendingEditsBarView } from '/vs/workbench/contrib/cleanSlate/browser/chat/view/sections/cleanSlatePendingEditsBarView.js';
import { CleanSlatePendingEditsRenderer } from '/vs/workbench/contrib/cleanSlate/browser/chat/renderers/cleanSlatePendingEditsRenderer.js';
import { URI } from '/vs/base/common/uri.js';
import { Registry } from '/vs/platform/registry/common/platform.js';
import { Extensions } from '/vs/platform/theme/common/themeService.js';
import { getIconsStyleSheet } from '/vs/platform/theme/browser/iconsStyleSheet.js';

const style = document.head.appendChild(document.createElement('style'));
style.textContent = CLEANSLATE_CHAT_STYLES;
const icons = getIconsStyleSheet(undefined);
style.textContent += icons.getCSS();
const registry = Registry.as(Extensions.ThemingContribution);
const start = registry.getThemingParticipants().length;
await import('/vs/workbench/contrib/cleanSlate/browser/agentManager/cleanSlateAgentManagerStyles.js');
for (const participant of registry.getThemingParticipants().slice(start)) {
	participant({ getColor: () => undefined }, { addRule: rule => { style.textContent += rule; } });
}
export const events = [];
const record = name => (...args) => events.push({ name, args: args.map(arg => arg instanceof HTMLElement ? arg.className : arg) });
export const qa = globalThis.qa = { events };

export function mountComposer(compact = false) {
	const root = document.getElementById('fixture');
	root.className = 'cleanSlate-chat-view';
	root.style.cssText = 'display:flex;flex-direction:column;justify-content:flex-end;padding:16px;';
	let composer;
	composer = new CleanSlateComposerView(root, {
		compact, workspaceName: 'QA project', onWorkspaceSelector: record('workspace'),
		mountPanels(parent) {
			qa.command = new CleanSlateCommandApprovalView(parent, {
				focusInput: () => composer?.focus(), onApprove: record('approve'), onApproveForSession: record('approveSession'), onCancel: record('cancel'), onDidChange() {},
			});
			qa.plan = new CleanSlatePlanApprovalView(parent, {
				getInputValue: () => composer?.getValue() ?? '', focusInput: () => composer?.focus(), onApprove: record('planApprove'), onRevise: record('planRevise'), onDidChange() {},
			});
			qa.question = new CleanSlatePlanningQuestionView(parent, () => composer?.getInputElement(), () => {}, record('dismissQuestion'));
		},
		onSubmit: record('submit'), onStop: record('stop'), onImageAdded: record('image'), onImageRemoved: record('removeImage'),
		onReasoningSelector: record('reasoning'), onPlanModeCommand: record('plan'), onPlanModeDisabled: record('disablePlan'),
		onModelSelector: record('model'), onAgentSelector: record('agent'), onEditModeSelector: record('editMode'),
		onDeleteAnnotations: record('deleteAnnotations'), onRemoveSelectionReference: record('removeSelection'),
		onKeyDown: event => qa.command.handleKeyDown(event) || qa.question.handleKeyDown(event),
	});
	composer.updateModel('QA Model', false, 'openai', 'qa-model');
	composer.updateReasoning('Medium');
	composer.updateContextWindowUsage({ usedTokens: 25000, maxTokens: 100000, percent: 25, isGenerating: false });
	qa.composer = composer;
	qa.edits = new CleanSlatePendingEditsBarView(root, new CleanSlatePendingEditsRenderer({ read: () => [] }), record('acceptAll'), record('rejectAll'));
	qa.uri = URI;
	return qa;
}

export async function mountSettings(state = 'signedOut') {
	const { CleanSlateSettingsPanel } = await import('/vs/workbench/contrib/cleanSlate/browser/settings/cleanSlateSettingsPanel.js');
	const root = document.getElementById('fixture');
	qa.config = { provider: state === 'signedOut' ? 'openai' : 'cleanslate', providers: { openai: { model: 'qa-model', apiKey: 'qa-only' }, cleanslate: { apiKey: state === 'signedOut' ? '' : 'qa-fake-token' } }, ragEnabled: true, failOnWarnings: true };
	const entitlements = state === 'free' ? {} : { plan: { id: 'pro' }, can_use_managed_ai: state === 'pro', models: [] };
	qa.settings = new CleanSlateSettingsPanel({
		getResolvedConfiguration: async () => qa.config,
		getManagedAccount: () => state === 'signedOut' ? undefined : { email: 'qa@example.test', name: 'QA account' },
		getManagedEntitlements: async () => { if (state === 'unavailable') throw new Error('QA service unavailable'); return entitlements; },
		updateConfiguration: async value => { qa.config = { ...qa.config, ...value, providers: { ...qa.config.providers, ...value.providers } }; events.push({ name: 'save', value }); },
	}, { getModels: async () => ['qa-model', 'qa-alternative'] }, {
		signIn: async () => record('signIn')(), upgradeToPro: async () => record('upgrade')(), signOut: async () => record('signOut')(), manageAccount: async () => record('manageAccount')(),
	}, { listExternalAgents: async () => [], getExternalAgentUsage: async () => ({}), registerExternalAgent: async () => record('registerAgent')() }, undefined, async () => record('importChats')());
	qa.settings.mount(root);
	await qa.settings.render();
	return qa;
}
