/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/cleanSlateAuth.css';
import { asCSSUrl } from '../../../../../base/browser/cssValue.js';
import { $, append, EventHelper, EventLike } from '../../../../../base/browser/dom.js';
import { BaseActionViewItem, IActionViewItemOptions } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction, Separator, toAction } from '../../../../../base/common/actions.js';
import { getErrorMessage } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../../nls.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpression, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IOpenURLOptions, IURLHandler, IURLService } from '../../../../../platform/url/common/url.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { ICleanSlateMainService } from '../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export const CLEANSLATE_AUTH_SIGN_IN_COMMAND_ID = 'cleanSlate.auth.signIn';
export const CLEANSLATE_AUTH_SIGN_OUT_COMMAND_ID = 'cleanSlate.auth.signOut';
export const CLEANSLATE_AUTH_SHOW_ACCOUNT_COMMAND_ID = 'cleanSlate.auth.showAccount';

const CLEANSLATE_AUTH_CALLBACK_URI = 'cleanslate://auth';
const CLEANSLATE_AUTH_CALLBACK_SCHEME = 'cleanslate';
const CLEANSLATE_AUTH_CALLBACK_AUTHORITY = 'auth';
const CLEANSLATE_AUTH_SOURCE = 'cleanslate';
const CLEANSLATE_AUTH_URL = 'https://thewariend.com/auth';
const CLEANSLATE_AUTH_TOKEN_SECRET_KEY = 'cleanSlate.auth.jwt';
export const CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY = 'cleanSlate.auth.account';

const CLEANSLATE_CATEGORY = localize2('cleanSlate.category', 'CleanSlate');
const CLEANSLATE_AUTH_SIGNED_IN_CONTEXT = new RawContextKey<boolean>('cleanSlate.auth.signedIn', false, localize('cleanSlate.auth.signedIn.context', 'Whether CleanSlate is signed in to TheWariend.'));
const CLEANSLATE_AUTH_SIGNED_IN_WHEN = CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.isEqualTo(true);
const CLEANSLATE_AUTH_SIGNED_OUT_WHEN = CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.toNegated();

export interface CleanSlateAuthAccountMetadata {
	readonly email?: string;
	readonly name?: string;
	readonly provider?: string;
	readonly profileImageUrl?: string;
	readonly tokenType?: string;
	readonly expiresAt?: string;
	readonly expiresIn?: string;
	readonly signedInAt: string;
}

class CleanSlateAuthContribution extends Disposable implements IWorkbenchContribution, IURLHandler {

	static readonly ID = 'workbench.contrib.cleanSlateAuth';

	private readonly signedInContext: IContextKey<boolean>;

	constructor(
		@IURLService urlService: IURLService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProductService private readonly productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IActionViewItemService actionViewItemService: IActionViewItemService
	) {
		super();

		this.signedInContext = CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.bindTo(contextKeyService);
		this._register(urlService.registerHandler(this));
		const titleBarViewItemChange = this._register(new Emitter<void>());
		this._register(actionViewItemService.register(MenuId.TitleBar, CLEANSLATE_AUTH_SHOW_ACCOUNT_COMMAND_ID, (action, options, instantiationService) => {
			return instantiationService.createInstance(CleanSlateAccountTitleBarActionViewItem, action, options);
		}, titleBarViewItemChange.event));
		titleBarViewItemChange.fire();
		this._register(this.secretStorageService.onDidChangeSecret(key => {
			if (key === CLEANSLATE_AUTH_TOKEN_SECRET_KEY) {
				void this.refreshAuthState();
			}
		}));

		void this.refreshAuthState();
	}

	async handleURL(uri: URI, _options?: IOpenURLOptions): Promise<boolean> {
		if (!this.isAuthCallback(uri)) {
			return false;
		}

		const params = new URLSearchParams(uri.query);
		const error = params.get('error');
		if (error) {
			const provider = params.get('provider');
			this.notificationService.error(provider
				? localize('cleanSlate.auth.callbackProviderError', 'CleanSlate sign in with {0} failed: {1}', provider, error)
				: localize('cleanSlate.auth.callbackError', 'CleanSlate sign in failed: {0}', error));
			return true;
		}

		const token = params.get('token');
		if (!token) {
			this.notificationService.warn(localize('cleanSlate.auth.callbackMissingToken', 'CleanSlate sign in did not return an auth token.'));
			return true;
		}

		await this.secretStorageService.set(CLEANSLATE_AUTH_TOKEN_SECRET_KEY, token);

		const account = getAccountMetadataFromCallback(params);
		storeAccountMetadata(this.storageService, account);
		this.signedInContext.set(true);

		const accountLabel = getAccountLabel(account);
		this.notificationService.info(accountLabel
			? localize('cleanSlate.auth.signedInAs', 'Signed in to CleanSlate as {0}.', accountLabel)
			: localize('cleanSlate.auth.signedIn', 'Signed in to CleanSlate.'));
		return true;
	}

