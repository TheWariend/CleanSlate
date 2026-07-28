/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replaces `vs/base/common/buffer`.
 *
 * The original is a cross-platform byte buffer with streaming, chunked readers
 * and browser fallbacks, and it pulls in `stream` and `lazy` for them. The
 * runtime uses five members — `fromString`, `wrap`, `toString`, `byteLength`
 * and `buffer` — so this wraps Node's `Buffer` directly.
 *
 * `Buffer` is a `Uint8Array` subclass, so instances remain valid wherever a
 * `Uint8Array` is expected.
 */
export class VSBuffer {

	static fromString(source: string): VSBuffer {
		return new VSBuffer(Buffer.from(source, 'utf8'));
	}

	static wrap(actual: Uint8Array): VSBuffer {
		return new VSBuffer(actual);
	}

	static alloc(byteLength: number): VSBuffer {
		return new VSBuffer(Buffer.allocUnsafe(byteLength));
	}

	static concat(buffers: readonly VSBuffer[]): VSBuffer {
		return new VSBuffer(Buffer.concat(buffers.map(b => b.buffer)));
	}

	readonly byteLength: number;

	private constructor(readonly buffer: Uint8Array) {
		this.byteLength = buffer.byteLength;
	}

	toString(): string {
		return Buffer.from(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).toString('utf8');
	}

	slice(start?: number, end?: number): VSBuffer {
		return new VSBuffer(this.buffer.subarray(start, end));
	}
}
