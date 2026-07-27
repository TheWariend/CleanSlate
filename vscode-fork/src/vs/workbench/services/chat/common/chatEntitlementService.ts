/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Barrier } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { isWeb } from '../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IObservable, observableFromEvent } from '../../../../base/common/observable.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IDefaultAccount } from '../../../../base/common/defaultAccount.js';

export namespace ChatEntitlementContextKeys {

	export const Setup = {
		hidden: new RawContextKey<boolean>('chatSetupHidden', false, true), 		// True when chat setup is explicitly hidden.
		installed: new RawContextKey<boolean>('chatSetupInstalled', false, true),  	// True when the chat extension is installed and enabled.
		disabled: new RawContextKey<boolean>('chatSetupDisabled', false, true),  	// True when the chat extension is disabled due to any other reason than workspace trust.
		untrusted: new RawContextKey<boolean>('chatSetupUntrusted', false, true),  	// True when the chat extension is disabled due to workspace trust.
		later: new RawContextKey<boolean>('chatSetupLater', false, true),  			// True when the user wants to finish setup later.
		registered: new RawContextKey<boolean>('chatSetupRegistered', false, true)  // True when the user has registered as Free or Pro user.
	};

	export const Entitlement = {
		signedOut: new RawContextKey<boolean>('chatEntitlementSignedOut', false, true), 				// True when user is signed out.
		canSignUp: new RawContextKey<boolean>('chatPlanCanSignUp', false, true), 						// True when user can sign up to be a chat free user.

		planFree: new RawContextKey<boolean>('chatPlanFree', false, true),								// True when user is a chat free user.
		planPro: new RawContextKey<boolean>('chatPlanPro', false, true),								// True when user is a chat pro user.
		planProPlus: new RawContextKey<boolean>('chatPlanProPlus', false, true), 						// True when user is a chat pro plus user.
		planBusiness: new RawContextKey<boolean>('chatPlanBusiness', false, true), 						// True when user is a chat business user.
		planEnterprise: new RawContextKey<boolean>('chatPlanEnterprise', false, true), 					// True when user is a chat enterprise user.

		organisations: new RawContextKey<string[]>('chatEntitlementOrganisations', undefined, true), 	// The organizations the user belongs to.
		internal: new RawContextKey<boolean>('chatEntitlementInternal', false, true), 					// True when user belongs to internal organisation.
		sku: new RawContextKey<string>('chatEntitlementSku', undefined, true), 							// The SKU of the user.
	};

	export const chatQuotaExceeded = new RawContextKey<boolean>('chatQuotaExceeded', false, true);
	export const completionsQuotaExceeded = new RawContextKey<boolean>('completionsQuotaExceeded', false, true);

	export const chatAnonymous = new RawContextKey<boolean>('chatAnonymous', false, true);
}

export const IChatEntitlementService = createDecorator<IChatEntitlementService>('chatEntitlementService');

export enum ChatEntitlement {
	/** Signed out */
	Unknown = 1,
	/** Signed in but not yet resolved */
	Unresolved = 2,
	/** Signed in and entitled to Free */
	Available = 3,
	/** Signed in but not entitled to Free */
	Unavailable = 4,
	/** Signed-up to Free */
	Free = 5,
	/** Signed-up to Pro */
	Pro = 6,
	/** Signed-up to Pro Plus */
	ProPlus = 7,
	/** Signed-up to Business */
	Business = 8,
	/** Signed-up to Enterprise */
	Enterprise = 9,
}

export interface IChatSentiment {

	/**
	 * User has Chat installed.
	 */
	installed?: boolean;

	/**
	 * User signals no intent in using Chat.
	 *
	 * Note: in contrast to `disabled`, this should not only disable
	 * Chat but also hide all of its UI.
	 */
	hidden?: boolean;

	/**
	 * User signals intent to disable Chat.
	 *
	 * Note: in contrast to `hidden`, this should not hide
	 * Chat but but disable its functionality.
	 */
	disabled?: boolean;