	private async refreshAuthState(): Promise<void> {
		const token = await this.secretStorageService.get(CLEANSLATE_AUTH_TOKEN_SECRET_KEY);
		this.signedInContext.set(!!token);
		if (!token) {
			this.storageService.remove(CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, StorageScope.APPLICATION);
		}
	}

	private isAuthCallback(uri: URI): boolean {
		const isCleanSlateScheme = uri.scheme === CLEANSLATE_AUTH_CALLBACK_SCHEME || uri.scheme === this.productService.urlProtocol;
		if (!isCleanSlateScheme) {
			return false;
		}

		return uri.authority === CLEANSLATE_AUTH_CALLBACK_AUTHORITY
			|| trimLeadingSlash(uri.path) === CLEANSLATE_AUTH_CALLBACK_AUTHORITY;
	}
}

class CleanSlateAccountTitleBarActionViewItem extends BaseActionViewItem {

	private labelElement: HTMLElement | undefined;
	private avatarElement: HTMLElement | undefined;

	constructor(
		action: IAction,
		options: IActionViewItemOptions,
		@IStorageService private readonly storageService: IStorageService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(null, action, options);

		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, this._store)(() => this.update()));
	}

	override render(container: HTMLElement): void {
		super.render(container);

		container.classList.add('cleanSlate-auth-titlebar-account-item');
		this.labelElement = append(container, $('a.action-label.cleanSlate-auth-titlebar-account'));
		this.labelElement.setAttribute('role', 'button');
		this.avatarElement = append(this.labelElement, $('span.cleanSlate-auth-titlebar-account-avatar'));
		append(this.labelElement, $('span.codicon.codicon-chevron-down.cleanSlate-auth-titlebar-account-chevron'));
		this.update();
	}

	override onClick(event: EventLike, _preserveFocus = false): void {
		EventHelper.stop(event, true);

		const account = readCleanSlateAuthAccount(this.storageService);
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.labelElement ?? this.element!,
			getActions: () => [
				toAction({
					id: CLEANSLATE_AUTH_SHOW_ACCOUNT_COMMAND_ID,
					label: getAccountMenuLabel(account),
					tooltip: getAccountTitle(account),
					run: () => this.commandService.executeCommand(CLEANSLATE_AUTH_SHOW_ACCOUNT_COMMAND_ID)
				}),
				new Separator(),
				toAction({
					id: CLEANSLATE_AUTH_SIGN_OUT_COMMAND_ID,
					label: localize('cleanSlate.auth.signOut.title.inline', 'Sign Out'),
					run: () => this.commandService.executeCommand(CLEANSLATE_AUTH_SIGN_OUT_COMMAND_ID)
				})
			]
		});
	}

	override focus(): void {
		this.labelElement?.focus();
	}

	override blur(): void {
		this.labelElement?.blur();
	}

	override setFocusable(focusable: boolean): void {
		if (this.labelElement) {
			this.labelElement.tabIndex = focusable ? 0 : -1;
		}
	}

	private update(): void {
		if (!this.labelElement || !this.avatarElement) {
			return;
		}

		const account = readCleanSlateAuthAccount(this.storageService);
		const title = getAccountTitle(account);
		this.labelElement.setAttribute('aria-label', title);
		this.element?.setAttribute('aria-label', title);

		this.avatarElement.className = 'cleanSlate-auth-titlebar-account-avatar';
		this.avatarElement.style.backgroundImage = '';
		const profileImageUrl = typeof account?.profileImageUrl === 'string' ? account.profileImageUrl : undefined;
		if (profileImageUrl) {
			this.avatarElement.classList.add('has-image');
			this.avatarElement.style.backgroundImage = asCSSUrl(URI.parse(profileImageUrl));
		} else {
			this.avatarElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));
		}
	}
}

