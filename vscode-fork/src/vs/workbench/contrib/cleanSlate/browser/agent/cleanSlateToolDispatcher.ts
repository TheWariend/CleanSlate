/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CleanSlateTool } from '@cleanslate/sdk/services/cleanSlateTools.js';

export interface ICleanSlatePreparedToolCall {
	readonly ok: true;
	readonly requestedToolName: string;
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly tool: CleanSlateTool;
}

export interface ICleanSlateRejectedToolCall {
	readonly ok: false;
	readonly requestedToolName: string;
	readonly toolName: string;
	readonly input: unknown;
	readonly error: {
		readonly success: false;
		readonly code: 'invalid_tool_arguments' | 'unknown_tool';
		readonly message: string;
		readonly requestedTool?: string;
		readonly suggestedTool?: string;
		readonly availableTools?: string[];
	};
}

export type CleanSlatePreparedToolCall = ICleanSlatePreparedToolCall | ICleanSlateRejectedToolCall;

/**
 * Strict native-tool boundary shared by every agent loop. A rejected call is
 * data returned to the model; it can never reach a tool implementation.
 */
export class CleanSlateToolDispatcher {
	private static readonly locatorFields = new Set([
		'path', 'file_path', 'paths', 'file', 'files', 'directory', 'pattern', 'query',
		'symbol', 'symbolName', 'symbolPath', 'name', 'referenceId', 'url'
	]);
	private static readonly aliases: Readonly<Record<string, string>> = {
		codebase_search: 'semantic_search',
		rag_search: 'semantic_search',
		workspace_search: 'search_workspace',
		search_files: 'search_workspace',
		grep: 'grep_search',
		readfile: 'read_file',
		readfilerange: 'read_file_range',
		apply_patch: 'apply_edit',
		edit_file: 'apply_edit',
		create_and_write_file: 'write_file'
	};

	constructor(private readonly getTools: () => readonly CleanSlateTool[]) { }

	public prepare(requestedToolName: string, input: unknown): CleanSlatePreparedToolCall {
		const tools = this.getTools();
		const normalizedName = this.normalizeToolName(requestedToolName);
		const alias = CleanSlateToolDispatcher.aliases[normalizedName.toLowerCase()];
		const toolName = alias && tools.some(candidate => candidate.name === alias)
			? alias
			: normalizedName;
		if (normalizedName.toLowerCase() === 'create_and_write_file'
			&& toolName === 'write_file'
			&& this.isPlainObject(input)
			&& typeof input.file_path !== 'string'
			&& typeof input.path === 'string') {
			const { path, ...rest } = input;
			input = { ...rest, file_path: path };
		}
		const tool = tools.find(candidate => candidate.name === toolName);
		if (!tool) {
			const suggestedTool = this.resolveUnknownToolSuggestion(toolName, tools);
			return {
				ok: false,
				requestedToolName,
				toolName,
				input,
				error: {
					success: false,
					code: 'unknown_tool',
					requestedTool: requestedToolName,
					suggestedTool,
					availableTools: tools.map(candidate => candidate.name),
					message: suggestedTool
						? `Tool "${requestedToolName}" is unavailable. Use "${suggestedTool}" instead.`
						: `Tool "${requestedToolName}" not found.`
				}
			};
		}

		const parseError = this.getProviderParseError(input);
		if (parseError) {
			return this.rejectArguments(requestedToolName, toolName, input, parseError);
		}
		if (!this.isPlainObject(input)) {
			return this.rejectArguments(requestedToolName, toolName, input, 'arguments must be a JSON object');
		}

		const debrisPath = this.findSerializedCallDebris(input);
		if (debrisPath) {
			return this.rejectArguments(
				requestedToolName,
				toolName,
				input,
				`serialized tool-call debris was found in ${debrisPath}`
			);
		}

		const schema = this.normalizeObjectSchema(tool.parametersSchema);
		const schemaError = this.validateValue(input, schema, '$');
		if (schemaError) {
			return this.rejectArguments(requestedToolName, toolName, input, schemaError);
		}

		return { ok: true, requestedToolName, toolName, input, tool };
	}

	public normalizeToolName(toolName: string): string {
		const trimmed = typeof toolName === 'string' ? toolName.trim() : '';
		return trimmed.startsWith('functions.') ? trimmed.slice('functions.'.length) : trimmed;
	}

	private rejectArguments(requestedToolName: string, toolName: string, input: unknown, detail: string): ICleanSlateRejectedToolCall {
		return {
			ok: false,
			requestedToolName,
			toolName,
			input,
			error: {
				success: false,
				code: 'invalid_tool_arguments',
				message: `failed to parse function arguments for "${toolName}": ${detail}. Return one valid native tool call and retry.`
			}
		};
	}

	private getProviderParseError(input: unknown): string | undefined {
		if (!this.isPlainObject(input)) {
			return undefined;
		}
		const marker = input.__cleanSlateArgumentsParseError;
		if (typeof marker === 'string' && marker.trim()) {
			return marker.trim();
		}
		return undefined;
	}

