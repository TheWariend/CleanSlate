/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import {
	AIProvider,
	CleanSlateBedrockCredentialMode,
	CleanSlateEmbeddingProvider,
	ICleanSlateConfiguration,
	ICleanSlateConfigurationService,
	ICleanSlateManagedAccount,
	ICleanSlateManagedEntitlements,
	ICleanSlateProviderConfigurations,
	ICleanSlateService
} from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { setCleanSlateProviderLogo } from '../chat/providers/cleanSlateProviderLogos.js';
import { CLEANSLATE_ACTION_BUTTON_STYLES, createCleanSlateActionButton } from '../cleanSlateActionButton.js';

type FieldType = 'text' | 'password' | 'number';
type SettingSectionId = 'general' | 'usage' | 'models' | 'apiKeys' | 'verification' | 'indexing';

interface ITextRowOptions {
	readonly label: string;
	readonly description?: string;
	readonly value: string | number | undefined;
	readonly placeholder?: string;
	readonly type?: FieldType;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => Promise<void>;
}

interface ISelectRowOption {
	readonly label: string;
	readonly value: string;
	readonly creditsLocked?: boolean;
}

interface ICleanSlateSettingsPanelMountOptions {
	readonly saveStatusHost?: HTMLElement;
	readonly sidebarHeader?: (parent: HTMLElement) => void;
}

interface ICleanSlateSettingsAccountActions {
	readonly signIn: () => Promise<void>;
	readonly upgradeToPro: () => Promise<void>;
	readonly signOut?: () => Promise<void>;
	readonly manageAccount?: () => Promise<void>;
}

type CleanSlateManagedAccessState =
	| { readonly kind: 'signedOut' }
	| { readonly kind: 'reauthenticate'; readonly message: string }
	| { readonly kind: 'free'; readonly entitlements: ICleanSlateManagedEntitlements }
	| { readonly kind: 'pro'; readonly entitlements: ICleanSlateManagedEntitlements }
	| { readonly kind: 'unavailable'; readonly entitlements?: ICleanSlateManagedEntitlements; readonly message: string };

const CLEANSLATE_NVIDIA_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const CLEANSLATE_OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const CLEANSLATE_DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/**
 * Shared settings panel renderer used by both `CleanSlateSettingsEditor` (editor tab)
 * and the Agent Manager inline settings overlay.
 *
 * Call `mount(parent)` to build the DOM, then `render()` to populate it with live config.
 */
export class CleanSlateSettingsPanel {

	/** Managed-AI reasons that mean access is currently gated by a spent limit. */
	private static readonly USAGE_LIMIT_REASONS: readonly string[] = [
		'budget_exhausted',
		'token_limit_exhausted',
		'daily_limit_exhausted',
		'weekly_limit_exhausted',
		'monthly_limit_exhausted',
	];

	private sidebar!: HTMLElement;
	private content!: HTMLElement;
	private saveStatus!: HTMLElement;
	private sectionRoot: HTMLElement | undefined;
	private sidebarHeader: ((parent: HTMLElement) => void) | undefined;
	private activeSection: SettingSectionId = 'general';
	private saveCounter = 0;
	private usageError: string | undefined;
	private usageFetchedAt: number | undefined;
	private resetCountdownHandle: number | undefined;
	private resetCountdownTargets: { readonly el: HTMLElement; readonly resetsAt: string }[] = [];
	private resetRefreshInFlight = false;
	private usageRefreshInFlight = false;
	private readonly resetRefreshRetryAt = new Map<string, number>();

	constructor(
		private readonly configService: ICleanSlateConfigurationService,
		private readonly cleanSlateService: ICleanSlateService,
		private readonly accountActions?: ICleanSlateSettingsAccountActions,
	) { }

	/**
	 * Builds the panel DOM inside `parent` and triggers an initial render.
	 * Returns the root container element.
	 */
	mount(parent: HTMLElement, options: ICleanSlateSettingsPanelMountOptions = {}): HTMLElement {
		this.sidebarHeader = options.sidebarHeader;
		const shell = dom.append(parent, dom.$('.cleanSlate-settings-panel-shell'));
		this.installSelectStyles(shell);
		this.installAccountStyles(shell);
		this.sidebar = dom.append(shell, dom.$('aside.cleanSlate-settings-sidebar'));
		this.content = dom.append(shell, dom.$('main.cleanSlate-settings-content'));
		if (options.saveStatusHost) {
			this.saveStatus = options.saveStatusHost;
		}
		void this.render();
		return shell;
	}

	private installSelectStyles(shell: HTMLElement): void {
		const style = dom.append(shell, dom.$('style'));
		style.textContent = `
			.cleanSlate-settings-panel-shell { --cs-border:color-mix(in srgb, var(--vscode-foreground) 9%, transparent); --cs-accent:var(--vscode-textLink-foreground, var(--vscode-button-background)); }
			.cleanSlate-select-host { position:relative; width:100%; }
			.cleanSlate-select { box-sizing:border-box; width:100%; height:28px; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 9px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border, transparent); border-radius:5px; font:inherit; font-size:12px; cursor:pointer; outline:none; text-align:left; }
			.cleanSlate-select:hover:not(.disabled) { border-color:color-mix(in srgb, var(--vscode-foreground) 22%, var(--vscode-input-border, transparent)); }
			.cleanSlate-select.open { border-color:var(--vscode-focusBorder); }
			.cleanSlate-select.disabled { opacity:.6; cursor:default; }
			.cleanSlate-select-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
			.cleanSlate-select-chevron { flex:0 0 auto; font-size:15px; color:var(--vscode-descriptionForeground); transition:transform .15s ease; }
			.cleanSlate-select.open .cleanSlate-select-chevron { transform:rotate(180deg); }
			.cleanSlate-select-menu { position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:120; max-height:288px; overflow-y:auto; padding:5px; background:var(--vscode-dropdown-background, var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)))); border:1px solid var(--vscode-dropdown-border, var(--cs-border)); border-radius:11px; box-shadow:0 16px 40px -14px rgba(0,0,0,.65); scrollbar-width:thin; }
			.cleanSlate-select-option { box-sizing:border-box; width:100%; display:flex; align-items:center; gap:8px; padding:7px 9px; border:0; border-radius:7px; background:transparent; color:var(--vscode-foreground); font:inherit; font-size:13px; text-align:left; cursor:pointer; }
			.cleanSlate-select-option + .cleanSlate-select-option { margin-top:1px; }
			.cleanSlate-select-option:hover { background:color-mix(in srgb, var(--vscode-foreground) 9%, transparent); }
			.cleanSlate-select-option.selected { background:color-mix(in srgb, var(--cs-accent) 18%, transparent); }
			.cleanSlate-select-option.is-credits-locked { color:var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); cursor:default; }
			.cleanSlate-select-option.is-credits-locked:hover { background:transparent; }
			.cleanSlate-select-check { flex:0 0 auto; font-size:13px; color:var(--cs-accent); }
			.cleanSlate-select-model-logo { width:16px; height:16px; flex:0 0 16px; background-color:currentColor; mask-position:center; mask-repeat:no-repeat; mask-size:contain; -webkit-mask-position:center; -webkit-mask-repeat:no-repeat; -webkit-mask-size:contain; opacity:.9; }
			.cleanSlate-select-option-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
			.cleanSlate-select-option-credits { flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; color:var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); font-size:11px; }
			.cleanSlate-select-option-credits .codicon { font-size:12px; }
		`;
	}

	setSaveStatusElement(el: HTMLElement): void {
		this.saveStatus = el;
	}

	async render(options: { preserveScroll?: boolean; restoreScrollTop?: number; scrollToSection?: SettingSectionId } = {}): Promise<void> {
		const previousScrollTop = options.restoreScrollTop ?? this.content?.scrollTop ?? 0;
		if (options.scrollToSection) {
			this.activeSection = options.scrollToSection;
		}
		const config = await this.configService.getResolvedConfiguration();
		const account = this.configService.getManagedAccount();
		const usage = account ? await this.configService.getManagedEntitlements().catch(error => {
			this.usageError = error instanceof Error ? error.message : String(error);
			return undefined;
		}) : undefined;
		if (usage) {
			this.usageError = undefined;
			this.usageFetchedAt = Date.now();
		}
		const managedAccess = config.provider === 'cleanslate'
			? this.resolveManagedAccessFromResult(config, usage, this.usageError)
			: undefined;
		this.stopResetCountdown();
		dom.clearNode(this.sidebar);
		dom.clearNode(this.content);

		this.renderSidebar();
		this.renderContent(config, managedAccess, usage, account);

		if (options.preserveScroll || options.restoreScrollTop !== undefined) {
			this.restoreContentScrollTop(previousScrollTop);
		}
	}

