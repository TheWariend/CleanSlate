/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { ICleanSlateLocalEmbeddingOptions, ICleanSlateLocalEmbeddingResponse } from '../../common/core/cleanSlateAI.js';
import type { CleanSlateLocalEmbeddingRequest, CleanSlateLocalEmbeddingResponseMessage } from './cleanSlateLocalEmbeddingProtocol.js';

type OnnxRuntime = typeof import('onnxruntime-node');

interface ITokenizedText {
	inputIds: number[];
	attentionMask: number[];
	tokenTypeIds: number[];
}

interface ILoadedEmbeddingModel {
	ort: OnnxRuntime;
	session: any;
	vocab: Map<string, number>;
}

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';
const DEFAULT_MAX_TOKENS = 512;
const models = new Map<string, Promise<ILoadedEmbeddingModel>>();

function send(message: CleanSlateLocalEmbeddingResponseMessage): void {
	try {
		process.stdout.write(`${JSON.stringify(message)}\n`);
	} catch (error) {
		process.stderr.write(`[CleanSlateLocalEmbeddingWorker] Failed to write response: ${error instanceof Error ? error.message : String(error)}\n`);
	}
}

function sendError(id: number, error: unknown): void {
	send({
		id,
		type: 'error',
		error: error instanceof Error ? error.message : String(error)
	});
}

async function handleRequest(request: CleanSlateLocalEmbeddingRequest): Promise<void> {
	if (request.type === 'shutdown') {
		send({ id: request.id, type: 'shutdownAck' });
		process.exit(0);
	}

	try {
		const result = await embed(request.options, request.appRoot);
		send({ id: request.id, type: 'embedResult', result });
	} catch (error) {
		sendError(request.id, error);
	}
}

async function embed(options: ICleanSlateLocalEmbeddingOptions, appRoot: string): Promise<ICleanSlateLocalEmbeddingResponse> {
	const modelName = normalizeModelName(options.model);
	const texts = options.texts.filter((text: unknown) => typeof text === 'string');
	if (texts.length !== options.texts.length) {
		throw new Error('Local embeddings require every input to be text.');
	}
	if (texts.length === 0) {
		return { model: modelName, dimensions: 0, embeddings: [] };
	}

	const model = await loadModel(modelName, appRoot);
	const maxTokens = Math.max(8, Math.min(options.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS));
	const tokenized = texts.map((text: string) => tokenize(text, model.vocab, maxTokens));
	const seqLength = Math.max(...tokenized.map(item => item.inputIds.length));
	const batchSize = tokenized.length;

	const inputIds = new BigInt64Array(batchSize * seqLength);
	const attentionMask = new BigInt64Array(batchSize * seqLength);
	const tokenTypeIds = new BigInt64Array(batchSize * seqLength);

	for (let batch = 0; batch < batchSize; batch++) {
		const item = tokenized[batch];
		for (let offset = 0; offset < seqLength; offset++) {
			const index = batch * seqLength + offset;
			inputIds[index] = BigInt(item.inputIds[offset] ?? 0);
			attentionMask[index] = BigInt(item.attentionMask[offset] ?? 0);
			tokenTypeIds[index] = BigInt(item.tokenTypeIds[offset] ?? 0);
		}
	}

	const feeds: Record<string, any> = {
		input_ids: new model.ort.Tensor('int64', inputIds, [batchSize, seqLength]),
		attention_mask: new model.ort.Tensor('int64', attentionMask, [batchSize, seqLength]),
		token_type_ids: new model.ort.Tensor('int64', tokenTypeIds, [batchSize, seqLength])
	};

	const output = await model.session.run(feeds);
	const embeddings = poolOutput(output, model.session.outputNames, tokenized);
	return {
		model: modelName,
		dimensions: embeddings[0]?.length ?? 0,
		embeddings
	};
}

function normalizeModelName(model: string | undefined): string {
	const normalized = (model || DEFAULT_MODEL).trim();
	if (normalized !== DEFAULT_MODEL) {
		throw new Error(`Unsupported local embedding model "${normalized}". Bundled default is ${DEFAULT_MODEL}.`);
	}
	return normalized;
}

function loadModel(model: string, appRoot: string): Promise<ILoadedEmbeddingModel> {
	let pending = models.get(model);
	if (!pending) {
		pending = doLoadModel(model, appRoot);
		models.set(model, pending);
	}
	return pending;
}