	/**
	 * Chat is disabled due to missing workspace trust.
	 *
	 * Note: even though this disables Chat, we want to treat it
	 * different from the `disabled` state that is by explicit
	 * user choice.
	 */
	untrusted?: boolean;

	/**
	 * User signals intent to use Chat later.
	 */
	later?: boolean;

	/**
	 * User has registered as Free or Pro user.
	 */
	registered?: boolean;
}

export interface IChatEntitlementService {

	_serviceBrand: undefined;

	readonly onDidChangeEntitlement: Event<void>;

	readonly entitlement: ChatEntitlement;
	readonly entitlementObs: IObservable<ChatEntitlement>;

	readonly organisations: string[] | undefined;
	readonly isInternal: boolean;
	readonly sku: string | undefined;
	readonly aiTrackingId: string | undefined;

	readonly onDidChangeQuotaExceeded: Event<void>;
	readonly onDidChangeQuotaRemaining: Event<void>;

	readonly quotas: IQuotas;

	readonly onDidChangeSentiment: Event<void>;

	readonly sentiment: IChatSentiment;
	readonly sentimentObs: IObservable<IChatSentiment>;

	// TODO@bpasero eventually this will become enabled by default
	// and in that case we only need to check on entitlements change
	// between `unknown` and any other entitlement.
	readonly onDidChangeAnonymous: Event<void>;
	readonly anonymous: boolean;
	readonly anonymousObs: IObservable<boolean>;

	update(token: CancellationToken): Promise<void>;
}

//#region Helper Functions

/**
 * Checks the chat entitlements to see if the user falls into the paid category
 * @param chatEntitlement The chat entitlement to check
 * @returns Whether or not they are a paid user
 */
export function isProUser(chatEntitlement: ChatEntitlement): boolean {
	return chatEntitlement === ChatEntitlement.Pro ||
		chatEntitlement === ChatEntitlement.ProPlus ||
		chatEntitlement === ChatEntitlement.Business ||
		chatEntitlement === ChatEntitlement.Enterprise;
}

/**
 * Gets the full plan name for the given chat entitlement
 * @param chatEntitlement The chat entitlement to get the plan name for
 * @returns The localized full plan name
 */
export function getChatPlanName(chatEntitlement: ChatEntitlement): string {
	switch (chatEntitlement) {
		case ChatEntitlement.Pro:
			return localize('plan.proName', 'Pro');
		case ChatEntitlement.ProPlus:
			return localize('plan.proPlusName', 'Pro+');
		case ChatEntitlement.Business:
			return localize('plan.businessName', 'Business');
		case ChatEntitlement.Enterprise:
			return localize('plan.enterpriseName', 'Enterprise');
		default:
			return localize('plan.freeName', 'Free');
	}
}

//#region Service Implementation

const defaultChatAgent = {
	upgradePlanUrl: '',
	providerUriSetting: '',
	entitlementSignupLimitedUrl: '',
	chatQuotaExceededContext: 'chatQuotaExceeded',
	completionsQuotaExceededContext: 'completionsQuotaExceeded'
};

interface IChatQuotasAccessor {
	clearQuotas(): void;
	acceptQuotas(quotas: IQuotas): void;
}

const CHAT_ALLOW_ANONYMOUS_CONFIGURATION_KEY = 'chat.allowAnonymousAccess';

function isAnonymous(configurationService: IConfigurationService, entitlement: ChatEntitlement, sentiment: IChatSentiment): boolean {
	if (configurationService.getValue(CHAT_ALLOW_ANONYMOUS_CONFIGURATION_KEY) !== true) {
		return false; // only enabled behind an experimental setting
	}

	if (entitlement !== ChatEntitlement.Unknown) {
		return false; // only consider signed out users
	}

	if (sentiment.hidden || sentiment.disabled) {
		return false; // only consider enabled scenarios
	}

	return true;
}

