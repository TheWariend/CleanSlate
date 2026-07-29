/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { Box, Text } from 'ink';

/**
 * Portable terminal rendering of the faceted C used by the CleanSlate desktop
 * application. It deliberately uses standard Unicode blocks instead of a
 * terminal-specific inline-image protocol.
 */
export function CleanSlateTerminalLogo() {
	return (
		<Box flexDirection="column" marginRight={2}>
			<Text><Text color="#fafafa">  ◢██████</Text></Text>
			<Text><Text color="#b4b4bb">██</Text></Text>
			<Text><Text color="#73737d">  ◥██████</Text></Text>
		</Box>
	);
}
