/*---------------------------------------------------------------------------------------------
 * Copyright (c) CleanSlate. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Normalizes tool schemas for each provider's accepted JSON-schema subset. */
export class CleanSlateProviderSchemaNormalizer {
    public normalizeJsonObjectSchema(schema: Record<string, any> | undefined, options?: { target?: 'openaiCompatible' | 'anthropic' | 'gemini' | 'bedrock'; model?: string }): Record<string, any> {
        if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
            return { type: 'object', properties: {} };
        }
        schema = this.applyProviderSchemaTransforms(schema, options);
        if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
            return {
                ...schema,
                type: 'object',
                properties: this.normalizeToolSchemaProperties(schema.properties)
            };
        }
        const properties = this.normalizeToolSchemaProperties(schema);
        return {
            type: 'object',
            properties,
            required: Object.keys(properties).filter(key => !this.isOptionalToolParameter(schema[key]))
        };
    }

    private applyProviderSchemaTransforms(schema: Record<string, any>, options?: { target?: 'openaiCompatible' | 'anthropic' | 'gemini' | 'bedrock'; model?: string }): Record<string, any> {
        const model = String(options?.model ?? '').toLowerCase();
        let transformed: any = schema;
        if (model.includes('kimi') || model.includes('moonshot')) {
            transformed = this.sanitizeMoonshotSchema(transformed);
        }
        if (options?.target === 'gemini' || model.includes('gemini')) {
            transformed = this.sanitizeGeminiSchema(transformed);
        }
        return transformed && typeof transformed === 'object' && !Array.isArray(transformed)
            ? transformed
            : schema;
    }

    private sanitizeMoonshotSchema(value: any): any {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.sanitizeMoonshotSchema(item));
        }
        if (typeof value.$ref === 'string') {
            return { $ref: value.$ref };
        }
        const result: any = {};
        for (const [key, child] of Object.entries(value)) {
            result[key] = this.sanitizeMoonshotSchema(child);
        }
        if (Array.isArray(result.items)) {
            result.items = result.items[0] ?? {};
        }
        return result;
    }

    private sanitizeGeminiSchema(value: any): any {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.sanitizeGeminiSchema(item));
        }

        const result: any = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === 'enum' && Array.isArray(child)) {
                result[key] = child.map(item => String(item));
                continue;
            }
            result[key] = typeof child === 'object' && child !== null
                ? this.sanitizeGeminiSchema(child)
                : child;
        }
        if (Array.isArray(result.enum) && (result.type === 'integer' || result.type === 'number')) {
            result.type = 'string';
        }

        if (result.type === 'object' && result.properties && Array.isArray(result.required)) {
            result.required = result.required.filter((field: any) => field in result.properties);
        }

        if (result.type === 'array' && !this.hasJsonSchemaCombiner(result)) {
            if (result.items == null) {
                result.items = {};
            }
            if (this.isPlainObject(result.items) && !this.hasJsonSchemaIntent(result.items)) {
                result.items.type = 'string';
            }
        }

        if (result.type && result.type !== 'object' && !this.hasJsonSchemaCombiner(result)) {
            delete result.properties;
            delete result.required;
        }

        return result;
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private hasJsonSchemaCombiner(value: unknown): boolean {
        return this.isPlainObject(value)
            && (Array.isArray(value.anyOf) || Array.isArray(value.oneOf) || Array.isArray(value.allOf));
    }

    private hasJsonSchemaIntent(value: unknown): boolean {
        if (!this.isPlainObject(value)) {
            return false;
        }
        if (this.hasJsonSchemaCombiner(value)) {
            return true;
        }
        return [
            'type',
            'properties',
            'items',
            'prefixItems',
            'enum',
            'const',
            '$ref',
            'additionalProperties',
            'patternProperties',
            'required',
            'not',
            'if',
            'then',
            'else'
        ].some(key => key in value);
    }

    private normalizeToolSchemaProperties(properties: Record<string, any>): Record<string, any> {
        const normalized: Record<string, any> = {};
        for (const [name, value] of Object.entries(properties)) {
            normalized[name] = this.normalizeToolSchemaProperty(value);
        }
        return normalized;
    }

    private normalizeToolSchemaProperty(value: any): Record<string, any> {
        if (typeof value === 'string') {
            return this.normalizeStringToolSchemaProperty(value);
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { type: 'string' };
        }
        if (typeof value.type === 'string' && value.type && value.type !== 'None') {
            return value;
        }
        return this.normalizeStringToolSchemaProperty(String(value.description ?? 'string'));
    }

    private normalizeStringToolSchemaProperty(value: string): Record<string, any> {
        const [rawType, ...descriptionParts] = value.split(' - ');
        const normalizedType = rawType.trim().toLowerCase();
        const description = descriptionParts.join(' - ').trim() || value;
        const type = normalizedType.includes('array')
            ? 'array'
            : normalizedType.includes('number') || normalizedType.includes('integer')
                ? 'number'
                : normalizedType.includes('boolean')
                    ? 'boolean'
                    : normalizedType.includes('object')
                        ? 'object'
                        : 'string';

        if (type === 'array') {
            return { type, description, items: { type: 'object' } };
        }
        if (type === 'object') {
            return { type, description, properties: {} };
        }
        return { type, description };
    }

    private isOptionalToolParameter(value: any): boolean {
        const description = typeof value === 'string'
            ? value
            : typeof value?.description === 'string'
                ? value.description
                : '';
        return /\boptional\b/i.test(description);
    }

}
