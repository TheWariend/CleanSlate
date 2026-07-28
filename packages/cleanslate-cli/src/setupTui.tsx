/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { CliProvider, SUPPORTED_PROVIDERS } from './argv.js';
import { CleanSlateTerminalLogo } from './brand.js';

export interface ICliSetupResult {
	provider: CliProvider;
	model: string;
	apiKey?: string;
	managedEmail?: string;
	managedPassword?: string;
	baseUrl?: string;
	bedrockRegion?: string;
	bedrockProfile?: string;
	azureEndpoint?: string;
	azureApiVersion?: string;
}

interface ISetupField {
	key: keyof ICliSetupResult;
	label: string;
	placeholder: string;
	secret?: boolean;
	optional?: boolean;
}

const COLORS = {
	accent: '#8b5cf6',
	cyan: '#22d3ee',
	muted: '#71717a',
	success: '#22c55e'
};

const PROVIDER_LABELS: Record<CliProvider, string> = {
	cleanslate: 'CleanSlate',
	openai: 'OpenAI',
	azureOpenAI: 'Azure OpenAI',
	anthropic: 'Anthropic',
	gemini: 'Google Gemini',
	grok: 'xAI Grok',
	nvidia: 'NVIDIA',
	openrouter: 'OpenRouter',
	custom: 'Custom OpenAI-compatible',
	bedrock: 'AWS Bedrock'
};

const CREDENTIAL_STORAGE_DESCRIPTION = process.platform === 'darwin'
	? 'macOS Keychain'
	: '~/.cleanslate/credentials.json with owner-only permissions';

function fieldsFor(provider: CliProvider): ISetupField[] {
	if (provider === 'cleanslate') {
		return [
			{ key: 'managedEmail', label: 'CleanSlate account email', placeholder: 'you@example.com' },
			{ key: 'managedPassword', label: 'CleanSlate account password', placeholder: 'sent securely; never stored', secret: true }
		];
	}
	if (provider === 'bedrock') {
		return [
			{ key: 'bedrockRegion', label: 'AWS region', placeholder: 'us-east-1' },
			{ key: 'bedrockProfile', label: 'AWS profile', placeholder: 'leave blank for default credential chain', optional: true },
			{ key: 'model', label: 'Bedrock model ID', placeholder: 'provider model ID' }
		];
	}
	if (provider === 'azureOpenAI') {
		return [
			{ key: 'azureEndpoint', label: 'Azure endpoint', placeholder: 'https://resource.openai.azure.com' },
			{ key: 'apiKey', label: 'Azure API key', placeholder: `stored in ${CREDENTIAL_STORAGE_DESCRIPTION}`, secret: true },
			{ key: 'model', label: 'Deployment name', placeholder: 'Azure deployment name' },
			{ key: 'azureApiVersion', label: 'API version', placeholder: 'leave blank for default', optional: true }
		];
	}
	if (provider === 'custom') {
		return [
			{ key: 'baseUrl', label: 'API base URL', placeholder: 'https://host.example/v1' },
			{ key: 'apiKey', label: 'API key', placeholder: 'optional', secret: true, optional: true },
			{ key: 'model', label: 'Model ID', placeholder: 'provider model ID' }
		];
	}
	return [
		{ key: 'apiKey', label: `${PROVIDER_LABELS[provider]} API key`, placeholder: `stored in ${CREDENTIAL_STORAGE_DESCRIPTION}`, secret: true },
		{ key: 'model', label: 'Model ID', placeholder: 'provider model ID' }
	];
}

