/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SUPPORTED_PROVIDERS = ['openai', 'azureOpenAI', 'anthropic', 'gemini', 'grok', 'nvidia', 'openrouter', 'custom', 'bedrock'] as const;
export type CliProvider = typeof SUPPORTED_PROVIDERS[number];

export interface ICliArguments {
	task?: string;
	cwd: string;
	provider: CliProvider;
	providerSpecified: boolean;
	model?: string;
	modelSpecified: boolean;
	apiKey?: string;
	baseUrl?: string;
	reasoningLevel: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
	reasoningSpecified: boolean;
	maxTurns?: number;
	bedrockRegion?: string;
	bedrockProfile?: string;
	azureEndpoint?: string;
	azureApiVersion?: string;
	tui?: boolean;
	resume: boolean;
	sessionId?: string;
	listSessions: boolean;
	setup: boolean;
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
	if (configured === 'azure' || configured === 'azureopenai') {
		return 'azureOpenAI';
	}
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
		providerSpecified: false,
		modelSpecified: false,
		reasoningLevel: 'low',
		reasoningSpecified: false,
		resume: false,
		listSessions: false,
		setup: false,
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
			case '--tui':
				result.tui = true;
				break;
			case '--no-tui':
				result.tui = false;
				break;
			case '--resume':
			case '-r':
				result.resume = true;
				break;
			case '--session':
				result.sessionId = valueAfter(argv, index, arg);
				result.resume = true;
				index++;
				break;
			case '--list-sessions':
				result.listSessions = true;
				break;
			case '--setup':
				result.setup = true;
				break;
			case '--cwd':
			case '-C':
				result.cwd = valueAfter(argv, index, arg);
				index++;
				break;
			case '--provider':
			case '-p': {
				const rawProvider = valueAfter(argv, index, arg);
				const provider = rawProvider.toLowerCase() === 'azure' || rawProvider.toLowerCase() === 'azureopenai'
					? 'azureOpenAI'
					: rawProvider.toLowerCase();
				if (!SUPPORTED_PROVIDERS.includes(provider as CliProvider)) {
					throw new Error(`Unsupported provider "${provider}". Expected one of: ${SUPPORTED_PROVIDERS.join(', ')}.`);
				}
				result.provider = provider as CliProvider;
				result.providerSpecified = true;
				index++;
				break;
			}
			case '--model':
			case '-m':
				result.model = valueAfter(argv, index, arg);
				result.modelSpecified = true;
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
				if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning)) {
					throw new Error('--reasoning must be one of: none, minimal, low, medium, high, xhigh, max.');
				}
				result.reasoningLevel = reasoning as ICliArguments['reasoningLevel'];
				result.reasoningSpecified = true;
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
			case '--aws-region':
				result.bedrockRegion = valueAfter(argv, index, arg);
				index++;
				break;
			case '--aws-profile':
				result.bedrockProfile = valueAfter(argv, index, arg);
				index++;
				break;
			case '--azure-endpoint':
				result.azureEndpoint = valueAfter(argv, index, arg);
				index++;
				break;
			case '--azure-api-version':
				result.azureApiVersion = valueAfter(argv, index, arg);
				index++;
				break;
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
	result.bedrockRegion ??= env['AWS_REGION'] || env['AWS_DEFAULT_REGION'];
	result.bedrockProfile ??= env['AWS_PROFILE'];
	result.azureEndpoint ??= env['AZURE_OPENAI_ENDPOINT'];
	result.azureApiVersion ??= env['AZURE_OPENAI_API_VERSION'];
	return result;
}

export function apiKeyFromEnvironment(provider: CliProvider, env: NodeJS.ProcessEnv): string | undefined {
	switch (provider) {
		case 'openai': return env['OPENAI_API_KEY'];
		case 'azureOpenAI': return env['AZURE_OPENAI_API_KEY'];
		case 'anthropic': return env['ANTHROPIC_API_KEY'];
		case 'gemini': return env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY'];
		case 'grok': return env['XAI_API_KEY'] || env['GROK_API_KEY'];
		case 'nvidia': return env['NVIDIA_API_KEY'];
		case 'openrouter': return env['OPENROUTER_API_KEY'];
		case 'custom': return env['CUSTOM_API_KEY'];
		case 'bedrock': return undefined;
	}
}

export const HELP_TEXT = `Usage: cleanslate [options] ["task"]

Open the CleanSlate terminal agent, or run one task non-interactively.

Options:
  -C, --cwd <path>          Workspace root (default: current directory)
  -p, --provider <name>     openai, azure, anthropic, gemini, grok, nvidia, openrouter, custom, bedrock
  -m, --model <id>          Provider model (or CLEANSLATE_MODEL)
      --api-key <key>       Provider API key (provider environment variables are supported)
      --base-url <url>      Override the provider base URL
      --reasoning <level>   none, minimal, low, medium, high, xhigh, max
      --max-turns <count>   Bound model turns
      --aws-region <id>     AWS region for Bedrock (or AWS_REGION)
      --aws-profile <name>  AWS profile for Bedrock
      --azure-endpoint <url> Azure OpenAI endpoint
      --azure-api-version <v> Azure OpenAI API version
      --tui                 Force the interactive terminal UI
      --no-tui              Stream one task without the terminal UI
  -r, --resume              Resume the latest workspace session
      --session <id>        Resume a specific session
      --list-sessions       List saved sessions for this workspace
      --setup               Re-run interactive provider setup
  -h, --help                Show help
  -v, --version             Show version

With a terminal attached, CleanSlate opens the TUI by default. In a pipe or
with --no-tui, a task is required.

Every shell command requires an explicit y/N approval. Non-interactive input
refuses commands by default. Ctrl-C cancels the active run.`;