	// ─── Sidebar ──────────────────────────────────────────────────────────────

	private renderSidebar(): void {
		if (this.sidebarHeader) {
			const header = dom.append(this.sidebar, dom.$('.cleanSlate-settings-sidebar-header'));
			this.sidebarHeader(header);
		}

		const sections: readonly { id: SettingSectionId; label: string; icon: ThemeIcon }[] = [
			{ id: 'general', label: 'General', icon: Codicon.settingsGear },
			{ id: 'usage', label: 'Usage', icon: Codicon.graph },
			{ id: 'models', label: 'Models', icon: Codicon.symbolClass },
			{ id: 'apiKeys', label: 'API Keys', icon: Codicon.key },
			{ id: 'verification', label: 'Verification', icon: Codicon.checklist },
			{ id: 'indexing', label: 'Indexing & Docs', icon: Codicon.database }
		];

		const nav = dom.append(this.sidebar, dom.$('nav.cleanSlate-settings-nav'));
		for (const section of sections) {
			const item = dom.append(nav, dom.$('button.cleanSlate-settings-nav-item')) as HTMLButtonElement;
			item.type = 'button';
			item.classList.toggle('active', this.activeSection === section.id);
			dom.append(item, dom.$(`span${ThemeIcon.asCSSSelector(section.icon)}`));
			dom.append(item, dom.$('span')).textContent = section.label;
			item.dataset.section = section.id;
			item.onclick = () => {
				this.activeSection = section.id;
				void this.render();
			};
		}
	}

	// ─── Content sections ─────────────────────────────────────────────────────

	private renderContent(config: ICleanSlateConfiguration, managedAccess?: CleanSlateManagedAccessState, usage?: ICleanSlateManagedEntitlements, account?: ICleanSlateManagedAccount): void {
		switch (this.activeSection) {
			case 'general': this.renderSection('general', 'General', () => this.renderGeneral(usage, account)); break;
			case 'usage': this.renderSection('usage', 'Plan usage limits', () => this.renderUsage(usage)); break;
			case 'models': this.renderSection('models', 'Models', () => this.renderModels(config, managedAccess)); break;
			case 'apiKeys': this.renderSection('apiKeys', 'API Keys', () => this.renderApiKeys(config)); break;
			case 'verification': this.renderSection('verification', 'Verification', () => this.renderVerification(config)); break;
			case 'indexing': this.renderSection('indexing', 'Indexing & Docs', () => this.renderIndexing(config)); break;
		}
	}

	private renderSection(id: SettingSectionId, title: string, render: () => void): void {
		const previousRoot = this.sectionRoot;
		const section = dom.append(this.content, dom.$('section.cleanSlate-settings-page-section'));
		section.dataset.section = id;
		dom.append(section, dom.$('h2.cleanSlate-settings-page-section-title')).textContent = title;
		this.sectionRoot = section;
		render();
		this.sectionRoot = previousRoot;
	}

	private renderGeneral(usage?: ICleanSlateManagedEntitlements, account?: ICleanSlateManagedAccount): void {
		const isFreePlan = !!usage && ((!usage.plan && !usage.managed_ai) || usage.plan?.id === 'free');
		const group = this.createGroup();

		if (!account) {
			this.createGeneralRow(group, 'CleanSlate Account', 'Sign in to sync your subscription and billing.', { label: 'Sign in', action: this.accountActions?.signIn, variant: 'secondary', trailingIcon: 'link-external' });
			return;
		}

		const reauth = this.isReauthenticationError(this.usageError);
		const accountSubtitle = account.email || 'Manage your account and billing';
		this.createGeneralRow(group, 'CleanSlate Account', accountSubtitle, reauth
			? { label: 'Sign in again', action: this.accountActions?.signIn, variant: 'secondary' }
			: { label: 'Open', action: this.accountActions?.manageAccount, variant: 'secondary', trailingIcon: 'link-external' });

		if (isFreePlan) {
			this.createGeneralRow(group, 'Upgrade to Pro', usage?.managed_ai
				? 'Unlock more managed models, higher usage limits, and pay-as-you-go credits.'
				: 'Access managed models, higher usage limits, and pay-as-you-go credits.', { label: 'Upgrade', action: this.accountActions?.upgradeToPro, variant: 'primary', leadingIcon: 'arrow-circle-up' });
		}

		this.createGeneralRow(group, 'Sign Out', 'Sign out of CleanSlate on this device.', { label: 'Sign out', action: this.accountActions?.signOut, variant: 'secondary' });
	}

	private createGeneralRow(parent: HTMLElement, title: string, description: string, opts: { label: string; action?: () => Promise<void>; variant: 'primary' | 'secondary'; leadingIcon?: string; trailingIcon?: string; reRender?: boolean }): void {
		const value = this.createRow(parent, title, description);
		this.createSettingsActionButton(value, opts);
	}

	private createSettingsActionButton(parent: HTMLElement, opts: { label: string; action?: () => Promise<void>; variant: 'primary' | 'secondary'; leadingIcon?: string; trailingIcon?: string; reRender?: boolean }): HTMLButtonElement {
		return createCleanSlateActionButton(parent, {
			...opts,
			afterAction: opts.reRender ? () => this.render({ preserveScroll: true }) : undefined
		});
	}

	private renderUsage(usage?: ICleanSlateManagedEntitlements): void {
		// Any previous countdown belongs to now-detached DOM; drop it before we rebuild.
		this.stopResetCountdown();
		const dashboard = dom.append(this.sectionRoot ?? this.content, dom.$('.cleanSlate-usage-page'));
		if (!usage) {
			const empty = dom.append(dashboard, dom.$('.cleanSlate-pro-empty'));
			dom.append(empty, dom.$('span.codicon.codicon-warning'));
			dom.append(empty, dom.$('span')).textContent = this.usageError || 'Usage is unavailable. Sign in to CleanSlate and try again.';
			this.createUsageActions(dashboard);
			return;
		}

		const isFreePlan = !usage.plan && !usage.managed_ai;
		const isManagedFreePlan = usage.plan?.id === 'free';
		const planHeading = dom.append(dashboard, dom.$('.cleanSlate-usage-title'));
		dom.append(planHeading, dom.$('strong')).textContent = usage.plan?.name || (isFreePlan ? 'Free plan' : 'CleanSlate Pro');
		dom.append(planHeading, dom.$('span')).textContent = isFreePlan
			? 'Upgrade to CleanSlate Pro for higher limits'
			: isManagedFreePlan
				? 'Your free allowance refreshes every month. Upgrade to Pro for more.'
			: 'Your included limits reset automatically';

		// Free accounts do not have meaningful managed-usage limits to report.
		if (isFreePlan) {
			this.createUpgradeCard(dashboard);
			return;
		}

		// Surface an exhausted-limit banner when the backend reports the account is
		// currently gated. This is the limit the user actually hit (e.g. the monthly
		// budget), which is otherwise easy to miss behind healthy daily/weekly meters.
		if (usage.managed_ai_reason && CleanSlateSettingsPanel.USAGE_LIMIT_REASONS.includes(usage.managed_ai_reason)) {
			const alert = dom.append(dashboard, dom.$('.cleanSlate-usage-alert'));
			dom.append(alert, dom.$('span.codicon.codicon-warning'));
			dom.append(alert, dom.$('span')).textContent = this.managedAccessMessage(usage.managed_ai_reason, isManagedFreePlan);
		}

		const limits = dom.append(dashboard, dom.$('.cleanSlate-usage-limits'));

		// Free has one monthly provider-budget allowance. Show only its percentage
		// so the user understands the real gate without exposing internal cost.
		if (isManagedFreePlan) {
			this.createUsageLimitRow(limits, 'Monthly allowance', this.usedBudgetPercent(usage), 100, usage.resets_at?.monthly ?? usage.period?.end);
		}

		// Pro surfaces its rolling session and weekly windows. Its internal
		// dollar budget remains private.
		const dailyLimit = Number(usage.limits?.daily_action_limit || 0);
		const weeklyLimit = Number(usage.limits?.weekly_action_limit || 0);
		if (!isManagedFreePlan && dailyLimit > 0) {
			this.createUsageLimitRow(limits, 'Session limit', this.usedActions(dailyLimit, usage.limits?.remaining_daily_actions, usage.usage?.daily_requests), dailyLimit, usage.resets_at?.daily);
		}
		if (!isManagedFreePlan && weeklyLimit > 0) {
			this.createUsageLimitRow(limits, 'Weekly limit', this.usedActions(weeklyLimit, usage.limits?.remaining_weekly_actions, usage.usage?.weekly_requests), weeklyLimit, usage.resets_at?.weekly);
		}
		this.startResetCountdown();
		const updated = dom.append(dashboard, dom.$('.cleanSlate-usage-updated'));
		dom.append(updated, dom.$('span')).textContent = `Last updated ${this.formatUpdatedAt()}`;
		const inlineRefresh = dom.append(updated, dom.$('button.cleanSlate-usage-refresh-control')) as HTMLButtonElement;
		inlineRefresh.type = 'button';
		inlineRefresh.title = 'Refresh usage';
		dom.append(inlineRefresh, dom.$('span.codicon.codicon-refresh'));
		inlineRefresh.onclick = () => void this.refreshUsage();

		if (isManagedFreePlan) {
			this.createUpgradeCard(dashboard, true);
		} else {
			const credits = dom.append(dashboard, dom.$('.cleanSlate-usage-credits'));
			dom.append(credits, dom.$('h3')).textContent = 'Usage credits';
			const creditRow = dom.append(credits, dom.$('.cleanSlate-usage-credit-row'));
			const creditCopy = dom.append(creditRow, dom.$('div'));
			dom.append(creditCopy, dom.$('strong')).textContent = `$${(Number(usage.credits?.balance_cents || 0) / 100).toFixed(2)} available`;
			dom.append(creditCopy, dom.$('span')).textContent = 'Credits keep CleanSlate working after you reach a plan limit.';
			const creditBadge = dom.append(creditRow, dom.$('.cleanSlate-usage-credit-badge'));
			creditBadge.textContent = Number(usage.credits?.balance_cents || 0) > 0 ? 'Active' : 'No credits';
		}
		this.createUsageActions(dashboard);
	}