type ChatEntitlementClassification = {
	owner: 'bpasero';
	comment: 'Provides insight into chat entitlements.';
	chatHidden: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether chat is hidden or not.' };
	chatEntitlement: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The current chat entitlement of the user.' };
	chatAnonymous: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user is anonymously using chat.' };
	chatRegistered: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user is registered for chat.' };
	chatDisabled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether chat is disabled or not.' };
};
type ChatEntitlementEvent = {
	chatHidden: boolean;
	chatEntitlement: ChatEntitlement;
	chatAnonymous: boolean;
	chatRegistered: boolean;
	chatDisabled: boolean;
};

function logChatEntitlements(state: IChatEntitlementContextState, configurationService: IConfigurationService, telemetryService: ITelemetryService): void {
	telemetryService.publicLog2<ChatEntitlementEvent, ChatEntitlementClassification>('chatEntitlements', {
		chatHidden: Boolean(state.hidden),
		chatDisabled: Boolean(state.disabled),
		chatEntitlement: state.entitlement,
		chatRegistered: Boolean(state.registered),
		chatAnonymous: isAnonymous(configurationService, state.entitlement, state)
	});
}

export class ChatEntitlementService extends Disposable implements IChatEntitlementService {

	declare _serviceBrand: undefined;

	readonly context: Lazy<ChatEntitlementContext> | undefined;
	readonly requests: Lazy<ChatEntitlementRequests> | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService productService: IProductService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();

		this.chatQuotaExceededContextKey = ChatEntitlementContextKeys.chatQuotaExceeded.bindTo(this.contextKeyService);
		this.completionsQuotaExceededContextKey = ChatEntitlementContextKeys.completionsQuotaExceeded.bindTo(this.contextKeyService);

		this.anonymousContextKey = ChatEntitlementContextKeys.chatAnonymous.bindTo(this.contextKeyService);
		this.anonymousContextKey.set(this.anonymous);

		this.onDidChangeEntitlement = Event.map(
			Event.filter(
				this.contextKeyService.onDidChangeContext, e => e.affectsSome(new Set([
					ChatEntitlementContextKeys.Entitlement.planPro.key,
					ChatEntitlementContextKeys.Entitlement.planBusiness.key,
					ChatEntitlementContextKeys.Entitlement.planEnterprise.key,
					ChatEntitlementContextKeys.Entitlement.planProPlus.key,
					ChatEntitlementContextKeys.Entitlement.planFree.key,
					ChatEntitlementContextKeys.Entitlement.canSignUp.key,
					ChatEntitlementContextKeys.Entitlement.signedOut.key,
					ChatEntitlementContextKeys.Entitlement.organisations.key,
					ChatEntitlementContextKeys.Entitlement.internal.key,
					ChatEntitlementContextKeys.Entitlement.sku.key
				])), this._store
			), () => { }, this._store
		);
		this.entitlementObs = observableFromEvent(this.onDidChangeEntitlement, () => this.entitlement);

		this.onDidChangeSentiment = Event.map(
			Event.filter(
				this.contextKeyService.onDidChangeContext, e => e.affectsSome(new Set([
					ChatEntitlementContextKeys.Setup.hidden.key,
					ChatEntitlementContextKeys.Setup.disabled.key,
					ChatEntitlementContextKeys.Setup.untrusted.key,
					ChatEntitlementContextKeys.Setup.installed.key,
					ChatEntitlementContextKeys.Setup.later.key,
					ChatEntitlementContextKeys.Setup.registered.key
				])), this._store
			), () => { }, this._store
		);
		this.sentimentObs = observableFromEvent(this.onDidChangeSentiment, () => this.sentiment);

		if ((isWeb && !environmentService.remoteAuthority)) {
			ChatEntitlementContextKeys.Setup.hidden.bindTo(this.contextKeyService).set(true); // hide UI on web if unsupported
			return;
		}

		// Neutralized: no longer checking for product.defaultChatAgent

		const context = this.context = new Lazy(() => this._register(instantiationService.createInstance(ChatEntitlementContext)));
		this.requests = new Lazy(() => this._register(instantiationService.createInstance(ChatEntitlementRequests, context.value, {
			clearQuotas: () => this.clearQuotas(),
			acceptQuotas: quotas => this.acceptQuotas(quotas)
		})));

