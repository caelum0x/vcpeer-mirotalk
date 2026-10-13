'use strict';

import { CHUNK_SIZE } from './constants.js';

/**
 * Splits a Blob/File into ordered chunks without ever holding the whole file in
 * memory — each chunk is only read from disk (or the OS page cache) when it's
 * about to be sent, and is eligible for GC right after.
 *
 * Works with any Blob-like object exposing `.size`, `.slice()` and `.arrayBuffer()`
 * (the browser's File/Blob, or Node's built-in Blob in tests).
 */

/**
 * @param {number} totalBytes
 * @param {number} [chunkSize]
 * @returns {number} number of chunks `totalBytes` splits into
 */
export function countChunks(totalBytes, chunkSize = CHUNK_SIZE) {
    if (!Number.isFinite(totalBytes) || totalBytes < 0) {
        throw new RangeError('totalBytes must be a non-negative finite number');
    }
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
        throw new RangeError('chunkSize must be a positive finite number');
    }
    if (totalBytes === 0) return 0;
    return Math.ceil(totalBytes / chunkSize);
}

/**
 * Async generator yielding `ArrayBuffer` slices of `blob`, in order, until the
 * whole blob has been read.
 * @param {Blob} blob
 * @param {number} [chunkSize]
 * @returns {AsyncGenerator<ArrayBuffer>}
 */
export async function* iterateChunks(blob, chunkSize = CHUNK_SIZE) {
    if (!blob || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') {
        throw new TypeError('blob must be a Blob-like object (slice() + arrayBuffer())');
    }
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
        throw new RangeError('chunkSize must be a positive finite number');
    }

    const total = blob.size;
    let offset = 0;
    while (offset < total) {
        const end = Math.min(offset + chunkSize, total);
        const slice = blob.slice(offset, end);
        // eslint-disable-next-line no-await-in-loop -- chunks must be read and sent in order
        yield await slice.arrayBuffer();
        offset = end;
    }
}