	private createUsageLimitRow(parent: HTMLElement, label: string, used: number, limit: number, resetsAt?: string): void {
		const row = dom.append(parent, dom.$('.cleanSlate-usage-limit-row'));
		const copy = dom.append(row, dom.$('.cleanSlate-usage-limit-copy'));
		dom.append(copy, dom.$('strong')).textContent = label;
		const resetEl = dom.append(copy, dom.$('span.cleanSlate-usage-limit-reset'));
		if (resetsAt) {
			resetEl.textContent = this.formatResetCountdown(resetsAt);
			// Registered for the 1s live tick started in renderUsage.
			this.resetCountdownTargets.push({ el: resetEl, resetsAt });
		} else {
			resetEl.textContent = 'Reset time unavailable';
		}
		const meter = dom.append(row, dom.$('.cleanSlate-usage-limit-meter'));
		const track = dom.append(meter, dom.$('.cleanSlate-usage-limit-track'));
		const usedPercent = limit > 0 ? Math.round((Math.min(limit, Math.max(0, used)) / limit) * 100) : 0;
		const fill = dom.append(track, dom.$('.cleanSlate-usage-limit-fill'));
		if (limit > 0 && used >= limit) {
			fill.classList.add('cleanSlate-usage-limit-fill--full');
		}
		fill.style.width = `${usedPercent}%`;
		// Pro's budget-derived meters use the established 0–100 scale; Free uses
		// a real request allowance, which is clearer as "N of limit".
		dom.append(meter, dom.$('.cleanSlate-usage-limit-percent')).textContent = limit === 100
			? `${usedPercent}% used`
			: `${Math.min(limit, Math.max(0, used))} of ${limit} used`;
	}

	private createUpgradeCard(parent: HTMLElement, isManagedFreePlan = false): void {
		const card = dom.append(parent, dom.$('.cleanSlate-upgrade-card'));
		const head = dom.append(card, dom.$('.cleanSlate-upgrade-head'));
		dom.append(head, dom.$('span.cleanSlate-upgrade-icon.codicon.codicon-sparkle-filled'));
		const headCopy = dom.append(head, dom.$('.cleanSlate-upgrade-headcopy'));
		dom.append(headCopy, dom.$('strong')).textContent = 'CleanSlate Pro';
		dom.append(headCopy, dom.$('span')).textContent = isManagedFreePlan
			? 'Unlock more models, higher limits, and usage credits.'
			: 'Unlock managed models, higher limits, and usage credits.';

		const featureList = dom.append(card, dom.$('ul.cleanSlate-upgrade-features'));
		const features = isManagedFreePlan
			? ['More managed models, ready to use', 'Higher session & weekly usage limits', 'Pay-as-you-go credits when you need more']
			: ['Frontier managed models, ready to use', 'Higher session & weekly usage limits', 'Pay-as-you-go credits when you need more'];
		for (const feature of features) {
			const item = dom.append(featureList, dom.$('li'));
			dom.append(item, dom.$('span.codicon.codicon-check'));
			dom.append(item, dom.$('span')).textContent = feature;
		}

		this.createSettingsActionButton(card, {
			label: 'Upgrade to Pro',
			action: this.accountActions?.upgradeToPro,
			variant: 'primary',
			leadingIcon: 'arrow-circle-up'
		});
	}

	private createUsageActions(parent: HTMLElement): void {
		if (this.isReauthenticationError(this.usageError)) {
			this.createUsageAccountAction(parent, 'Sign in again');
			return;
		}
		const actions = dom.append(parent, dom.$('.cleanSlate-pro-actions'));
		const button = dom.append(actions, dom.$('button.cleanSlate-pro-button.cleanSlate-usage-refresh-button.cleanSlate-usage-refresh-control')) as HTMLButtonElement;
		button.type = 'button';
		dom.append(button, dom.$('span.codicon.codicon-refresh'));
		dom.append(button, dom.$('span')).textContent = 'Refresh usage';
		button.onclick = () => void this.refreshUsage();
	}

	private createUsageAccountAction(parent: HTMLElement, label: string): void {
		const actions = dom.append(parent, dom.$('.cleanSlate-pro-actions'));
		const button = dom.append(actions, dom.$('button.cleanSlate-pro-button')) as HTMLButtonElement;
		button.type = 'button';
		button.disabled = !this.accountActions?.signIn;
		dom.append(button, dom.$('span.codicon.codicon-account'));
		dom.append(button, dom.$('span')).textContent = label;
		button.onclick = () => void this.accountActions?.signIn();
	}

	/**
	 * Authoritative "used" count: trust the backend's remaining-actions figure
	 * (limit − remaining) over the raw request tally, so the meter matches what
	 * actually gates the user. Falls back to the request count only when
	 * remaining is absent.
	 */
	private usedActions(limit: number, remaining: number | undefined, requests: number | undefined): number {
		const used = typeof remaining === 'number' && Number.isFinite(remaining)
			? limit - remaining
			: Number(requests || 0);
		return Math.min(limit, Math.max(0, used));
	}

	/** Live rolling-window countdown, e.g. "Resets in 4h 19m 58s" — ticked once a second. */
	private formatResetCountdown(value: string): string {
		const resetAt = new Date(value).getTime();
		if (!Number.isFinite(resetAt)) {
			return 'Resets soon';
		}
		let seconds = Math.ceil((resetAt - Date.now()) / 1000);
		if (seconds <= 0) {
			return 'Resetting…';
		}
		const days = Math.floor(seconds / 86400); seconds -= days * 86400;
		const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
		const minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
		const parts: string[] = [];
		if (days > 0) { parts.push(`${days}d`); }
		if (days > 0 || hours > 0) { parts.push(`${hours}h`); }
		parts.push(`${minutes}m`, `${seconds}s`);
		return `Resets in ${parts.join(' ')}`;
	}

