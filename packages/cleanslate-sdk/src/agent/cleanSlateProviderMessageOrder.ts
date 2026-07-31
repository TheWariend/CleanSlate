/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from '../protocol/cleanSlateAI.js';

/**
 * Ensures a request that is still waiting on the model's first reply ends with the user's turn.
 *
 * Hosts assemble grounding around the user message, and some append their objective and context
 * reminders after it, leaving the request ending on a `system` message. The model then has no
 * clean "assistant turn starts here" boundary and continues the transcript instead of answering:
 * measured against a proxied deepseek-v4-flash with identical content, only the order changed —
 *
 *   system, user, system, system -> "I acknowledge the user's gratitude … </think>You're welcome!"
 *   system, system, system, user -> "You're very welcome! …"
 *
 * The first shape also invents whole user turns on longer prompts. The workbench never hit this
 * because its runtime turn is built as `[system, user]`; the terminal host appended after the
 * user message, so the fix belongs here, in the one place every host funnels through.
 *
 * Deliberately narrow: this only moves system messages that trail the LAST user message when
 * nothing has been generated for that turn yet. Once an assistant or tool message follows the
 * user turn, a trailing system message is a mid-loop steering prompt (a recovery nudge, a
 * no-tool reminder) that must stay exactly where the loop put it — hoisting those would change
 * what they steer.
 */
export function orderUserTurnLast(messages: readonly IChatMessage[]): IChatMessage[] {
	const lastUserIndex = messages.map(message => message.role).lastIndexOf('user');
	if (lastUserIndex < 0 || lastUserIndex === messages.length - 1) {
		return messages as IChatMessage[];
	}
	const trailing = messages.slice(lastUserIndex + 1);
	if (!trailing.every(message => message.role === 'system')) {
		return messages as IChatMessage[];
	}
	return [...messages.slice(0, lastUserIndex), ...trailing, messages[lastUserIndex]];
}
