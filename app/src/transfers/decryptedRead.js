'use strict';

const { Readable } = require('stream');
const { decryptChunk } = require('./cryptoStream');

/**
 * @param {import('../storage/StorageInterface')} storage
 * @param {string} key `<transferId>/<fileId>`
 * @param {string} fileId
 * @param {Buffer} keyBuf 32-byte transfer encryption key
 * @param {Array<{ partNumber: number }>} parts ascending order
 */
async function* iterateDecryptedParts(storage, key, fileId, keyBuf, parts) {
    for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop -- parts must be read/decrypted in order
        const partStream = await storage.getPartStream(key, part.partNumber);
        const chunks = [];
        // eslint-disable-next-line no-await-in-loop
        for await (const chunk of partStream) chunks.push(chunk);
        const ciphertext = Buffer.concat(chunks);
        yield decryptChunk(keyBuf, fileId, part.partNumber, ciphertext);
    }
}

/**
 * A Readable stream of plaintext for one file, decrypting one part (chunk) at
 * a time so memory use stays bounded to a single chunk size regardless of
 * total file size.
 * @param {object} options
 * @param {import('../storage/StorageInterface')} options.storage
 * @param {string} options.key
 * @param {string} options.fileId
 * @param {Buffer} options.keyBuf
 * @param {Array<{ partNumber: number }>} options.parts
 * @returns {Readable}
 */
function createDecryptedReadStream({ storage, key, fileId, keyBuf, parts }) {
    return Readable.from(iterateDecryptedParts(storage, key, fileId, keyBuf, parts));
}

module.exports = { createDecryptedReadStream, iterateDecryptedParts };