	private startResetCountdown(): void {
		const win = this.content?.ownerDocument.defaultView;
		if (!win || this.resetCountdownTargets.length === 0) {
			return;
		}
		const currentResetTimes = new Set(this.resetCountdownTargets.map(target => target.resetsAt));
		for (const resetTime of this.resetRefreshRetryAt.keys()) {
			if (!currentResetTimes.has(resetTime)) {
				this.resetRefreshRetryAt.delete(resetTime);
			}
		}
		this.resetCountdownHandle = win.setInterval(() => {
			const live = this.resetCountdownTargets.filter(target => target.el.isConnected);
			if (live.length === 0) {
				// Panel was torn down without a re-render; stop ticking rather than leak.
				this.stopResetCountdown();
				return;
			}
			for (const target of live) {
				target.el.textContent = this.formatResetCountdown(target.resetsAt);
			}
			this.refreshUsageForExpiredWindows(live);
		}, 1000);
	}

	private refreshUsageForExpiredWindows(targets: readonly { readonly resetsAt: string }[]): void {
		if (this.resetRefreshInFlight) {
			return;
		}
		const now = Date.now();
		const expired = targets.filter(target => {
			const resetAt = new Date(target.resetsAt).getTime();
			return Number.isFinite(resetAt) && resetAt <= now;
		});
		if (expired.length === 0 || expired.every(target => (this.resetRefreshRetryAt.get(target.resetsAt) ?? 0) > now)) {
			return;
		}

		// The server owns usage windows and reset timestamps. Re-fetch once a
		// window expires instead of leaving the locally-rendered countdown at
		// "Resetting…". A short retry delay accommodates backends that roll the
		// window over asynchronously without creating a request every second.
		for (const target of expired) {
			this.resetRefreshRetryAt.set(target.resetsAt, now + 5000);
		}
		this.resetRefreshInFlight = true;
		void this.render({ preserveScroll: true }).finally(() => {
			this.resetRefreshInFlight = false;
		});
	}

	private stopResetCountdown(): void {
		if (this.resetCountdownHandle !== undefined) {
			this.content?.ownerDocument.defaultView?.clearInterval(this.resetCountdownHandle);
			this.resetCountdownHandle = undefined;
		}
		this.resetCountdownTargets = [];
	}

	/**
	 * `getManagedEntitlements` is a live round trip, but `render` only swaps the DOM once
	 * it resolves — so without this the refresh controls sit there looking untouched for
	 * the whole request, and an unchanged usage figure makes a successful refresh
	 * indistinguishable from a dead button.
	 */
	private async refreshUsage(): Promise<void> {
		if (this.usageRefreshInFlight) {
			return;
		}
		this.setUsageRefreshPending(true);
		try {
			await this.render({ preserveScroll: true });
		} finally {
			// The re-render above replaced these controls; clear the flag so the fresh ones
			// are interactive, and fall back to un-marking any that survived.
			this.setUsageRefreshPending(false);
		}
	}

	private setUsageRefreshPending(pending: boolean): void {
		this.usageRefreshInFlight = pending;
		const controls = this.content?.querySelectorAll<HTMLButtonElement>('.cleanSlate-usage-refresh-control') ?? [];
		for (const control of controls) {
			control.disabled = pending;
			// The spin comes from the stylesheet below, not `codicon-modifier-spin` — that
			// modifier only animates a whitelist of icons, which codicon-refresh is not on.
			control.classList.toggle('is-refreshing', pending);
		}
	}

