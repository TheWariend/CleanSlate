/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getCleanSlateHostToolPresentation, getCleanSlateExternalFileMutationBlocks, getCleanSlateExternalBrowserPresentation, getCleanSlateExternalToolOutput, isCleanSlateReasoningVisuallyStreaming } from '../../browser/chat/renderers/cleanSlateActivityPresentation.js';

suite('CleanSlate host tool presentation', () => {
    test('unwraps external text tool results without changing ordinary output', () => {
		const base = { id: 'fetch', type: 'tool' as const, externalTool: true, content: 'Fetch documentation', toolName: 'fetch', toolStatus: 'completed' as const };
        assert.strictEqual(getCleanSlateExternalToolOutput({ ...base, output: JSON.stringify({ content: '# README\n\nProject details' }) }), '# README\n\nProject details');
        assert.strictEqual(getCleanSlateExternalToolOutput({ ...base, output: JSON.stringify({ content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }) }), 'first\n\nsecond');
        assert.strictEqual(getCleanSlateExternalToolOutput({ ...base, output: 'plain output' }), 'plain output');
		assert.strictEqual(getCleanSlateExternalToolOutput({ ...base, externalTool: false, output: '{"content":"internal"}' }), '{"content":"internal"}');
    });

	test('preserves expandable read and search output', () => {
		assert.strictEqual(getCleanSlateExternalToolOutput({ id: 'read', type: 'tool', externalTool: true, content: 'cleanslate-ide_read_file', output: '# README\n\n![Logo](logo.png)' }), '# README\n\n![Logo](logo.png)');
		assert.strictEqual(getCleanSlateExternalToolOutput({ id: 'search', type: 'tool', externalTool: true, content: 'Search repository', toolName: 'search', output: 'search payload' }), 'search payload');
	});

    test('browser state is not exposed as transcript output', () => {
        const presentation = getCleanSlateExternalBrowserPresentation({ id: 'browser', type: 'tool', externalTool: true, content: 'cleanslate-ide_browser_open', toolStatus: 'completed', output: JSON.stringify({ success: true, surface: 'agentManager:session', viewId: 'internal-view', url: 'file:///workspace/acme.html', title: 'ACME Corporation', visible: true, loading: false, canGoBack: false, annotationActive: false }) });
        assert.deepStrictEqual(presentation, { label: 'Opened IDE browser · ACME Corporation', output: '' });
    });
    test('browser failures and useful page text remain visible without transport metadata', () => {
        const base = { id: 'browser', type: 'tool' as const, externalTool: true, content: 'cleanslate-ide_browser_snapshot' };
        assert.deepStrictEqual(getCleanSlateExternalBrowserPresentation({ ...base, output: '{"snapshot":"Page heading","surface":"internal"}' }), { label: 'Read page', output: 'Page heading' });
        assert.deepStrictEqual(getCleanSlateExternalBrowserPresentation({ ...base, output: '{"success":false,"error":"Page unavailable","viewId":"internal"}' }), { label: 'Browser action failed', output: 'Page unavailable' });
        assert.strictEqual(getCleanSlateExternalBrowserPresentation({ ...base, toolStatus: 'failed', output: 'Request timed out' })?.output, 'Request timed out');
    });
    test('reuses mutation data without fabricating counts or creation status', () => {
        assert.deepStrictEqual(getCleanSlateExternalFileMutationBlocks({ id: 'edit', type: 'tool', externalTool: true, toolName: 'edit', toolStatus: 'completed', details: ['/workspace/index.html'] }), []);
        const [created] = getCleanSlateExternalFileMutationBlocks({ id: 'edit', type: 'tool', externalTool: true, toolName: 'edit', toolStatus: 'completed', fileChanges: [{ path: '/workspace/new.html', created: true, beforeContent: '', afterContent: 'hello', added: 1 }] });
        assert.strictEqual(created.status, 'Created');
        assert.strictEqual(created.afterContent, 'hello');
        assert.strictEqual(created.added, 1);
    });
    test('does not label failed edits as completed or treat URLs as file paths', () => {
        const [failed] = getCleanSlateExternalFileMutationBlocks({ id: 'edit', type: 'tool', externalTool: true, toolName: 'edit', toolStatus: 'failed', isStreaming: true, fileChanges: [{ path: '/workspace/index.html', beforeContent: '', afterContent: 'text' }] });
        assert.strictEqual(failed.status, 'Failed');
        assert.strictEqual(failed.isStreaming, false);
        assert.deepStrictEqual(getCleanSlateExternalFileMutationBlocks({ id: 'fetch', type: 'tool', externalTool: true, toolName: 'fetch', details: ['/workspace/index.html'] }), []);
    });
    test('uses semantic labels and matching icons for advertised host tools', () => {
        assert.deepStrictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_list_dir', true), { label: 'Exploring folder', icon: 'codicon-folder' });
        assert.deepStrictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_list_dir', false), { label: 'Explored folder', icon: 'codicon-folder' });
        assert.strictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_browser_open', true)?.icon, 'codicon-globe');
        assert.strictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_grep_search', true)?.label, 'Searching workspace');
		assert.deepStrictEqual(getCleanSlateHostToolPresentation('Inspecting workspace files', false, 'read'), { label: 'Read files', icon: 'codicon-file' });
		assert.deepStrictEqual(getCleanSlateHostToolPresentation('Looking for references', true, 'search'), { label: 'Searching workspace', icon: 'codicon-search' });
    });
    test('does not reinterpret unrelated agent labels', () => {
        assert.strictEqual(getCleanSlateHostToolPresentation('Custom tool: list_dir', true), undefined);
        assert.strictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_list_dir/unrelated', true), undefined);
    });
    test('formats newly advertised host tools without a provider-specific table', () => {
        assert.deepStrictEqual(getCleanSlateHostToolPresentation('cleanslate-ide_new_capability', true), { label: 'New capability', icon: 'codicon-tools' });
    });
	test('lights only the active reasoning block', () => {
		const reasoning = { id: 'thought', type: 'reasoning' as const, isStreaming: true };
		assert.strictEqual(isCleanSlateReasoningVisuallyStreaming(reasoning, true), true);
		assert.strictEqual(isCleanSlateReasoningVisuallyStreaming(reasoning, false), false);
		assert.strictEqual(isCleanSlateReasoningVisuallyStreaming({ ...reasoning, isStreaming: false }, true), false);
	});
});