export function CleanSlateSetupTui({ initialProvider, onComplete, onCancel }: {
	initialProvider: CliProvider;
	onComplete: (result: ICliSetupResult) => void;
	onCancel: () => void;
}) {
	const { exit } = useApp();
	const initialIndex = Math.max(0, SUPPORTED_PROVIDERS.indexOf(initialProvider));
	const [providerIndex, setProviderIndex] = useState(initialIndex);
	const [provider, setProvider] = useState<CliProvider | undefined>();
	const [fieldIndex, setFieldIndex] = useState(0);
	const [value, setValue] = useState('');
	const [values, setValues] = useState<Partial<ICliSetupResult>>({});
	const [error, setError] = useState<string>();

	const cancel = () => {
		onCancel();
		exit();
	};

	useInput((input, key) => {
		if (input === 'c' && key.ctrl) {
			cancel();
			return;
		}
		if (!provider) {
			if (key.upArrow) {
				setProviderIndex(index => Math.max(0, index - 1));
			} else if (key.downArrow) {
				setProviderIndex(index => Math.min(SUPPORTED_PROVIDERS.length - 1, index + 1));
			} else if (key.return) {
				setProvider(SUPPORTED_PROVIDERS[providerIndex]);
			} else if (key.escape) {
				cancel();
			}
		}
	});

	const submitField = (raw: string) => {
		if (!provider) {
			return;
		}
		const fields = fieldsFor(provider);
		const field = fields[fieldIndex];
		const normalized = raw.trim();
		if (!normalized && !field.optional) {
			setError(`${field.label} is required.`);
			return;
		}
		const nextValues = { ...values, [field.key]: normalized || undefined };
		setValues(nextValues);
		setValue('');
		setError(undefined);
		if (fieldIndex < fields.length - 1) {
			setFieldIndex(index => index + 1);
			return;
		}
		onComplete({
			provider,
			model: nextValues.model ? String(nextValues.model) : '',
			apiKey: nextValues.apiKey,
			managedEmail: nextValues.managedEmail,
			managedPassword: nextValues.managedPassword,
			baseUrl: nextValues.baseUrl,
			bedrockRegion: nextValues.bedrockRegion,
			bedrockProfile: nextValues.bedrockProfile,
			azureEndpoint: nextValues.azureEndpoint,
			azureApiVersion: nextValues.azureApiVersion
		});
		exit();
	};

	const activeField = provider ? fieldsFor(provider)[fieldIndex] : undefined;
	return (
		<Box flexDirection="column">
			<Box borderStyle="round" borderColor={COLORS.accent} paddingX={1} alignItems="center">
				<CleanSlateTerminalLogo />
				<Box flexDirection="column">
					<Text color={COLORS.accent} bold>CLEANSLATE</Text>
					<Text color={COLORS.muted}>first-run setup</Text>
				</Box>
			</Box>
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				<Text bold>Connect your model provider</Text>
				<Text color={COLORS.muted}>Your provider credential is stored in {CREDENTIAL_STORAGE_DESCRIPTION} and is never written to the session transcript.</Text>
				{!provider ? (
					<Box flexDirection="column" marginTop={1}>
						{SUPPORTED_PROVIDERS.map((candidate, index) => (
							<Text key={candidate} inverse={providerIndex === index}>
								{providerIndex === index ? '› ' : '  '}{PROVIDER_LABELS[candidate]}
							</Text>
						))}
						<Text color={COLORS.muted}>↑/↓ select · enter continue · esc cancel</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginTop={1}>
						<Text color={COLORS.success}>✓ {PROVIDER_LABELS[provider]}</Text>
						{fieldsFor(provider).slice(0, fieldIndex).map(field => (
							<Text key={field.key} color={COLORS.muted}>✓ {field.label}</Text>
						))}
						<Box marginTop={1}>
							<Text color={COLORS.cyan}>{activeField!.label}  </Text>
							<TextInput
								value={value}
								onChange={setValue}
								onSubmit={submitField}
								placeholder={activeField!.placeholder}
								mask={activeField!.secret ? '•' : undefined}
							/>
						</Box>
						{error && <Text color="red">{error}</Text>}
						<Text color={COLORS.muted}>enter continue · ctrl-c cancel</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