	private formatUpdatedAt(): string {
		if (!this.usageFetchedAt) {
			return 'just now';
		}
		const seconds = Math.max(0, Math.round((Date.now() - this.usageFetchedAt) / 1000));
		if (seconds < 45) {
			return 'just now';
		}
		if (seconds < 3600) {
			return `${Math.round(seconds / 60)}m ago`;
		}
		return new Date(this.usageFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	}

	private installAccountStyles(shell: HTMLElement): void {
		const style = dom.append(shell, dom.$('style'));
		style.textContent = `
			${CLEANSLATE_ACTION_BUTTON_STYLES}
			.cleanSlate-settings-panel-shell {
				--cs-surface: color-mix(in srgb, var(--vscode-foreground) 3.5%, transparent);
				--cs-surface-strong: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
				--cs-border: color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
				--cs-border-soft: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
				--cs-accent: var(--vscode-textLink-foreground, var(--vscode-button-background));
			}

			/* ── Usage ───────────────────────────────────────────────── */
			.cleanSlate-usage-page { display:flex; flex-direction:column; gap:20px; width:100%; }
			.cleanSlate-usage-title { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; padding:2px 0 4px; }
			.cleanSlate-usage-title strong { font-size:16px; font-weight:400; letter-spacing:-.01em; }
			.cleanSlate-usage-title span { color:var(--vscode-descriptionForeground); font-size:12.5px; }

			.cleanSlate-usage-limits { display:flex; flex-direction:column; border:1px solid var(--cs-border); border-radius:16px; background:var(--cs-surface); overflow:hidden; }
			.cleanSlate-usage-limit-row { display:grid; grid-template-columns:190px 1fr; align-items:center; gap:32px; padding:22px 24px; }
			.cleanSlate-usage-limit-row + .cleanSlate-usage-limit-row { border-top:1px solid var(--cs-border-soft); }
			.cleanSlate-usage-limit-copy { display:flex; flex-direction:column; gap:5px; }
			.cleanSlate-usage-limit-copy strong { font-size:14px; font-weight:600; letter-spacing:-.01em; }
			.cleanSlate-usage-limit-copy span { color:var(--vscode-descriptionForeground); font-size:11.5px; }
			.cleanSlate-usage-limit-meter { display:grid; grid-template-columns:1fr 62px; align-items:center; gap:16px; }
			.cleanSlate-usage-limit-track { height:7px; border-radius:999px; background:color-mix(in srgb, var(--vscode-foreground) 9%, transparent); overflow:hidden; box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--vscode-foreground) 4%, transparent); }
			.cleanSlate-usage-limit-fill { height:100%; min-width:7px; border-radius:inherit; background:linear-gradient(90deg, color-mix(in srgb, var(--cs-accent) 70%, transparent), var(--cs-accent)); transition:width .35s cubic-bezier(.4,0,.2,1); }
			.cleanSlate-usage-limit-fill--full { background:linear-gradient(90deg, color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 70%, transparent), var(--vscode-inputValidation-warningBorder, #cca700)); }
			.cleanSlate-usage-limit-percent { text-align:right; color:var(--vscode-foreground); font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; }

			.cleanSlate-usage-alert { display:flex; align-items:center; gap:10px; padding:13px 16px; border:1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 55%, transparent); border-radius:14px; background:color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 8%, transparent); color:var(--vscode-foreground); font-size:12.5px; line-height:1.45; }
			.cleanSlate-usage-alert .codicon { flex:0 0 auto; font-size:15px; color:var(--vscode-inputValidation-warningBorder, #cca700); }

			.cleanSlate-usage-updated { display:flex; align-items:center; gap:8px; padding:0 2px; color:var(--vscode-descriptionForeground); font-size:11.5px; }
			.cleanSlate-usage-updated button { display:inline-flex; align-items:center; justify-content:center; border:0; background:transparent; color:inherit; cursor:pointer; padding:3px; border-radius:6px; opacity:.75; transition:opacity .15s ease, background .15s ease; }
			.cleanSlate-usage-updated button:hover { opacity:1; background:var(--cs-surface-strong); }

			.cleanSlate-usage-credits { display:flex; flex-direction:column; gap:14px; padding:22px 24px; border:1px solid var(--cs-border); border-radius:16px; background:var(--cs-surface); }
			.cleanSlate-usage-credits h3 { margin:0; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--vscode-descriptionForeground); }
			.cleanSlate-usage-credit-row { display:flex; align-items:center; justify-content:space-between; gap:20px; }
			.cleanSlate-usage-credit-row > div:first-child { display:flex; flex-direction:column; gap:5px; }
			.cleanSlate-usage-credit-row strong { font-size:19px; font-weight:600; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
			.cleanSlate-usage-credit-row span { color:var(--vscode-descriptionForeground); font-size:12px; }
			.cleanSlate-usage-credit-badge { flex:0 0 auto; padding:4px 11px; border:1px solid var(--cs-border); border-radius:999px; color:var(--vscode-descriptionForeground); font-size:10.5px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; }

			/* ── Shared ──────────────────────────────────────────────── */
			.cleanSlate-pro-actions { display:flex; justify-content:flex-end; margin-top:4px; }
			.cleanSlate-pro-button { display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border:1px solid var(--cs-border); border-radius:9px; background:var(--cs-surface); color:var(--vscode-foreground); font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; transition:background .15s ease, border-color .15s ease; }
			.cleanSlate-usage-refresh-button { font-weight:400; }
			.cleanSlate-usage-refresh-control.is-refreshing { opacity:.6; cursor:default; }
			.cleanSlate-usage-updated button.is-refreshing:hover { background:transparent; opacity:.6; }
			.cleanSlate-usage-refresh-control.is-refreshing .codicon { animation:codicon-spin 1.5s steps(30) infinite; }
			.cleanSlate-pro-button:hover:not(:disabled) { background:var(--cs-surface-strong); border-color:color-mix(in srgb, var(--vscode-foreground) 14%, transparent); }
			.cleanSlate-pro-button:disabled { opacity:.55; cursor:default; }
			.cleanSlate-pro-empty { display:flex; align-items:center; gap:10px; padding:16px 18px; border:1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 55%, transparent); border-radius:14px; background:color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 8%, transparent); color:var(--vscode-foreground); font-size:13px; }

			/* ── Upgrade (free plan) ─────────────────────────────────── */
			.cleanSlate-upgrade-card { position:relative; display:flex; flex-direction:column; gap:16px; padding:22px 24px; border:1px solid color-mix(in srgb, var(--cs-accent) 32%, var(--cs-border)); border-radius:16px; background:linear-gradient(150deg, color-mix(in srgb, var(--cs-accent) 12%, transparent), color-mix(in srgb, var(--cs-accent) 3%, transparent)); overflow:hidden; }
			.cleanSlate-upgrade-head { display:flex; align-items:center; gap:13px; }
			.cleanSlate-upgrade-icon { flex:0 0 34px; display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; background:color-mix(in srgb, var(--cs-accent) 20%, transparent); color:var(--cs-accent); font-size:24px; line-height:1; }
			.cleanSlate-upgrade-icon::before { display:block; line-height:1; }
			.cleanSlate-upgrade-headcopy { display:flex; flex-direction:column; gap:3px; }
			.cleanSlate-upgrade-headcopy strong { font-size:15px; font-weight:600; letter-spacing:-.01em; }
			.cleanSlate-upgrade-headcopy span { color:var(--vscode-descriptionForeground); font-size:12.5px; line-height:1.45; }
			.cleanSlate-upgrade-features { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
			.cleanSlate-upgrade-features li { display:flex; align-items:center; gap:9px; font-size:12.5px; color:var(--vscode-foreground); }
			.cleanSlate-upgrade-features li .codicon { color:var(--cs-accent); font-size:14px; }
			.cleanSlate-upgrade-card > .cleanSlate-action-button { align-self:flex-start; }

			@media (max-width:900px) {
				.cleanSlate-usage-limit-row { grid-template-columns:1fr; gap:12px; }
			}
		`;
	}

	private renderModels(config: ICleanSlateConfiguration, managedAccess?: CleanSlateManagedAccessState): void {
		const group = this.createGroup();
		this.createSelectRow(group, 'Provider', config.provider, [
			{ label: 'CleanSlate', value: 'cleanslate' },
			{ label: 'OpenAI', value: 'openai' },
			{ label: 'Azure', value: 'azureOpenAI' },
			{ label: 'Anthropic', value: 'anthropic' },
			{ label: 'Google Gemini', value: 'gemini' },
			{ label: 'xAI Grok', value: 'grok' },
			{ label: 'NVIDIA NIM', value: 'nvidia' },
			{ label: 'OpenRouter', value: 'openrouter' },
			{ label: 'Custom API', value: 'custom' },
			{ label: 'AWS Bedrock', value: 'bedrock' }
		], async value => {
			const scrollTop = this.content.scrollTop;
			await this.updateConfiguration({ provider: value as AIProvider });
			await this.render({ restoreScrollTop: scrollTop });
		});

		switch (config.provider) {
			case 'cleanslate': this.renderCleanSlateManagedSettings(config, managedAccess ?? { kind: 'signedOut' }); break;
			case 'azureOpenAI': this.renderAzureModelSettings(config); break;
			case 'anthropic': this.renderAnthropicModelSettings(config); break;
			case 'gemini': this.renderGeminiModelSettings(config); break;
			case 'grok': this.renderGrokModelSettings(config); break;
			case 'nvidia': this.renderNvidiaModelSettings(config); break;
			case 'openrouter': this.renderOpenRouterModelSettings(config); break;
			case 'custom': this.renderCustomModelSettings(config); break;
			case 'bedrock': this.renderBedrockModelSettings(config); break;
			default: this.renderOpenAIModelSettings(config); break;
		}
	}

	private renderCleanSlateManagedSettings(config: ICleanSlateConfiguration, access: CleanSlateManagedAccessState): void {
		const provider = config.providers?.cleanslate;
		const group = this.createGroup('CleanSlate');
		if (access.kind === 'signedOut') {
			this.createActionRow(group, 'Sign in required', 'Sign in with your TheWariend account before using CleanSlate.', 'Sign in', this.accountActions?.signIn);
			return;
		}
		if (access.kind === 'reauthenticate') {
			this.createActionRow(group, 'Session expired', `${access.message} Your CleanSlate plan remains active.`, 'Sign in again', this.accountActions?.signIn);
			return;
		}
		if (access.kind === 'free') {
			this.createActionRow(group, 'Free account', 'Upgrade securely to CleanSlate Pro, then return here to load the models included with your plan.', 'Upgrade to Pro', this.accountActions?.upgradeToPro);
			return;
		}
		if (access.kind === 'unavailable') {
			this.createActionRow(group, 'Managed access unavailable', access.message);
			return;
		}
		this.createModelSelectRow(
			group,
			'Model',
			'cleanslate',
			provider?.model,
			value => this.updateProvider('cleanslate', { model: value }),
			'Models available with your active CleanSlate plan.',
			access.entitlements
		);
	}

	private resolveManagedAccessFromResult(config: ICleanSlateConfiguration, entitlements?: ICleanSlateManagedEntitlements, errorMessage?: string): CleanSlateManagedAccessState {
		if (!config.providers?.cleanslate?.apiKey || !this.configService.getManagedAccount()) {
			return { kind: 'signedOut' };
		}
		if (errorMessage) {
			return this.isReauthenticationError(errorMessage)
				? { kind: 'reauthenticate', message: errorMessage }
				: { kind: 'unavailable', message: errorMessage };
		}
		if (!entitlements) {
			return { kind: 'unavailable', message: 'Unable to verify CleanSlate access.' };
		}
		if (entitlements.can_use_managed_ai) {
			return { kind: 'pro', entitlements };
		}
		if (!entitlements.managed_ai && !entitlements.plan) {
			return { kind: 'free', entitlements };
		}
		return {
			kind: 'unavailable',
			entitlements,
			message: this.managedAccessMessage(entitlements.managed_ai_reason, entitlements.plan?.id === 'free')
		};
	}

	private isReauthenticationError(message: string | undefined): boolean {
		return /session expired|sign in(?: to CleanSlate)? again/i.test(message || '');
	}

	private managedAccessMessage(reason: string | undefined, isManagedFreePlan = false): string {
		if (isManagedFreePlan && ['budget_exhausted', 'token_limit_exhausted', 'daily_limit_exhausted', 'weekly_limit_exhausted', 'monthly_limit_exhausted'].includes(reason || '')) {
			return 'You\'ve used this month\'s free allowance. Access resumes when it refreshes next month.';
		}
		switch (reason) {
			case 'no_active_subscription': return 'Your account does not currently have an active CleanSlate Pro subscription.';
			case 'budget_exhausted': return 'You\'ve reached your plan\'s included usage. Access resumes as your session window rolls over or when credits are available.';
			case 'token_limit_exhausted': return 'You\'ve reached your plan\'s included usage. Access resumes as your session window rolls over or when credits are available.';
			case 'daily_limit_exhausted': return 'You\'ve reached your daily limit. Access resumes when your allowance refreshes.';
			case 'weekly_limit_exhausted': return 'You\'ve reached your weekly limit. Access resumes when it resets or when credits are available.';
			case 'monthly_limit_exhausted': return 'You\'ve reached your plan\'s included usage. Access resumes when your daily limit resets or when credits are available.';
			default: return 'CleanSlate access is not available for this account right now.';
		}
	}

	private usedBudgetPercent(usage: ICleanSlateManagedEntitlements): number {
		const limitMicros = Number(usage.limits?.monthly_budget_micros)
			|| (Number(usage.limits?.monthly_budget_cents) * 10_000);
		if (!Number.isFinite(limitMicros) || limitMicros <= 0) {
			return 0;
		}
		const remainingMicros = usage.limits?.remaining_budget_micros !== undefined
			? Number(usage.limits.remaining_budget_micros)
			: Number(usage.limits?.remaining_budget_cents) * 10_000;
		if (!Number.isFinite(remainingMicros)) {
			return 0;
		}
		return Math.min(100, Math.max(0, Math.round(((limitMicros - remainingMicros) / limitMicros) * 100)));
	}

	private renderOpenAIModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.openai;
		const group = this.createGroup('OpenAI');
		this.createModelSelectRow(group, 'Model', 'openai', provider?.model, value => this.updateProvider('openai', { model: value }));
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: 'https://api.openai.com/v1',
			onChange: value => this.updateProvider('openai', { baseUrl: value })
		});
	}

	private renderAzureModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.azureOpenAI;
		const group = this.createGroup('Azure');
		this.createTextRow(group, {
			label: 'Endpoint', value: provider?.endpoint, placeholder: 'https://resource.services.ai.azure.com/openai/v1/',
			onChange: value => this.updateProvider('azureOpenAI', { endpoint: value })
		});
		this.createTextRow(group, {
			label: 'Deployment Name', value: provider?.deploymentName, placeholder: 'gpt-4.1',
			onChange: value => this.updateProvider('azureOpenAI', { deploymentName: value })
		});
	}

	private renderAnthropicModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.anthropic;
		const group = this.createGroup('Anthropic');
		this.createModelSelectRow(group, 'Model', 'anthropic', provider?.model, value => this.updateProvider('anthropic', { model: value }));
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: 'https://api.anthropic.com/v1',
			onChange: value => this.updateProvider('anthropic', { baseUrl: value })
		});
	}

	private renderGeminiModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.gemini;
		const group = this.createGroup('Google Gemini');
		this.createModelSelectRow(group, 'Model', 'gemini', provider?.model, value => this.updateProvider('gemini', { model: value }));
	}

	private renderGrokModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.grok;
		const group = this.createGroup('xAI Grok');
		this.createModelSelectRow(group, 'Model', 'grok', provider?.model, value => this.updateProvider('grok', { model: value }));
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: 'https://api.x.ai/v1',
			onChange: value => this.updateProvider('grok', { baseUrl: value })
		});
	}

	private renderNvidiaModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.nvidia;
		const group = this.createGroup('NVIDIA NIM');
		this.createModelSelectRow(group, 'Model', 'nvidia', provider?.model, value => this.updateProvider('nvidia', { model: value }));
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: CLEANSLATE_NVIDIA_DEFAULT_BASE_URL,
			onChange: value => this.updateProvider('nvidia', { baseUrl: value })
		});
	}

	private renderOpenRouterModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.openrouter;
		const group = this.createGroup('OpenRouter');
		this.createModelSelectRow(group, 'Model', 'openrouter', provider?.model, value => this.updateProvider('openrouter', { model: value }));
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: CLEANSLATE_OPENROUTER_DEFAULT_BASE_URL,
			onChange: value => this.updateProvider('openrouter', { baseUrl: value })
		});
	}

	private renderCustomModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.custom;
		const group = this.createGroup('Custom API');
		this.createTextRow(group, {
			label: 'Model', value: provider?.model, placeholder: 'model-name',
			onChange: value => this.updateProvider('custom', { model: value })
		});
		this.createTextRow(group, {
			label: 'Base URL', value: provider?.baseUrl, placeholder: 'http://localhost:11434/v1',
			onChange: value => this.updateProvider('custom', { baseUrl: value })
		});
	}

	private renderBedrockModelSettings(config: ICleanSlateConfiguration): void {
		const provider = config.providers?.bedrock;
		const group = this.createGroup('AWS Bedrock');
		this.createTextRow(group, {
			label: 'Region', value: provider?.region, placeholder: 'us-east-1',
			onChange: value => this.updateProvider('bedrock', { region: value })
		});
		this.createModelSelectRow(group, 'Model ID', 'bedrock', provider?.modelId, value => this.updateProvider('bedrock', { modelId: value }));
		this.createSelectRow(group, 'Credential Mode', provider?.credentialMode || 'default', [
			{ label: 'Default AWS credential chain', value: 'default' },
			{ label: 'AWS profile', value: 'profile' },
			{ label: 'Access keys', value: 'accessKey' }
		], async value => {
			await this.updateProvider('bedrock', { credentialMode: value as CleanSlateBedrockCredentialMode });
			await this.render({ preserveScroll: true });
		});
		if ((provider?.credentialMode || 'default') === 'profile') {
			this.createTextRow(group, {
				label: 'Profile', value: provider?.profile, placeholder: 'default',
				onChange: value => this.updateProvider('bedrock', { profile: value })
			});
		}
	}

	private renderApiKeys(config: ICleanSlateConfiguration): void {
		const openai = this.createGroup('OpenAI');
		this.createTextRow(openai, { label: 'API Key', type: 'password', value: config.providers?.openai?.apiKey, placeholder: 'OpenAI API key', onChange: value => this.updateProvider('openai', { apiKey: value }) });

		const azure = this.createGroup('Azure');
		this.createTextRow(azure, { label: 'API Key', type: 'password', value: config.providers?.azureOpenAI?.apiKey, placeholder: 'Azure API key', onChange: value => this.updateProvider('azureOpenAI', { apiKey: value }) });

		const anthropic = this.createGroup('Anthropic');
		this.createTextRow(anthropic, { label: 'API Key', type: 'password', value: config.providers?.anthropic?.apiKey, placeholder: 'Anthropic API key', onChange: value => this.updateProvider('anthropic', { apiKey: value }) });

		const gemini = this.createGroup('Google Gemini');
		this.createTextRow(gemini, { label: 'API Key', type: 'password', value: config.providers?.gemini?.apiKey, placeholder: 'Google AI Studio API key', onChange: value => this.updateProvider('gemini', { apiKey: value }) });

		const grok = this.createGroup('xAI Grok');
		this.createTextRow(grok, { label: 'API Key', type: 'password', value: config.providers?.grok?.apiKey, placeholder: 'xAI API key', onChange: value => this.updateProvider('grok', { apiKey: value }) });

		const nvidia = this.createGroup('NVIDIA NIM');
		this.createTextRow(nvidia, { label: 'API Key', type: 'password', value: config.providers?.nvidia?.apiKey, placeholder: 'NVIDIA API key', onChange: value => this.updateProvider('nvidia', { apiKey: value }) });

		const openrouter = this.createGroup('OpenRouter');
		this.createTextRow(openrouter, { label: 'API Key', type: 'password', value: config.providers?.openrouter?.apiKey, placeholder: 'OpenRouter API key', onChange: value => this.updateProvider('openrouter', { apiKey: value }) });

		const custom = this.createGroup('Custom API');
		this.createTextRow(custom, { label: 'API Key', type: 'password', value: config.providers?.custom?.apiKey, placeholder: 'Optional API key', onChange: value => this.updateProvider('custom', { apiKey: value }) });

		const bedrock = this.createGroup('AWS Bedrock');
		this.createSelectRow(bedrock, 'Credential Mode', config.providers?.bedrock?.credentialMode || 'default', [
			{ label: 'Default AWS credential chain', value: 'default' },
			{ label: 'AWS profile', value: 'profile' },
			{ label: 'Access keys', value: 'accessKey' }
		], async value => {
			await this.updateProvider('bedrock', { credentialMode: value as CleanSlateBedrockCredentialMode });
			await this.render({ preserveScroll: true });
		});
		if ((config.providers?.bedrock?.credentialMode || 'default') === 'profile') {
			this.createTextRow(bedrock, { label: 'Profile', value: config.providers?.bedrock?.profile, placeholder: 'default', onChange: value => this.updateProvider('bedrock', { profile: value }) });
		}
		if (config.providers?.bedrock?.credentialMode === 'accessKey') {
			this.createTextRow(bedrock, { label: 'Access Key ID', value: config.providers?.bedrock?.accessKeyId, placeholder: 'AWS access key ID', onChange: value => this.updateProvider('bedrock', { accessKeyId: value }) });
			this.createTextRow(bedrock, { label: 'Secret Access Key', type: 'password', value: config.providers?.bedrock?.secretAccessKey, placeholder: 'AWS secret access key', onChange: value => this.updateProvider('bedrock', { secretAccessKey: value }) });
			this.createTextRow(bedrock, { label: 'Session Token', type: 'password', value: config.providers?.bedrock?.sessionToken, placeholder: 'Optional session token', onChange: value => this.updateProvider('bedrock', { sessionToken: value }) });
		}
	}

	private renderVerification(config: ICleanSlateConfiguration): void {
		const verification = this.createGroup();
		this.createToggleRow(verification, 'Fail On Warnings', config.failOnWarnings !== false, value => this.updateConfiguration({ failOnWarnings: value }));
		this.createTextRow(verification, { label: 'Max Agent Turns', type: 'number', value: config.maxTurns, placeholder: 'Optional', onChange: value => this.updateConfiguration({ maxTurns: this.optionalPositiveNumberValue(value) }) });
		this.createTextRow(verification, { label: 'Max Verification Retries', type: 'number', value: config.maxVerificationRetries, placeholder: '4', onChange: value => this.updateConfiguration({ maxVerificationRetries: this.numberValue(value, 4) }) });
		this.createTextRow(verification, { label: 'Max No-Tool Turns', type: 'number', value: config.maxNoToolTurns, placeholder: '3', onChange: value => this.updateConfiguration({ maxNoToolTurns: this.numberValue(value, 3) }) });
	}

	private renderIndexing(config: ICleanSlateConfiguration): void {
		const indexing = this.createGroup();
		this.createToggleRow(indexing, 'RAG Enabled', config.ragEnabled !== false, value => this.updateConfiguration({ ragEnabled: value }));
		this.createSelectRow(indexing, 'Embedding Provider', config.embeddingProvider || 'local', [
			{ label: 'Default', value: 'local' },
			{ label: 'OpenAI', value: 'openai' },
			{ label: 'Azure', value: 'azureOpenAI' },
			{ label: 'Google Gemini', value: 'gemini' }
		], async value => {
			const scrollTop = this.content.scrollTop;
			await this.updateConfiguration({ embeddingProvider: value as CleanSlateEmbeddingProvider });
			await this.render({ restoreScrollTop: scrollTop });
		});

		if (config.embeddingProvider === 'azureOpenAI') {
			this.createTextRow(indexing, { label: 'Embedding Deployment Name', value: config.providers?.azureOpenAI?.embeddingDeploymentName, onChange: value => this.updateProvider('azureOpenAI', { embeddingDeploymentName: value }) });
		} else if (config.embeddingProvider === 'local') {
			this.createTextRow(indexing, { label: 'Embedding Model', value: CLEANSLATE_DEFAULT_EMBEDDING_MODEL, placeholder: CLEANSLATE_DEFAULT_EMBEDDING_MODEL, disabled: true, onChange: value => this.updateConfiguration({ embeddingModel: value }) });
		} else {
			this.createTextRow(indexing, { label: 'Embedding Model', value: config.embeddingModel, onChange: value => this.updateConfiguration({ embeddingModel: value }) });
		}
	}

	// ─── DOM helpers ──────────────────────────────────────────────────────────

	private createGroup(title?: string, description?: string): HTMLElement {
		const section = dom.append(this.sectionRoot ?? this.content, dom.$('section.cleanSlate-settings-section'));
		if (title) {
			const header = dom.append(section, dom.$('.cleanSlate-settings-section-header'));
			const headerCopy = dom.append(header, dom.$('.cleanSlate-settings-section-copy'));
			dom.append(headerCopy, dom.$('h2')).textContent = title;
			if (description) {
				dom.append(headerCopy, dom.$('p')).textContent = description;
			}
		}
		return dom.append(section, dom.$('.cleanSlate-settings-group'));
	}

	private createRow(parent: HTMLElement, labelText: string, description?: string): HTMLElement {
		const row = dom.append(parent, dom.$('.cleanSlate-settings-row'));
		const labelBlock = dom.append(row, dom.$('.cleanSlate-settings-label-block'));
		dom.append(labelBlock, dom.$('label.cleanSlate-settings-label')).textContent = labelText;
		if (description) {
			dom.append(labelBlock, dom.$('.cleanSlate-settings-description')).textContent = description;
		}
		return dom.append(row, dom.$('.cleanSlate-settings-value'));
	}

	private createActionRow(parent: HTMLElement, labelText: string, description: string, actionLabel?: string, action?: () => Promise<void>): void {
		const value = this.createRow(parent, labelText, description);
		if (!actionLabel) {
			return;
		}
		this.createSettingsActionButton(value, {
			label: actionLabel,
			action,
			variant: 'primary',
			leadingIcon: actionLabel === 'Upgrade to Pro' ? 'arrow-circle-up' : undefined
		});
	}

	private createTextRow(parent: HTMLElement, options: ITextRowOptions): void {
		const row = this.createRow(parent, options.label, options.description);
		const input = dom.append(row, dom.$('input.cleanSlate-settings-control')) as HTMLInputElement;
		input.type = options.type || 'text';
		input.value = options.value !== undefined && options.value !== null ? String(options.value) : '';
		input.placeholder = options.placeholder || '';
		input.autocomplete = options.type === 'password' ? 'new-password' : 'off';
		input.disabled = options.disabled === true;
		input.spellcheck = false;
		if (options.disabled) {
			return;
		}

		let saveHandle: ReturnType<typeof setTimeout> | undefined;
		let lastSavedValue = input.value.trim();
		const save = async () => {
			const nextValue = input.value.trim();
			if (nextValue === lastSavedValue) {
				return;
			}
			lastSavedValue = nextValue;
			await options.onChange(nextValue);
			this.setSavedStatus();
		};
		input.oninput = () => {
			if (saveHandle) {
				clearTimeout(saveHandle);
			}
			saveHandle = setTimeout(() => {
				saveHandle = undefined;
				void save();
			}, 650);
		};
		input.onchange = async () => {
			if (saveHandle) {
				clearTimeout(saveHandle);
				saveHandle = undefined;
			}
			await save();
		};
	}

	private createSelectRow(parent: HTMLElement, labelText: string, value: string, options: readonly ISelectRowOption[], onChange: (value: string) => Promise<void>, description?: string): void {
		const row = this.createRow(parent, labelText, description);
		this.buildCustomSelect(row, { options, value }, onChange);
	}

	private createModelSelectRow(
		parent: HTMLElement,
		labelText: string,
		provider: AIProvider,
		value: string | undefined,
		onChange: (value: string) => Promise<void>,
		description?: string,
		managedEntitlements?: ICleanSlateManagedEntitlements
	): void {
		const row = this.createRow(parent, labelText, description);
		const currentValue = value || '';
		const select = this.buildCustomSelect(row, {
			options: [{ label: currentValue || 'Loading models…', value: currentValue }],
			value: currentValue,
			disabled: true
		}, onChange, (provider as string) === 'cleanslate'
			? (element, model) => setCleanSlateProviderLogo(element, provider, model)
			: undefined);

		void this.cleanSlateService.getModels(provider).then(models => {
			const uniqueModels = Array.from(new Set([
				...(currentValue ? [currentValue] : []),
				...models
			].filter(Boolean)));
			if (!uniqueModels.length) {
				select.setOptions([{ label: (provider as string) === 'cleanslate' ? 'Sign in to load models' : 'Add API key to load models', value: '' }], '', true);
				return;
			}
			const creditsOnlyModels = new Set((managedEntitlements?.models || [])
				.filter(model => model.requires_credits && !!model.id?.trim())
				.map(model => model.id.trim()));
			const hasCredits = Number(managedEntitlements?.credits?.balance_cents || 0) > 0;
			select.setOptions(uniqueModels.map(model => ({
				label: model,
				value: model,
				creditsLocked: !hasCredits && creditsOnlyModels.has(model)
			})), currentValue || uniqueModels[0], false);
		}, error => {
			const message = error instanceof Error ? error.message : String(error);
			select.setOptions([{ label: message || 'Failed to load models', value: currentValue }], currentValue, true);
		});
	}

	/**
	 * Builds a custom, fully in-DOM dropdown (replacing the native `<select>`, which
	 * renders an unstyleable OS-native menu). Returns a handle to swap options later
	 * (used by the async model loader).
	 */
	private buildCustomSelect(
		container: HTMLElement,
		initial: { options: readonly ISelectRowOption[]; value: string; disabled?: boolean },
		onChange: (value: string) => Promise<void>,
		setOptionLogo?: (element: HTMLElement, value: string) => string | undefined
	): { setOptions(options: readonly ISelectRowOption[], value: string, disabled?: boolean): void } {
		container.classList.add('cleanSlate-select-host');
		const control = dom.append(container, dom.$('button.cleanSlate-select')) as HTMLButtonElement;
		control.type = 'button';
		control.setAttribute('aria-haspopup', 'listbox');
		control.setAttribute('aria-expanded', 'false');
		const selectedLogo = setOptionLogo ? dom.append(control, dom.$('span.cleanSlate-select-model-logo')) : undefined;
		const labelEl = dom.append(control, dom.$('span.cleanSlate-select-label'));
		dom.append(control, dom.$('span.cleanSlate-select-chevron.codicon.codicon-chevron-down'));
		const menu = dom.append(container, dom.$('.cleanSlate-select-menu'));
		menu.setAttribute('role', 'listbox');
		menu.style.display = 'none';

		const doc = container.ownerDocument;
		let state: { options: readonly ISelectRowOption[]; value: string; disabled: boolean } = {
			options: initial.options,
			value: initial.value,
			disabled: initial.disabled === true
		};
		let open = false;
		let outsideHandler: ((event: MouseEvent) => void) | undefined;
		let keyHandler: ((event: KeyboardEvent) => void) | undefined;

		const currentLabel = () => state.options.find(option => option.value === state.value)?.label ?? state.options[0]?.label ?? '';

		const closeMenu = () => {
			if (!open) {
				return;
			}
			open = false;
			menu.style.display = 'none';
			control.classList.remove('open');
			control.setAttribute('aria-expanded', 'false');
			if (outsideHandler) { doc.removeEventListener('mousedown', outsideHandler, true); outsideHandler = undefined; }
			if (keyHandler) { doc.removeEventListener('keydown', keyHandler, true); keyHandler = undefined; }
		};

		const renderMenu = () => {
			dom.clearNode(menu);
			for (const option of state.options) {
				const item = dom.append(menu, dom.$('button.cleanSlate-select-option')) as HTMLButtonElement;
				item.type = 'button';
				item.setAttribute('role', 'option');
				const selected = option.value === state.value;
				item.classList.toggle('selected', selected);
				item.setAttribute('aria-selected', String(selected));
				item.classList.toggle('is-credits-locked', option.creditsLocked === true);
				item.disabled = option.creditsLocked === true;
				if (option.creditsLocked) {
					item.setAttribute('aria-disabled', 'true');
					item.title = `${option.label} — add usage credits to unlock`;
				}
				const check = dom.append(item, dom.$('span.cleanSlate-select-check.codicon.codicon-check'));
				check.style.visibility = selected ? 'visible' : 'hidden';
				if (setOptionLogo) {
					const logo = dom.append(item, dom.$('span.cleanSlate-select-model-logo'));
					setOptionLogo(logo, option.value);
				}
				dom.append(item, dom.$('span.cleanSlate-select-option-label')).textContent = option.label;
				if (option.creditsLocked) {
					const badge = dom.append(item, dom.$('span.cleanSlate-select-option-credits'));
					dom.append(badge, dom.$('span.codicon.codicon-lock'));
					dom.append(badge, dom.$('span')).textContent = 'Credits';
				}
				item.onclick = async () => {
					if (option.creditsLocked) {
						return;
					}
					closeMenu();
					if (option.value === state.value) {
						return;
					}
					const restoreScroll = this.lockContentScroll();
					try {
						state = { ...state, value: option.value };
						labelEl.textContent = currentLabel();
						await onChange(option.value);
						this.setSavedStatus();
					} finally {
						restoreScroll();
					}
				};
			}
		};

		const openMenu = () => {
			if (open || state.disabled) {
				return;
			}
			renderMenu();
			open = true;
			menu.style.display = 'block';
			control.classList.add('open');
			control.setAttribute('aria-expanded', 'true');
			outsideHandler = (event: MouseEvent) => {
				if (!container.contains(event.target as Node)) {
					closeMenu();
				}
			};
			keyHandler = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					closeMenu();
					control.focus();
				}
			};
			doc.addEventListener('mousedown', outsideHandler, true);
			doc.addEventListener('keydown', keyHandler, true);
		};

		control.onclick = () => (open ? closeMenu() : openMenu());

		const apply = () => {
			labelEl.textContent = currentLabel();
			if (selectedLogo && setOptionLogo) {
				setOptionLogo(selectedLogo, state.value);
			}
			control.disabled = state.disabled;
			control.classList.toggle('disabled', state.disabled);
		};
		apply();

		return {
			setOptions: (options, value, disabled = false) => {
				state = { options, value, disabled };
				apply();
				if (open) {
					renderMenu();
				}
			}
		};
	}

	private createToggleRow(parent: HTMLElement, labelText: string, value: boolean, onChange: (value: boolean) => Promise<void>, description?: string): void {
		const row = this.createRow(parent, labelText, description);
		const toggle = dom.append(row, dom.$('button.cleanSlate-settings-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.setAttribute('role', 'switch');
		toggle.setAttribute('aria-checked', String(value));
		dom.append(toggle, dom.$('span.cleanSlate-settings-toggle-knob'));
		toggle.onclick = async () => {
			const nextValue = toggle.getAttribute('aria-checked') !== 'true';
			toggle.disabled = true;
			try {
				await onChange(nextValue);
				toggle.setAttribute('aria-checked', String(nextValue));
				this.setSavedStatus();
			} finally {
				toggle.disabled = false;
			}
		};
	}

	// ─── Config helpers ───────────────────────────────────────────────────────

	private async updateProvider<T extends keyof ICleanSlateProviderConfigurations>(provider: T, value: NonNullable<ICleanSlateProviderConfigurations[T]>): Promise<void> {
		await this.updateConfiguration({
			providers: {
				[provider]: value
			} as ICleanSlateProviderConfigurations
		});
	}

	private async updateConfiguration(config: Partial<ICleanSlateConfiguration>): Promise<void> {
		await this.configService.updateConfiguration(config);
		this.setSavedStatus();
	}

	private setSavedStatus(): void {
		if (!this.saveStatus) {
			return;
		}
		const current = ++this.saveCounter;
		this.saveStatus.textContent = 'Saved';
		this.saveStatus.classList.add('saved');
		setTimeout(() => {
			if (current === this.saveCounter && this.saveStatus) {
				this.saveStatus.textContent = '';
				this.saveStatus.classList.remove('saved');
			}
		}, 1800);
	}

	// ─── Scroll helpers ───────────────────────────────────────────────────────

	private lockContentScroll(): () => void {
		const scrollTop = this.content.scrollTop;
		const activeElement = this.content.ownerDocument.activeElement;
		if (activeElement instanceof HTMLElement && this.content.contains(activeElement)) {
			activeElement.blur();
		}
		const previousOverflowAnchor = this.content.style.overflowAnchor;
		this.content.style.overflowAnchor = 'none';
		let restored = false;
		const restoreOnce = () => { this.content.scrollTop = scrollTop; };
		return () => {
			if (restored) { return; }
			restored = true;
			restoreOnce();
			const view = this.content.ownerDocument.defaultView;
			view?.requestAnimationFrame(() => {
				restoreOnce();
				view.requestAnimationFrame(restoreOnce);
			});
			view?.setTimeout(restoreOnce, 0);
			view?.setTimeout(restoreOnce, 50);
			view?.setTimeout(() => {
				restoreOnce();
				this.content.style.overflowAnchor = previousOverflowAnchor;
			}, 150);
		};
	}

	private restoreContentScrollTop(scrollTop: number): void {
		this.content.scrollTop = scrollTop;
		this.content.ownerDocument.defaultView?.requestAnimationFrame(() => {
			this.content.scrollTop = scrollTop;
		});
	}

	private numberValue(value: string, fallback: number): number {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	private optionalPositiveNumberValue(value: string): number | undefined {
		const parsed = Number(value.trim());
		return value.trim().length > 0 && Number.isFinite(parsed) && parsed > 0
			? Math.floor(parsed)
			: undefined;
	}
}