	private findSerializedCallDebris(value: unknown, path: string = '$', fieldName?: string): string | undefined {
		if (typeof value === 'string') {
			return this.isLocatorField(fieldName) && this.looksLikeSerializedCallDebris(value) ? path : undefined;
		}
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index++) {
				const found = this.findSerializedCallDebris(value[index], `${path}[${index}]`, fieldName);
				if (found) {
					return found;
				}
			}
			return undefined;
		}
		if (this.isPlainObject(value)) {
			for (const [key, child] of Object.entries(value)) {
				const found = this.findSerializedCallDebris(child, `${path}.${key}`, key);
				if (found) {
					return found;
				}
			}
		}
		return undefined;
	}

	private isLocatorField(fieldName: string | undefined): boolean {
		return !!fieldName && CleanSlateToolDispatcher.locatorFields.has(fieldName);
	}

	private looksLikeSerializedCallDebris(value: string): boolean {
		return /(?:^|[\s\]}])to=(?:multi_tool_use\.parallel|functions\.|[a-z0-9_.-]+)[\s\S]*(?:code|json|arguments)/i.test(value)
			|| /code execution failed:\s*invalid json/i.test(value)
			|| /failed to parse function arguments/i.test(value)
			|| /(?:multi_tool_use\.parallel|recipient=functions\.)[\s\S]*(?:\{\s*"|json)/i.test(value);
	}

	private normalizeObjectSchema(schema: Record<string, any> | undefined): Record<string, any> {
		if (!this.isPlainObject(schema) || Object.keys(schema).length === 0) {
			return { type: 'object', properties: {} };
		}
		if (schema.type === 'object' && this.isPlainObject(schema.properties)) {
			return schema;
		}

		const properties: Record<string, any> = {};
		const required: string[] = [];
		for (const [name, value] of Object.entries(schema)) {
			properties[name] = this.normalizeShorthandProperty(value);
			if (!this.isOptionalProperty(value)) {
				required.push(name);
			}
		}
		return { type: 'object', properties, required };
	}

	private normalizeShorthandProperty(value: unknown): Record<string, any> {
		if (this.isPlainObject(value)) {
			return value;
		}
		const description = typeof value === 'string' ? value : 'string';
		const typeLabel = description.split(' - ')[0].trim().toLowerCase();
		const type = typeLabel.includes('array')
			? 'array'
			: typeLabel.includes('number') || typeLabel.includes('integer')
				? 'number'
				: typeLabel.includes('boolean')
					? 'boolean'
					: typeLabel.includes('object')
						? 'object'
						: 'string';
		return { type, description };
	}

	private isOptionalProperty(value: unknown): boolean {
		const description = typeof value === 'string'
			? value
			: this.isPlainObject(value) && typeof value.description === 'string'
				? value.description
				: '';
		return /\b(?:optional|alias|default)\b/i.test(description);
	}

	private validateValue(value: unknown, schema: any, path: string): string | undefined {
		if (!schema || typeof schema !== 'object') {
			return undefined;
		}
		if (Array.isArray(schema.anyOf)) {
			const valid = schema.anyOf.some((candidate: any) => !this.validateValue(value, candidate, path));
			return valid ? undefined : `${path} does not match any allowed schema`;
		}
		if (Array.isArray(schema.oneOf)) {
			const matches = schema.oneOf.filter((candidate: any) => !this.validateValue(value, candidate, path)).length;
			return matches === 1 ? undefined : `${path} must match exactly one allowed schema`;
		}
		if (Array.isArray(schema.enum) && !schema.enum.some((candidate: unknown) => candidate === value)) {
			return `${path} must be one of ${schema.enum.map((candidate: unknown) => JSON.stringify(candidate)).join(', ')}`;
		}

		switch (schema.type) {
			case undefined:
				return undefined;
			case 'object': {
				if (!this.isPlainObject(value)) {
					return `${path} must be an object`;
				}
				for (const required of Array.isArray(schema.required) ? schema.required : []) {
					if (!(required in value)) {
						return `${path}.${required} is required`;
					}
				}
				if (this.isPlainObject(schema.properties)) {
					for (const [name, propertySchema] of Object.entries(schema.properties)) {
						if (!(name in value)) {
							continue;
						}
						const error = this.validateValue(value[name], propertySchema, `${path}.${name}`);
						if (error) {
							return error;
						}
					}
				}
				return undefined;
			}
			case 'array': {
				if (!Array.isArray(value)) {
					return `${path} must be an array`;
				}
				if (schema.items) {
					for (let index = 0; index < value.length; index++) {
						const error = this.validateValue(value[index], schema.items, `${path}[${index}]`);
						if (error) {
							return error;
						}
					}
				}
				return undefined;
			}
			case 'string':
				return typeof value === 'string' ? undefined : `${path} must be a string`;
			case 'number':
			case 'integer':
				return typeof value === 'number' && Number.isFinite(value) ? undefined : `${path} must be a number`;
			case 'boolean':
				return typeof value === 'boolean' ? undefined : `${path} must be a boolean`;
			case 'null':
				return value === null ? undefined : `${path} must be null`;
			default:
				return undefined;
		}
	}

	private resolveUnknownToolSuggestion(requestedToolName: string, tools: readonly CleanSlateTool[]): string | undefined {
		const normalized = requestedToolName.toLowerCase();
		const aliasMatch = CleanSlateToolDispatcher.aliases[normalized];
		if (aliasMatch && tools.some(tool => tool.name === aliasMatch)) {
			return aliasMatch;
		}
		return tools.map(tool => tool.name).find(name => normalized.endsWith(name) || name.endsWith(normalized));
	}

	private isPlainObject(value: unknown): value is Record<string, any> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}
}
