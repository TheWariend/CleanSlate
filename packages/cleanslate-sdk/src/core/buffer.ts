/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Slate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replaces `vs/base/common/buffer`.
 *
 * The original is a cross-platform byte buffer with streaming, chunked readers
 * and browser fallbacks, and it pulls in `stream` and `lazy` for them. None of
 * that is used here, so this is a plain `Uint8Array` wrapper on `TextEncoder`
 * and `TextDecoder`, which both Node and a browser provide.
 *
 * The instance surface is not trimmed, though, and that is deliberate: a buffer
 * built here is handed to the editor's `IFileService.writeFile`, whose
 * parameter is the editor's own `VSBuffer`. TypeScript compares the two copies
 * structurally, so every member the editor's class exposes has to exist here or
 * the two stop being interchangeable at the host boundary. The read/write
 * integer accessors are part of that surface even though nothing here calls
 * them.
 */

let textDecoder: TextDecoder | null = null;
let textEncoder: TextEncoder | null = null;

export class VSBuffer {

	static alloc(byteLength: number): VSBuffer {
		return new VSBuffer(new Uint8Array(byteLength));
	}

	static wrap(actual: Uint8Array): VSBuffer {
		return new VSBuffer(actual);
	}

	static fromString(source: string): VSBuffer {
		if (!textEncoder) {
			textEncoder = new TextEncoder();
		}
		return new VSBuffer(textEncoder.encode(source));
	}

	static fromByteArray(source: number[]): VSBuffer {
		const result = VSBuffer.alloc(source.length);
		for (let i = 0, len = source.length; i < len; i++) {
			result.buffer[i] = source[i];
		}
		return result;
	}

	static concat(buffers: readonly VSBuffer[], totalLength?: number): VSBuffer {
		if (typeof totalLength === 'undefined') {
			totalLength = 0;
			for (let i = 0, len = buffers.length; i < len; i++) {
				totalLength += buffers[i].byteLength;
			}
		}

		const result = VSBuffer.alloc(totalLength);
		let offset = 0;
		for (let i = 0, len = buffers.length; i < len; i++) {
			const element = buffers[i];
			result.set(element, offset);
			offset += element.byteLength;
		}

		return result;
	}

	readonly buffer: Uint8Array;
	readonly byteLength: number;

	private constructor(buffer: Uint8Array) {
		this.buffer = buffer;
		this.byteLength = buffer.byteLength;
	}

	clone(): VSBuffer {
		const result = VSBuffer.alloc(this.byteLength);
		result.set(this);
		return result;
	}

	toString(): string {
		if (!textDecoder) {
			textDecoder = new TextDecoder(undefined, { ignoreBOM: true });
		}
		return textDecoder.decode(this.buffer);
	}

	slice(start?: number, end?: number): VSBuffer {
		// subarray, not slice: TypedArray#slice copies, and the original relies
		// on the view semantics.
		return new VSBuffer(this.buffer.subarray(start, end));
	}

	set(array: VSBuffer, offset?: number): void;
	set(array: Uint8Array, offset?: number): void;
	set(array: ArrayBuffer, offset?: number): void;
	set(array: ArrayBufferView, offset?: number): void;
	set(array: VSBuffer | Uint8Array | ArrayBuffer | ArrayBufferView, offset?: number): void;
	set(array: VSBuffer | Uint8Array | ArrayBuffer | ArrayBufferView, offset?: number): void {
		if (array instanceof VSBuffer) {
			this.buffer.set(array.buffer, offset);
		} else if (array instanceof Uint8Array) {
			this.buffer.set(array, offset);
		} else if (array instanceof ArrayBuffer) {
			this.buffer.set(new Uint8Array(array), offset);
		} else if (ArrayBuffer.isView(array)) {
			this.buffer.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
		} else {
			throw new Error(`Unknown argument 'array'`);
		}
	}

	readUInt32BE(offset: number): number {
		return (
			this.buffer[offset] * 2 ** 24
			+ this.buffer[offset + 1] * 2 ** 16
			+ this.buffer[offset + 2] * 2 ** 8
			+ this.buffer[offset + 3]
		);
	}

	writeUInt32BE(value: number, offset: number): void {
		this.buffer[offset + 3] = value;
		value = value >>> 8;
		this.buffer[offset + 2] = value;
		value = value >>> 8;
		this.buffer[offset + 1] = value;
		value = value >>> 8;
		this.buffer[offset] = value;
	}

	readUInt32LE(offset: number): number {
		return (
			this.buffer[offset]
			+ this.buffer[offset + 1] * 2 ** 8
			+ this.buffer[offset + 2] * 2 ** 16
			+ this.buffer[offset + 3] * 2 ** 24
		);
	}

	writeUInt32LE(value: number, offset: number): void {
		this.buffer[offset] = value & 0b11111111;
		value = value >>> 8;
		this.buffer[offset + 1] = value & 0b11111111;
		value = value >>> 8;
		this.buffer[offset + 2] = value & 0b11111111;
		value = value >>> 8;
		this.buffer[offset + 3] = value & 0b11111111;
	}

	readUInt8(offset: number): number {
		return this.buffer[offset];
	}

	writeUInt8(value: number, offset: number): void {
		this.buffer[offset] = value;
	}

	indexOf(subarray: VSBuffer | Uint8Array, offset = 0): number {
		const needle = subarray instanceof VSBuffer ? subarray.buffer : subarray;
		if (needle.length === 0) {
			return 0;
		}
		outer: for (let i = offset; i <= this.buffer.length - needle.length; i++) {
			for (let j = 0; j < needle.length; j++) {
				if (this.buffer[i + j] !== needle[j]) {
					continue outer;
				}
			}
			return i;
		}
		return -1;
	}

	equals(other: VSBuffer): boolean {
		if (this === other) {
			return true;
		}

		if (this.byteLength !== other.byteLength) {
			return false;
		}

		return this.buffer.every((value, index) => value === other.buffer[index]);
	}
}