		this.registerListeners();
	}

	//#region --- Entitlements

	readonly onDidChangeEntitlement: Event<void>;
	readonly entitlementObs: IObservable<ChatEntitlement>;

	get entitlement(): ChatEntitlement {
		if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.planPro.key) === true) {
			return ChatEntitlement.Pro;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.planBusiness.key) === true) {
			return ChatEntitlement.Business;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.planEnterprise.key) === true) {
			return ChatEntitlement.Enterprise;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.planProPlus.key) === true) {
			return ChatEntitlement.ProPlus;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.planFree.key) === true) {
			return ChatEntitlement.Free;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.canSignUp.key) === true) {
			return ChatEntitlement.Available;
		} else if (this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.signedOut.key) === true) {
			return ChatEntitlement.Unknown;
		}

		return ChatEntitlement.Unresolved;
	}

	get isInternal(): boolean {
		return this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Entitlement.internal.key) === true;
	}

	get organisations(): string[] | undefined {
		return this.contextKeyService.getContextKeyValue<string[]>(ChatEntitlementContextKeys.Entitlement.organisations.key);
	}

	get sku(): string | undefined {
		return this.contextKeyService.getContextKeyValue<string>(ChatEntitlementContextKeys.Entitlement.sku.key);
	}

	get aiTrackingId(): string | undefined {
		return this.context?.value.state.aiTrackingId;
	}

	//#endregion

	//#region --- Quotas

	private readonly _onDidChangeQuotaExceeded = this._register(new Emitter<void>());
	readonly onDidChangeQuotaExceeded = this._onDidChangeQuotaExceeded.event;

	private readonly _onDidChangeQuotaRemaining = this._register(new Emitter<void>());
	readonly onDidChangeQuotaRemaining = this._onDidChangeQuotaRemaining.event;

	private _quotas: IQuotas = {};
	get quotas() { return this._quotas; }

	private readonly chatQuotaExceededContextKey: IContextKey<boolean>;
	private readonly completionsQuotaExceededContextKey: IContextKey<boolean>;

	private ExtensionQuotaContextKeys = {
		chatQuotaExceeded: defaultChatAgent.chatQuotaExceededContext,
		completionsQuotaExceeded: defaultChatAgent.completionsQuotaExceededContext,
	};

	private registerListeners(): void {
		const quotaExceededSet = new Set([this.ExtensionQuotaContextKeys.chatQuotaExceeded, this.ExtensionQuotaContextKeys.completionsQuotaExceeded]);

		const cts = this._register(new MutableDisposable<CancellationTokenSource>());
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(quotaExceededSet)) {
				if (cts.value) {
					cts.value.cancel();
				}
				cts.value = new CancellationTokenSource();
				this.update(cts.value.token);
			}
		}));

		let anonymousUsage = this.anonymous;

		const updateAnonymousUsage = () => {
			const newAnonymousUsage = this.anonymous;
			if (newAnonymousUsage !== anonymousUsage) {
				anonymousUsage = newAnonymousUsage;
				this.anonymousContextKey.set(newAnonymousUsage);

				if (this.context?.hasValue) {
					logChatEntitlements(this.context.value.state, this.configurationService, this.telemetryService);
				}

				this._onDidChangeAnonymous.fire();
			}
		};

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CHAT_ALLOW_ANONYMOUS_CONFIGURATION_KEY)) {
				updateAnonymousUsage();
			}
		}));

		this._register(this.onDidChangeEntitlement(() => updateAnonymousUsage()));
		this._register(this.onDidChangeSentiment(() => updateAnonymousUsage()));
	}

	acceptQuotas(quotas: IQuotas): void {
		const oldQuota = this._quotas;
		this._quotas = quotas;
		this.updateContextKeys();

		const { changed: chatChanged } = this.compareQuotas(oldQuota.chat, quotas.chat);
		const { changed: completionsChanged } = this.compareQuotas(oldQuota.completions, quotas.completions);
		const { changed: premiumChatChanged } = this.compareQuotas(oldQuota.premiumChat, quotas.premiumChat);

		if (chatChanged.exceeded || completionsChanged.exceeded || premiumChatChanged.exceeded) {
			this._onDidChangeQuotaExceeded.fire();
		}

		if (chatChanged.remaining || completionsChanged.remaining || premiumChatChanged.remaining) {
			this._onDidChangeQuotaRemaining.fire();
		}
	}

	private compareQuotas(oldQuota: IQuotaSnapshot | undefined, newQuota: IQuotaSnapshot | undefined): { changed: { exceeded: boolean; remaining: boolean } } {
		return {
			changed: {
				exceeded: (oldQuota?.percentRemaining === 0) !== (newQuota?.percentRemaining === 0),
				remaining: oldQuota?.percentRemaining !== newQuota?.percentRemaining
			}
		};
	}

	clearQuotas(): void {
		this.acceptQuotas({});
	}

	private updateContextKeys(): void {
		this.chatQuotaExceededContextKey.set(this._quotas.chat?.percentRemaining === 0);
		this.completionsQuotaExceededContextKey.set(this._quotas.completions?.percentRemaining === 0);
	}

	//#endregion

	//#region --- Sentiment

	readonly onDidChangeSentiment: Event<void>;
	readonly sentimentObs: IObservable<IChatSentiment>;

	get sentiment(): IChatSentiment {
		return {
			installed: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.installed.key) === true,
			hidden: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.hidden.key) === true,
			disabled: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.disabled.key) === true,
			untrusted: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.untrusted.key) === true,
			later: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.later.key) === true,
			registered: this.contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.Setup.registered.key) === true
		};
	}

	//#endregion

	//region --- Anonymous

	private readonly anonymousContextKey: IContextKey<boolean>;

	private readonly _onDidChangeAnonymous = this._register(new Emitter<void>());
	readonly onDidChangeAnonymous = this._onDidChangeAnonymous.event;

	readonly anonymousObs = observableFromEvent(this.onDidChangeAnonymous, () => this.anonymous);

	get anonymous(): boolean {
		return isAnonymous(this.configurationService, this.entitlement, this.sentiment);
	}

	//#endregion

	async update(token: CancellationToken): Promise<void> {
		await this.requests?.value.forceResolveEntitlement(token);
	}
}

