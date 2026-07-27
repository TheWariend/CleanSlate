/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS, CleanSlateReasoningLevel, ICleanSlateConfigurationService, normalizeCleanSlateExecutionState } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';

export interface ICleanSlateChatSettingsState {
    contextWindow: number;
    fileTruncation: number;
    planMode: boolean;
    reasoningLevel: CleanSlateReasoningLevel;
}

export class CleanSlateChatSettingsProvider extends Disposable {
    private state: ICleanSlateChatSettingsState;
    private readonly _onDidChangeState = new Emitter<ICleanSlateChatSettingsState>();
    readonly onDidChangeState: Event<ICleanSlateChatSettingsState> = this._onDidChangeState.event;

    constructor(private readonly configService: ICleanSlateConfigurationService) {
        super();
        this._register(this._onDidChangeState);
        this.state = this.readState();
        this._register(this.configService.onDidChangeConfiguration(() => this.refresh()));
    }

    getState(): ICleanSlateChatSettingsState {
        return this.state;
    }

    refresh(): void {
        this.state = this.readState();
        this._onDidChangeState.fire(this.state);
    }

    async updateContextWindow(value: number): Promise<void> {
        await this.configService.updateConfiguration({ contextWindow: value });
        this.refresh();
    }

    async updateFileTruncation(value: number): Promise<void> {
        await this.configService.updateConfiguration({ fileTruncation: value });
        this.refresh();
    }

    async updatePlanMode(planMode: boolean): Promise<void> {
        this.state = { ...this.state, planMode };
        this._onDidChangeState.fire(this.state);
        await this.configService.updateConfiguration({ planMode });
        this.refresh();
    }

    async updateReasoningLevel(reasoningLevel: CleanSlateReasoningLevel): Promise<void> {
        this.state = { ...this.state, reasoningLevel };
        this._onDidChangeState.fire(this.state);
        await this.configService.updateConfiguration({ reasoningLevel });
        this.refresh();
    }

    private readState(): ICleanSlateChatSettingsState {
        const config = this.configService.getConfiguration();
        const executionState = normalizeCleanSlateExecutionState({
            planMode: config.planMode,
            reasoningLevel: config.reasoningLevel
        });
        return {
            contextWindow: config.contextWindow || CLEANSLATE_FALLBACK_CONTEXT_WINDOW_TOKENS,
            fileTruncation: config.fileTruncation || 4000,
            planMode: executionState.planMode,
            reasoningLevel: executionState.reasoningLevel
        };
    }
}