async function signIn(accessor: ServicesAccessor): Promise<void> {
	return openCleanSlateSignIn(accessor.get(IOpenerService), accessor.get(INotificationService), accessor.get(ICleanSlateMainService));
}

export async function openCleanSlateSignIn(openerService: IOpenerService, notificationService: INotificationService, mainService?: ICleanSlateMainService): Promise<void> {
	try {
		const authWebUrl = mainService ? (await mainService.getRuntimeConfig()).authWebUrl : CLEANSLATE_AUTH_URL;
		const opened = await openerService.open(URI.parse(getAuthUrl(authWebUrl)), { openExternal: true, skipValidation: true });
		if (!opened) {
			notificationService.warn(localize('cleanSlate.auth.openBrowserFailed', 'Could not open the external browser for CleanSlate sign in.'));
		}
	} catch (error) {
		notificationService.error(localize('cleanSlate.auth.openBrowserError', 'Could not start CleanSlate sign in: {0}', getErrorMessage(error)));
	}
}

export async function openCleanSlateProCheckout(openerService: IOpenerService, notificationService: INotificationService, mainService: ICleanSlateMainService): Promise<void> {
	try {
		const { proCheckoutUrl } = await mainService.getRuntimeConfig();
		const opened = await openerService.open(URI.parse(proCheckoutUrl), { openExternal: true, skipValidation: true });
		if (!opened) {
			notificationService.warn(localize('cleanSlate.auth.openCheckoutFailed', 'Could not open CleanSlate Pro checkout.'));
		}
	} catch (error) {
		notificationService.error(localize('cleanSlate.auth.openCheckoutError', 'Could not start CleanSlate Pro checkout: {0}', getErrorMessage(error)));
	}
}

export async function openCleanSlateAccount(openerService: IOpenerService, notificationService: INotificationService, mainService?: ICleanSlateMainService): Promise<void> {
	try {
		const authWebUrl = mainService ? (await mainService.getRuntimeConfig()).authWebUrl : CLEANSLATE_AUTH_URL;
		const opened = await openerService.open(URI.parse(getAccountDashboardUrl(authWebUrl)), { openExternal: true, skipValidation: true });
		if (!opened) {
			notificationService.warn(localize('cleanSlate.auth.openAccountFailed', 'Could not open your CleanSlate account page.'));
		}
	} catch (error) {
		notificationService.error(localize('cleanSlate.auth.openAccountError', 'Could not open your CleanSlate account: {0}', getErrorMessage(error)));
	}
}

function getAccountDashboardUrl(authWebUrl: string): string {
	const url = new URL(authWebUrl);
	url.pathname = '/dashboard';
	url.search = '';
	url.hash = '';
	return url.toString();
}

async function signOut(accessor: ServicesAccessor): Promise<void> {
	const secretStorageService = accessor.get(ISecretStorageService);
	const storageService = accessor.get(IStorageService);
	const dialogService = accessor.get(IDialogService);
	const notificationService = accessor.get(INotificationService);
	const contextKeyService = accessor.get(IContextKeyService);

	const token = await secretStorageService.get(CLEANSLATE_AUTH_TOKEN_SECRET_KEY);
	const account = readCleanSlateAuthAccount(storageService);
	if (!token && !account) {
		CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.bindTo(contextKeyService).set(false);
		notificationService.info(localize('cleanSlate.auth.notSignedIn', 'You are not signed in to CleanSlate.'));
		return;
	}

	const result = await dialogService.confirm({
		message: localize('cleanSlate.auth.signOutConfirm', 'Sign out of CleanSlate?'),
		detail: getAccountLabel(account) || undefined,
		primaryButton: localize({ key: 'cleanSlate.auth.signOutButton', comment: ['&& denotes a mnemonic'] }, '&&Sign Out')
	});

	if (!result.confirmed) {
		return;
	}

	await clearCleanSlateAuthAccount(secretStorageService, storageService);
	CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.bindTo(contextKeyService).set(false);
	notificationService.info(localize('cleanSlate.auth.signedOut', 'Signed out of CleanSlate.'));
}