//#endregion

//#region Chat Entitlement Request Service

interface IEntitlements {
	readonly entitlement: ChatEntitlement;
	readonly organisations?: string[];
	readonly sku?: string;
	readonly aiTrackingId?: string;
	readonly quotas?: IQuotas;
}

export interface IQuotaSnapshot {
	readonly total: number;

	readonly remaining: number;
	readonly percentRemaining: number;

	readonly overageEnabled: boolean;
	readonly overageCount: number;

	readonly unlimited: boolean;
}

interface IQuotas {
	readonly resetDate?: string;
	readonly resetDateHasTime?: boolean;

	readonly chat?: IQuotaSnapshot;
	readonly completions?: IQuotaSnapshot;
	readonly premiumChat?: IQuotaSnapshot;
}

export class ChatEntitlementRequests extends Disposable {

	private state: IEntitlements;

	private pendingResolveCts = new CancellationTokenSource();

	constructor(
		private readonly context: ChatEntitlementContext,
		private readonly chatQuotasAccessor: IChatQuotasAccessor,
		@ILogService private readonly logService: ILogService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
	) {
		super();

		this.state = { entitlement: this.context.state.entitlement };

		this.registerListeners();

		this.resolve();
	}

	private registerListeners(): void {
		this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => this.resolve()));

		this._register(this.context.onDidChange(() => {
			if (!this.context.state.installed || this.context.state.disabled || this.context.state.entitlement === ChatEntitlement.Unknown) {
				// When the extension is not installed, disabled or the user is not entitled
				// make sure to clear quotas so that any indicators are also gone
				this.state = { entitlement: this.state.entitlement, quotas: undefined };
				this.chatQuotasAccessor.clearQuotas();
			}
		}));
	}

	private async resolve(): Promise<void> {
		this.pendingResolveCts.dispose(true);
		const cts = this.pendingResolveCts = new CancellationTokenSource();

		const defaultAccount = await this.defaultAccountService.getDefaultAccount();
		if (cts.token.isCancellationRequested) {
			return;
		}

		// Immediately signal whether we have a session or not
		let state: IEntitlements | undefined = undefined;
		if (defaultAccount) {
			// Do not overwrite any state we have already
			if (this.state.entitlement === ChatEntitlement.Unknown) {
				state = { entitlement: ChatEntitlement.Unresolved };
			}
		} else {
			state = { entitlement: ChatEntitlement.Unknown };
		}
		if (state) {
			this.update(state);
		}

		if (defaultAccount) {
			// Afterwards resolve entitlement with a network request
			// but only unless it was not already resolved before.
			await this.resolveEntitlement(defaultAccount, cts.token);
		}
	}

	private async resolveEntitlement(defaultAccount: IDefaultAccount, token: CancellationToken): Promise<IEntitlements | undefined> {
		const entitlements = await this.doResolveEntitlement(defaultAccount, token);
		if (typeof entitlements?.entitlement === 'number' && !token.isCancellationRequested) {
			this.update(entitlements);
		}
		return entitlements;
	}

	private async doResolveEntitlement(defaultAccount: IDefaultAccount, token: CancellationToken): Promise<IEntitlements | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}

		const defaultEntitlements: IEntitlements = {
			entitlement: ChatEntitlement.Available,
			organisations: [],
			quotas: {},
			sku: undefined,
			aiTrackingId: undefined
		};

		this.logService.trace(`[chat entitlement]: resolved to ${defaultEntitlements.entitlement}`);

		return defaultEntitlements;
	}

	private update(state: IEntitlements): void {
		this.state = state;

		this.context.update({ entitlement: this.state.entitlement, organisations: this.state.organisations, sku: this.state.sku, aiTrackingId: this.state.aiTrackingId });

		if (state.quotas) {
			this.chatQuotasAccessor.acceptQuotas(state.quotas);
		}
	}

	async forceResolveEntitlement(token = CancellationToken.None): Promise<IEntitlements | undefined> {
		const defaultAccount = await this.defaultAccountService.refresh();
		if (!defaultAccount) {
			return undefined;
		}

		return this.resolveEntitlement(defaultAccount, token);
	}

	async signIn(options?: { useSocialProvider?: string; additionalScopes?: readonly string[] }): Promise<{ defaultAccount?: IDefaultAccount; entitlements?: IEntitlements }> {
		const defaultAccount = await this.defaultAccountService.signIn({
			additionalScopes: options?.additionalScopes,
			provider: options?.useSocialProvider
		});
		if (!defaultAccount) {
			return {};
		}

		const entitlements = await this.doResolveEntitlement(defaultAccount, CancellationToken.None);
		return { defaultAccount, entitlements };
	}

	override dispose(): void {
		this.pendingResolveCts.dispose(true);

		super.dispose();
	}
}