async function doLoadModel(model: string, appRoot: string): Promise<ILoadedEmbeddingModel> {
	const root = path.join(appRoot, 'resources', 'cleanslate', 'models', ...model.split('/'));
	const vocabPath = path.join(root, 'vocab.txt');
	const modelPath = path.join(root, 'onnx', 'model_quantized.onnx');

	if (!fs.existsSync(vocabPath) || !fs.existsSync(modelPath)) {
		throw new Error(`CleanSlate local embedding model is missing at ${root}.`);
	}

	const [ort, vocabText] = await Promise.all([
		import('onnxruntime-node'),
		fs.promises.readFile(vocabPath, 'utf8')
	]);

	const vocab = new Map<string, number>();
	for (const [index, token] of vocabText.split(/\r?\n/).entries()) {
		if (token) {
			vocab.set(token, index);
		}
	}

	const session = await ort.InferenceSession.create(modelPath, {
		executionProviders: ['cpu']
	});
	process.stderr.write(`[CleanSlateLocalEmbeddingWorker] loaded ${model} from ${root}\n`);
	return { ort, session, vocab };
}

function tokenize(text: string, vocab: Map<string, number>, maxTokens: number): ITokenizedText {
	const clsId = tokenId(vocab, '[CLS]');
	const sepId = tokenId(vocab, '[SEP]');
	const unkId = tokenId(vocab, '[UNK]');
	const tokens: number[] = [clsId];
	const normalized = text.normalize('NFKC').toLowerCase();

	for (const token of normalized.match(/[a-z0-9]+|[^\sA-Za-z0-9]/g) ?? []) {
		if (tokens.length >= maxTokens - 1) {
			break;
		}
		for (const pieceId of wordPiece(token, vocab, unkId)) {
			if (tokens.length >= maxTokens - 1) {
				break;
			}
			tokens.push(pieceId);
		}
	}

	tokens.push(sepId);
	return {
		inputIds: tokens,
		attentionMask: tokens.map(() => 1),
		tokenTypeIds: tokens.map(() => 0)
	};
}

function wordPiece(token: string, vocab: Map<string, number>, unkId: number): number[] {
	if (vocab.has(token)) {
		return [tokenId(vocab, token)];
	}
	const pieces: number[] = [];
	let start = 0;
	while (start < token.length) {
		let end = token.length;
		let match: string | undefined;
		while (start < end) {
			const candidate = `${start > 0 ? '##' : ''}${token.slice(start, end)}`;
			if (vocab.has(candidate)) {
				match = candidate;
				break;
			}
			end--;
		}
		if (!match) {
			return [unkId];
		}
		pieces.push(tokenId(vocab, match));
		start = end;
	}
	return pieces;
}

function tokenId(vocab: Map<string, number>, token: string): number {
	const id = vocab.get(token);
	if (id === undefined) {
		throw new Error(`CleanSlate local embedding vocabulary is missing ${token}.`);
	}
	return id;
}

function poolOutput(output: Record<string, any>, outputNames: readonly string[], tokenized: readonly ITokenizedText[]): number[][] {
	const tensor = output.last_hidden_state ?? output.sentence_embedding ?? output[outputNames[0]];
	if (!tensor) {
		throw new Error('CleanSlate local embedding model returned no tensor output.');
	}

	const data = Array.from(tensor.data as Float32Array);
	if (tensor.dims.length === 2) {
		const [batch, dimensions] = tensor.dims;
		const embeddings: number[][] = [];
		for (let row = 0; row < batch; row++) {
			embeddings.push(normalize(data.slice(row * dimensions, (row + 1) * dimensions)));
		}
		return embeddings;
	}

	if (tensor.dims.length !== 3) {
		throw new Error(`Unsupported CleanSlate local embedding output shape: ${tensor.dims.join('x')}.`);
	}

	const [batch, seqLength, dimensions] = tensor.dims;
	const embeddings: number[][] = [];
	for (let row = 0; row < batch; row++) {
		const pooled = new Array<number>(dimensions).fill(0);
		let weight = 0;
		const mask = tokenized[row].attentionMask;
		for (let token = 0; token < seqLength; token++) {
			if (!mask[token]) {
				continue;
			}
			weight++;
			const base = (row * seqLength * dimensions) + (token * dimensions);
			for (let dim = 0; dim < dimensions; dim++) {
				pooled[dim] += data[base + dim];
			}
		}
		if (weight > 0) {
			for (let dim = 0; dim < dimensions; dim++) {
				pooled[dim] /= weight;
			}
		}
		embeddings.push(normalize(pooled));
	}
	return embeddings;
}

function normalize(vector: number[]): number[] {
	let magnitude = 0;
	for (const value of vector) {
		magnitude += value * value;
	}
	if (magnitude === 0) {
		return vector;
	}
	const scale = 1 / Math.sqrt(magnitude);
	return vector.map(value => value * scale);
}

const reader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity
});

reader.on('line', line => {
	const trimmed = line.trim();
	if (!trimmed) {
		return;
	}
	let request: CleanSlateLocalEmbeddingRequest;
	try {
		request = JSON.parse(trimmed);
	} catch (error) {
		process.stderr.write(`[CleanSlateLocalEmbeddingWorker] Invalid request JSON: ${error instanceof Error ? error.message : String(error)}\n`);
		return;
	}
	void handleRequest(request);
});

const shutdown = () => process.exit(0);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.once('disconnect', shutdown);