export async function clearCleanSlateAuthAccount(secretStorageService: ISecretStorageService, storageService: IStorageService): Promise<void> {
	await secretStorageService.delete(CLEANSLATE_AUTH_TOKEN_SECRET_KEY);
	storageService.remove(CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, StorageScope.APPLICATION);
}

async function showAccount(accessor: ServicesAccessor): Promise<void> {
	const secretStorageService = accessor.get(ISecretStorageService);
	const storageService = accessor.get(IStorageService);
	const dialogService = accessor.get(IDialogService);
	const notificationService = accessor.get(INotificationService);
	const contextKeyService = accessor.get(IContextKeyService);

	const token = await secretStorageService.get(CLEANSLATE_AUTH_TOKEN_SECRET_KEY);
	if (!token) {
		CLEANSLATE_AUTH_SIGNED_IN_CONTEXT.bindTo(contextKeyService).set(false);
		notificationService.info(localize('cleanSlate.auth.notSignedIn', 'You are not signed in to CleanSlate.'));
		return;
	}

	const account = readCleanSlateAuthAccount(storageService);
	const accountLabel = getAccountLabel(account);
	await dialogService.info(
		accountLabel
			? localize('cleanSlate.auth.accountTitle', 'Signed in to CleanSlate as {0}', accountLabel)
			: localize('cleanSlate.auth.accountTitleNoName', 'Signed in to CleanSlate'),
		formatAccountDetail(account)
	);
}

function getAuthUrl(authWebUrl: string): string {
	const params = new URLSearchParams();
	params.set('redirect_uri', CLEANSLATE_AUTH_CALLBACK_URI);
	params.set('source', CLEANSLATE_AUTH_SOURCE);
	return `${authWebUrl}?${params.toString()}`;
}

function getAccountMetadataFromCallback(params: URLSearchParams): CleanSlateAuthAccountMetadata {
	return {
		email: getOptionalParam(params, 'email'),
		name: getOptionalParam(params, 'name'),
		provider: getOptionalParam(params, 'provider'),
		profileImageUrl: getProfileImageUrlFromCallback(params),
		tokenType: getOptionalParam(params, 'token_type'),
		expiresAt: getOptionalParam(params, 'expires_at'),
		expiresIn: getOptionalParam(params, 'expires_in'),
		signedInAt: new Date().toISOString()
	};
}

function getOptionalParam(params: URLSearchParams, key: string): string | undefined {
	const value = params.get(key);
	return value && value.trim().length > 0 ? value : undefined;
}

function getProfileImageUrlFromCallback(params: URLSearchParams): string | undefined {
	for (const key of ['picture', 'avatar_url', 'avatar', 'image_url', 'profile_image_url']) {
		const value = getOptionalParam(params, key);
		if (value && isSafeProfileImageUrl(value)) {
			return value;
		}
	}

	return undefined;
}

function isSafeProfileImageUrl(value: string): boolean {
	try {
		const uri = URI.parse(value);
		return uri.scheme === 'https' || uri.scheme === 'http';
	} catch {
		return false;
	}
}

export function readCleanSlateAuthAccount(storageService: IStorageService): CleanSlateAuthAccountMetadata | undefined {
	const raw = storageService.get(CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, StorageScope.APPLICATION);
	if (!raw) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			return parsed;
		}
	} catch {
		// Ignore invalid account metadata.
	}

	return undefined;
}

function storeAccountMetadata(storageService: IStorageService, account: CleanSlateAuthAccountMetadata): void {
	storageService.store(CLEANSLATE_AUTH_ACCOUNT_STORAGE_KEY, JSON.stringify(account), StorageScope.APPLICATION, StorageTarget.MACHINE);
}

function getAccountLabel(account: CleanSlateAuthAccountMetadata | undefined): string | undefined {
	if (!account) {
		return undefined;
	}
	return account.name || account.email;
}

function getAccountMenuLabel(account: CleanSlateAuthAccountMetadata | undefined): string {
	const accountName = account?.name || account?.email || localize('cleanSlate.auth.accountFallbackLabel', 'CleanSlate Account');
	const providerLabel = getProviderLabel(account?.provider);
	return providerLabel ? `${accountName} (${providerLabel})` : accountName;
}

function getAccountTitle(account: CleanSlateAuthAccountMetadata | undefined): string {
	return localize('cleanSlate.auth.accountTitleBarTooltip', 'CleanSlate: {0}', getAccountMenuLabel(account));
}