//#endregion

//#region Context

export interface IChatEntitlementContextState extends IChatSentiment {

	/**
	 * Users last known or resolved entitlement.
	 */
	entitlement: ChatEntitlement;

	/**
	 * User's last known or resolved raw SKU type.
	 */
	sku: string | undefined;

	/**
	 * User's last known or resolved organisations.
	 */
	organisations: string[] | undefined;

	/**
	 * User's AI tracking ID from the entitlement API.
	 */
	aiTrackingId: string | undefined;

	/**
	 * User is or was a registered Chat user.
	 */
	registered?: boolean;
}

export class ChatEntitlementContext extends Disposable {

	private static readonly CHAT_ENTITLEMENT_CONTEXT_STORAGE_KEY = 'chat.setupContext';

	private static readonly CHAT_DISABLED_CONFIGURATION_KEY = 'chat.disableAIFeatures';

	private readonly canSignUpContextKey: IContextKey<boolean>;
	private readonly signedOutContextKey: IContextKey<boolean>;

	private readonly freeContextKey: IContextKey<boolean>;
	private readonly proContextKey: IContextKey<boolean>;
	private readonly proPlusContextKey: IContextKey<boolean>;
	private readonly businessContextKey: IContextKey<boolean>;
	private readonly enterpriseContextKey: IContextKey<boolean>;

