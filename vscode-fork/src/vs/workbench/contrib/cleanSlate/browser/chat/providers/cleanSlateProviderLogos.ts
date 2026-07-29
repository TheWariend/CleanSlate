/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asCSSUrl } from '../../../../../../base/browser/cssValue.js';
import { FileAccess } from '../../../../../../base/common/network.js';
import { AIProvider } from '../../../../../services/cleanSlate/common/core/cleanSlateAI.js';
import { resolveCleanSlateModelFamily } from '@cleanslate/sdk/protocol/cleanSlateModelCapabilities.js';

export interface ICleanSlateProviderLogo {
    readonly label: string;
    readonly cssUrl: string;
}

const providerLogos = {
    openai: {
        label: 'OpenAI',
        cssUrl: asCSSUrl(FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/media/provider-openai.svg'))
    },
    deepseek: {
        label: 'DeepSeek',
        cssUrl: asCSSUrl(FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/media/provider-deepseek.svg'))
    },
    kimi: {
        label: 'Kimi',
        cssUrl: asCSSUrl(FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/media/provider-kimi.svg'))
    },
    xai: {
        label: 'xAI',
        cssUrl: asCSSUrl(FileAccess.asBrowserUri('vs/workbench/contrib/cleanSlate/browser/media/provider-xai.svg'))
    }
} satisfies Record<string, ICleanSlateProviderLogo>;

export function getCleanSlateProviderLogo(provider: AIProvider, model: string | undefined): ICleanSlateProviderLogo | undefined {
    // These logos describe the upstream model families bundled with the
    // managed CleanSlate Pro provider. BYOK providers retain their existing,
    // unbranded selector and composer UI.
    if ((provider as string) !== 'cleanslate') {
        return undefined;
    }

    switch (resolveCleanSlateModelFamily(provider, model)) {
        case 'openai-chat':
        case 'openai-reasoning':
            return providerLogos.openai;
        case 'deepseek':
            return providerLogos.deepseek;
        case 'kimi':
            return providerLogos.kimi;
        case 'grok':
            return providerLogos.xai;
    }

    return undefined;
}

export function setCleanSlateProviderLogo(element: HTMLElement, provider: AIProvider, model: string | undefined): string | undefined {
    const logo = getCleanSlateProviderLogo(provider, model);
    element.style.display = logo ? '' : 'none';
    element.style.maskImage = logo?.cssUrl ?? '';
    element.style.webkitMaskImage = logo?.cssUrl ?? '';
    element.title = logo?.label ?? '';
    element.setAttribute('aria-hidden', 'true');
    return logo?.label;
}