function getProviderLabel(provider: unknown): string | undefined {
	if (!provider || typeof provider !== 'string') {
		return undefined;
	}

	return localize('cleanSlate.auth.providerLabel', '{0} Auth', toTitleCase(provider));
}

function toTitleCase(value: string): string {
	return value
		.split(/[\s_-]+/g)
		.filter(part => part.length > 0)
		.map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
		.join(' ');
}

function formatAccountDetail(account: CleanSlateAuthAccountMetadata | undefined): string | undefined {
	if (!account) {
		return undefined;
	}

	const detail: string[] = [];
	if (account.email) {
		detail.push(localize('cleanSlate.auth.accountEmail', 'Email: {0}', account.email));
	}
	if (account.name) {
		detail.push(localize('cleanSlate.auth.accountName', 'Name: {0}', account.name));
	}
	const providerLabel = getProviderLabel(account.provider);
	if (providerLabel) {
		detail.push(localize('cleanSlate.auth.accountProvider', 'Provider: {0}', providerLabel));
	}
	if (account.signedInAt) {
		detail.push(localize('cleanSlate.auth.accountSignedInAt', 'Signed in: {0}', formatExpiresAt(account.signedInAt)));
	}
	return detail.length ? detail.join('\n') : undefined;
}

function formatExpiresAt(value: string): string {
	const numericValue = Number(value);
	const date = Number.isFinite(numericValue)
		? new Date(numericValue < 100000000000 ? numericValue * 1000 : numericValue)
		: new Date(value);

	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return date.toLocaleString();
}

function trimLeadingSlash(value: string): string {
	return value.startsWith('/') ? value.slice(1) : value;
}

function registerCleanSlateAuthAction(
	id: string,
	title: ReturnType<typeof localize2>,
	icon: ThemeIcon,
	when: ContextKeyExpression,
	menu: { id: MenuId; group?: string; order?: number; when?: ContextKeyExpression }[],
	run: (accessor: ServicesAccessor) => Promise<void>
): void {
	registerAction2(class CleanSlateAuthAction extends Action2 {
		constructor() {
			super({
				id,
				title,
				category: CLEANSLATE_CATEGORY,
				icon,
				f1: false,
				precondition: when,
				menu
			});
		}

		override run(accessor: ServicesAccessor): Promise<void> {
			return run(accessor);
		}
	});
}

registerCleanSlateAuthAction(
	CLEANSLATE_AUTH_SIGN_IN_COMMAND_ID,
	localize2('cleanSlate.auth.signIn.title', 'Sign In to CleanSlate'),
	Codicon.account,
	CLEANSLATE_AUTH_SIGNED_OUT_WHEN,
	[
		{
			id: MenuId.TitleBar,
			group: 'navigation',
			when: CLEANSLATE_AUTH_SIGNED_OUT_WHEN,
			order: 0.1
		}
	],
	signIn
);

registerCleanSlateAuthAction(
	CLEANSLATE_AUTH_SHOW_ACCOUNT_COMMAND_ID,
	localize2('cleanSlate.auth.showAccount.title', 'Show Account'),
	Codicon.account,
	CLEANSLATE_AUTH_SIGNED_IN_WHEN,
	[
		{
			id: MenuId.TitleBar,
			group: 'navigation',
			when: CLEANSLATE_AUTH_SIGNED_IN_WHEN,
			order: 0.1
		},
		{
			id: MenuId.AccountsContext,
			group: '2_cleanSlate',
			when: CLEANSLATE_AUTH_SIGNED_IN_WHEN
		}
	],
	showAccount
);

registerCleanSlateAuthAction(
	CLEANSLATE_AUTH_SIGN_OUT_COMMAND_ID,
	localize2('cleanSlate.auth.signOut.title', 'Sign Out'),
	Codicon.signOut,
	CLEANSLATE_AUTH_SIGNED_IN_WHEN,
	[
		{
			id: MenuId.AccountsContext,
			group: '2_cleanSlate',
			when: CLEANSLATE_AUTH_SIGNED_IN_WHEN
		}
	],
	signOut
);

registerWorkbenchContribution2(CleanSlateAuthContribution.ID, CleanSlateAuthContribution, WorkbenchPhase.BlockRestore);