	private readonly organisationsContextKey: IContextKey<string[] | undefined>;
	private readonly isInternalContextKey: IContextKey<boolean>;
	private readonly skuContextKey: IContextKey<string | undefined>;

	private readonly hiddenContext: IContextKey<boolean>;
	private readonly laterContext: IContextKey<boolean>;
	private readonly installedContext: IContextKey<boolean>;
	private readonly disabledContext: IContextKey<boolean>;
	private readonly untrustedContext: IContextKey<boolean>;
	private readonly registeredContext: IContextKey<boolean>;

	private _state: IChatEntitlementContextState;
	private suspendedState: IChatEntitlementContextState | undefined = undefined;
	get state(): IChatEntitlementContextState { return this.withConfiguration(this.suspendedState ?? this._state); }

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private updateBarrier: Barrier | undefined = undefined;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();

		this.canSignUpContextKey = ChatEntitlementContextKeys.Entitlement.canSignUp.bindTo(contextKeyService);
		this.signedOutContextKey = ChatEntitlementContextKeys.Entitlement.signedOut.bindTo(contextKeyService);

		this.freeContextKey = ChatEntitlementContextKeys.Entitlement.planFree.bindTo(contextKeyService);
		this.proContextKey = ChatEntitlementContextKeys.Entitlement.planPro.bindTo(contextKeyService);
		this.proPlusContextKey = ChatEntitlementContextKeys.Entitlement.planProPlus.bindTo(contextKeyService);
		this.businessContextKey = ChatEntitlementContextKeys.Entitlement.planBusiness.bindTo(contextKeyService);
		this.enterpriseContextKey = ChatEntitlementContextKeys.Entitlement.planEnterprise.bindTo(contextKeyService);

		this.organisationsContextKey = ChatEntitlementContextKeys.Entitlement.organisations.bindTo(contextKeyService);
		this.isInternalContextKey = ChatEntitlementContextKeys.Entitlement.internal.bindTo(contextKeyService);
		this.skuContextKey = ChatEntitlementContextKeys.Entitlement.sku.bindTo(contextKeyService);

		this.hiddenContext = ChatEntitlementContextKeys.Setup.hidden.bindTo(contextKeyService);
		this.laterContext = ChatEntitlementContextKeys.Setup.later.bindTo(contextKeyService);
		this.installedContext = ChatEntitlementContextKeys.Setup.installed.bindTo(contextKeyService);
		this.disabledContext = ChatEntitlementContextKeys.Setup.disabled.bindTo(contextKeyService);
		this.untrustedContext = ChatEntitlementContextKeys.Setup.untrusted.bindTo(contextKeyService);
		this.registeredContext = ChatEntitlementContextKeys.Setup.registered.bindTo(contextKeyService);

		this._state = this.storageService.getObject<IChatEntitlementContextState>(ChatEntitlementContext.CHAT_ENTITLEMENT_CONTEXT_STORAGE_KEY, StorageScope.PROFILE) ?? { entitlement: ChatEntitlement.Unknown, organisations: undefined, sku: undefined, aiTrackingId: undefined };

