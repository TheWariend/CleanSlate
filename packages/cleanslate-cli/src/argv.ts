/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'grok', 'nvidia', 'openrouter', 'custom'] as const;
export type CliProvider = typeof SUPPORTED_PROVIDERS[number];

export interface ICliArguments {
	task?: string;
	cwd: string;
	provider: CliProvider;
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	reasoningLevel: 'none' | 'low' | 'medium' | 'high';
	maxTurns?: number;
	help: boolean;
	version: boolean;
}

function valueAfter(argv: string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith('-')) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function inferredProvider(env: NodeJS.ProcessEnv): CliProvider {
	const configured = env['CLEANSLATE_PROVIDER']?.trim().toLowerCase();
	if (configured && SUPPORTED_PROVIDERS.includes(configured as CliProvider)) {
		return configured as CliProvider;
	}
	if (env['ANTHROPIC_API_KEY'] && !env['OPENAI_API_KEY']) {
		return 'anthropic';
	}
	return 'openai';
}

export function parseArguments(argv: string[], env: NodeJS.ProcessEnv = process.env): ICliArguments {
	const positionals: string[] = [];
	const result: ICliArguments = {
		cwd: process.cwd(),
		provider: inferredProvider(env),
		reasoningLevel: 'low',
		help: false,
		version: false
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		switch (arg) {
			case '--help':
			case '-h':
				result.help = true;
				break;
			case '--version':
			case '-v':
				result.version = true;
				break;
			case '--cwd':
			case '-C':
				result.cwd = valueAfter(argv, index, arg);
				index++;
				break;
			case '--provider':
			case '-p': {
				const provider = valueAfter(argv, index, arg).toLowerCase();
				if (!SUPPORTED_PROVIDERS.includes(provider as CliProvider)) {
					throw new Error(`Unsupported provider "${provider}". Expected one of: ${SUPPORTED_PROVIDERS.join(', ')}.`);
				}
				result.provider = provider as CliProvider;
				index++;
				break;
			}
			case '--model':
			case '-m':
				result.model = valueAfter(argv, index, arg);
				index++;
				break;
			case '--api-key':
				result.apiKey = valueAfter(argv, index, arg);
				index++;
				break;
			case '--base-url':
				result.baseUrl = valueAfter(argv, index, arg);
				index++;
				break;
			case '--reasoning': {
				const reasoning = valueAfter(argv, index, arg);
				if (!['none', 'low', 'medium', 'high'].includes(reasoning)) {
					throw new Error('--reasoning must be one of: none, low, medium, high.');
				}
				result.reasoningLevel = reasoning as ICliArguments['reasoningLevel'];
				index++;
				break;
			}
			case '--max-turns': {
				const value = Number(valueAfter(argv, index, arg));
				if (!Number.isSafeInteger(value) || value <= 0) {
					throw new Error('--max-turns must be a positive integer.');
				}
				result.maxTurns = value;
				index++;
				break;
			}
			case '--':
				positionals.push(...argv.slice(index + 1));
				index = argv.length;
				break;
			default:
				if (arg.startsWith('-')) {
					throw new Error(`Unknown option: ${arg}`);
				}
				positionals.push(arg);
		}
	}

	result.task = positionals.join(' ').trim() || undefined;
	result.model ??= env['CLEANSLATE_MODEL'] || env[`${result.provider.toUpperCase()}_MODEL`];
	result.apiKey ??= apiKeyFromEnvironment(result.provider, env);
	result.baseUrl ??= env['CLEANSLATE_BASE_URL'] || env[`${result.provider.toUpperCase()}_BASE_URL`];
	return result;
}

export function apiKeyFromEnvironment(provider: CliProvider, env: NodeJS.ProcessEnv): string | undefined {
	switch (provider) {
		case 'openai': return env['OPENAI_API_KEY'];
		case 'anthropic': return env['ANTHROPIC_API_KEY'];
		case 'grok': return env['XAI_API_KEY'] || env['GROK_API_KEY'];
		case 'nvidia': return env['NVIDIA_API_KEY'];
		case 'openrouter': return env['OPENROUTER_API_KEY'];
		case 'custom': return env['CUSTOM_API_KEY'];
	}
}

export const HELP_TEXT = `Usage: cleanslate [options] "task"

Run the CleanSlate agent against a real repository.

Options:
  -C, --cwd <path>          Workspace root (default: current directory)
  -p, --provider <name>     openai, anthropic, grok, nvidia, openrouter, custom
  -m, --model <id>          Provider model (or CLEANSLATE_MODEL)
      --api-key <key>       Provider API key (provider environment variables are supported)
      --base-url <url>      Override the provider base URL
      --reasoning <level>   none, low, medium, high (default: low)
      --max-turns <count>   Bound model turns
  -h, --help                Show help
  -v, --version             Show version

Every shell command requires an explicit y/N approval. Non-interactive input
refuses commands by default. Ctrl-C cancels the active run.`;
