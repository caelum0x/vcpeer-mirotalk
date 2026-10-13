'use strict';

/**
 * Reassembles an ordered stream of binary chunks back into a file.
 *
 * Used by the Blob-fallback receive path (when the File System Access API is
 * unavailable). Chunks are kept as an array of ArrayBuffers and only joined
 * into a single Blob on demand via `toBlob()` — so memory use during receive
 * is "sum of chunks held", not "N copies of the growing file".
 */
export class ChunkReassembler {
    /**
     * @param {number} expectedSize total bytes this file should have, from the sender's manifest
     */
    constructor(expectedSize) {
        if (!Number.isFinite(expectedSize) || expectedSize < 0) {
            throw new RangeError('expectedSize must be a non-negative finite number');
        }
        this.expectedSize = expectedSize;
        this.received = 0;
        /** @type {ArrayBuffer[]} */
        this.chunks = [];
    }

    /**
     * @param {ArrayBuffer|ArrayBufferView} chunk
     * @returns {number} total bytes received so far
     */
    push(chunk) {
        const buf = ArrayBuffer.isView(chunk)
            ? chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
            : chunk;
        if (!(buf instanceof ArrayBuffer)) {
            throw new TypeError('chunk must be an ArrayBuffer or a typed array view');
        }
        this.received += buf.byteLength;
        if (this.received > this.expectedSize) {
            throw new RangeError(`received ${this.received} bytes, which exceeds the expected ${this.expectedSize}`);
        }
        this.chunks.push(buf);
        return this.received;
    }

    /** @returns {number} 0..1 */
    get progress() {
        if (this.expectedSize === 0) return 1;
        return this.received / this.expectedSize;
    }

    /** @returns {boolean} true once every expected byte has been pushed */
    isComplete() {
        return this.received === this.expectedSize;
    }

    /**
     * @param {string} [mimeType]
     * @returns {Blob}
     */
    toBlob(mimeType = 'application/octet-stream') {
        return new Blob(this.chunks, { type: mimeType });
    }

    /** Release held chunks (e.g. after writing to disk or aborting). */
    clear() {
        this.chunks = [];
    }
}