		this.updateContextSync();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatEntitlementContext.CHAT_DISABLED_CONFIGURATION_KEY)) {
				this.updateContext();
			}
		}));
	}

	private withConfiguration(state: IChatEntitlementContextState): IChatEntitlementContextState {
		if (this.configurationService.getValue(ChatEntitlementContext.CHAT_DISABLED_CONFIGURATION_KEY) === true) {
			return {
				...state,
				hidden: true // Setting always wins: if AI is disabled, set `hidden: true`
			};
		}

		return state;
	}

	update(context: { installed: boolean; disabled: boolean; untrusted: boolean }): Promise<void>;
	update(context: { hidden: false }): Promise<void>; // legacy UI state from before we had a setting to hide, keep around to still support users who used this
	update(context: { later: boolean }): Promise<void>;
	update(context: { entitlement: ChatEntitlement; organisations: string[] | undefined; sku: string | undefined; aiTrackingId: string | undefined }): Promise<void>;
	async update(context: { installed?: boolean; disabled?: boolean; untrusted?: boolean; hidden?: false; later?: boolean; entitlement?: ChatEntitlement; organisations?: string[]; sku?: string; aiTrackingId?: string }): Promise<void> {
		this.logService.trace(`[chat entitlement context] update(): ${JSON.stringify(context)}`);

		const oldState = JSON.stringify(this._state);

		if (typeof context.installed === 'boolean' && typeof context.disabled === 'boolean' && typeof context.untrusted === 'boolean') {
			this._state.installed = context.installed;
			this._state.disabled = context.disabled;
			this._state.untrusted = context.untrusted;

			if (context.installed && !context.disabled) {
				context.hidden = false; // treat this as a sign to make Chat visible again in case it is hidden
			}
		}

		if (typeof context.hidden === 'boolean') {
			this._state.hidden = context.hidden;
		}

		if (typeof context.later === 'boolean') {
			this._state.later = context.later;
		}

		if (typeof context.entitlement === 'number') {
			this._state.entitlement = context.entitlement;
			this._state.organisations = context.organisations;
			this._state.sku = context.sku;
			this._state.aiTrackingId = context.aiTrackingId;

			if (this._state.entitlement === ChatEntitlement.Free || isProUser(this._state.entitlement)) {
				this._state.registered = true;
			} else if (this._state.entitlement === ChatEntitlement.Available) {
				this._state.registered = false; // only reset when signed-in user can sign-up for free
			}
		}

		if (isAnonymous(this.configurationService, this._state.entitlement, this._state)) {
			this._state.sku = 'no_auth_limited'; // no-auth users have a fixed SKU
		}

		if (oldState === JSON.stringify(this._state)) {
			return; // state did not change
		}

		this.storageService.store(ChatEntitlementContext.CHAT_ENTITLEMENT_CONTEXT_STORAGE_KEY, {
			...this._state,
			later: undefined // do not persist this across restarts for now
		}, StorageScope.PROFILE, StorageTarget.MACHINE);

		return this.updateContext();
	}

	private async updateContext(): Promise<void> {
		await this.updateBarrier?.wait();

		this.updateContextSync();
	}

	private updateContextSync(): void {
		const state = this.withConfiguration(this._state);

		this.signedOutContextKey.set(state.entitlement === ChatEntitlement.Unknown);
		this.canSignUpContextKey.set(state.entitlement === ChatEntitlement.Available);

		this.freeContextKey.set(state.entitlement === ChatEntitlement.Free);
		this.proContextKey.set(state.entitlement === ChatEntitlement.Pro);
		this.proPlusContextKey.set(state.entitlement === ChatEntitlement.ProPlus);
		this.businessContextKey.set(state.entitlement === ChatEntitlement.Business);
		this.enterpriseContextKey.set(state.entitlement === ChatEntitlement.Enterprise);

		this.organisationsContextKey.set(state.organisations);
		this.isInternalContextKey.set(false);
		this.skuContextKey.set(state.sku);

		this.hiddenContext.set(!!state.hidden);
		this.laterContext.set(!!state.later);
		this.installedContext.set(!!state.installed);
		this.disabledContext.set(!!state.disabled);
		this.untrustedContext.set(!!state.untrusted);
		this.registeredContext.set(!!state.registered);

		this.logService.trace(`[chat entitlement context] updateContext(): ${JSON.stringify(state)}`);
		logChatEntitlements(state, this.configurationService, this.telemetryService);

		this._onDidChange.fire();
	}

	suspend(): void {
		this.suspendedState = { ...this._state };
		this.updateBarrier = new Barrier();
	}

	resume(): void {
		this.suspendedState = undefined;
		this.updateBarrier?.open();
		this.updateBarrier = undefined;
	}
}

registerSingleton(IChatEntitlementService, ChatEntitlementService, InstantiationType.Eager /* To ensure context keys are set asap */);
