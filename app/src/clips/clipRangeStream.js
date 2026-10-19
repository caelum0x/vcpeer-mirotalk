'use strict';

const { Readable } = require('stream');
const { decryptChunk } = require('../transfers/cryptoStream');

/**
 * Decrypts and yields only the bytes inside [start, end] (inclusive) of a
 * clip's single video file, by reading only the chunks ("parts", see
 * storage/StorageInterface.js) that overlap the requested range and slicing
 * off the extra bytes at the two ends. This is what lets <video> seek/scrub
 * on clipRoutes.js's GET /:id/video without the server ever having to
 * decrypt — or hold in memory — the whole recording.
 *
 * @param {object} options
 * @param {import('../storage/StorageInterface')} options.storage
 * @param {string} options.key storage key for this clip (its id)
 * @param {string} options.fileId used to derive each part's IV (same as key, see cryptoStream.js)
 * @param {Buffer} options.keyBuf 32-byte clip encryption key
 * @param {number} options.chunkBytes the chunk size this clip was uploaded with (record.chunkBytes — never the live config, which may have changed since)
 * @param {number} options.start first byte to yield, inclusive
 * @param {number} options.end last byte to yield, inclusive
 * @param {Array<{ partNumber: number }>} options.parts all parts for this clip (any order)
 */
async function* iterateRangeParts({ storage, key, fileId, keyBuf, chunkBytes, start, end, parts }) {
    const byPartNumber = new Map(parts.map((p) => [p.partNumber, p]));
    const firstPart = Math.floor(start / chunkBytes) + 1;
    const lastPart = Math.floor(end / chunkBytes) + 1;

    for (let partNumber = firstPart; partNumber <= lastPart; partNumber++) {
        if (!byPartNumber.has(partNumber)) return; // missing part — caller already validated completeness before finalize

        // eslint-disable-next-line no-await-in-loop -- parts must be read/decrypted in order to slice the right bytes
        const partStream = await storage.getPartStream(key, partNumber);
        const buffered = [];
        // eslint-disable-next-line no-await-in-loop
        for await (const chunk of partStream) buffered.push(chunk);
        const ciphertext = Buffer.concat(buffered);
        const plaintext = decryptChunk(keyBuf, fileId, partNumber, ciphertext);

        const partStartByte = (partNumber - 1) * chunkBytes;
        const sliceStart = partNumber === firstPart ? start - partStartByte : 0;
        const sliceEnd = partNumber === lastPart ? end - partStartByte + 1 : plaintext.length;
        yield plaintext.subarray(Math.max(0, sliceStart), Math.min(plaintext.length, sliceEnd));
    }
}

/**
 * @param {object} options see iterateRangeParts
 * @returns {Readable}
 */
function createRangeReadStream(options) {
    return Readable.from(iterateRangeParts(options));
}

module.exports = { createRangeReadStream, iterateRangeParts };
