/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../../../platform/product/common/productService.js';
import { isOrganizationPromptFile } from '../../../../common/promptSyntax/utils/promptsServiceUtils.js';
import { mockService } from './mock.js';

suite('promptsServiceUtils', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('isOrganizationPromptFile', () => {
		const CHAT_EXTENSION_ID = 'github.ai-chat';

		function createProductService(): IProductService {
			return mockService<IProductService>({
				// CleanSlate: defaultChatAgent removed
			} as Partial<IProductService>);
		}

		test('returns false always (Neutralized)', () => {
			const uri = URI.file('/some/path/github/prompts/prompt.md');
			const extensionId = new ExtensionIdentifier(CHAT_EXTENSION_ID);
			const productService = createProductService();

			assert.strictEqual(
				isOrganizationPromptFile(uri, extensionId, productService),
				false,
				'Should return false as the feature is neutralized',
			);
		});
	});
});
