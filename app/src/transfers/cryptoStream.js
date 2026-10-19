'use strict';

const crypto = require('crypto');

/**
 * Per-chunk AES-256-GCM encryption for VCPeer Send's "Send a link" mode.
 *
 * This is encryption AT REST, not end-to-end: the server generates and holds
 * `encKey` (see transferStore.js — stored alongside the transfer's metadata),
 * so it can always decrypt to build zip downloads and image/video/PDF
 * previews. Plaintext is never written to storage, and the key never leaves
 * the server — but the server itself can read the files, unlike the live
 * P2P "Send now" mode, which never touches the server at all. State this
 * honestly in the UI/FAQ.
 *
 * Each uploaded chunk ("part", see storage/StorageInterface.js) is encrypted
 * independently with a nonce *deterministically derived* from
 * (key, fileId, partNumber), so nothing besides the ciphertext itself needs
 * to be persisted to reproduce the right IV on decrypt.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/** @returns {Buffer} a fresh 256-bit key for a new transfer */
function generateTransferKey() {
    return crypto.randomBytes(32);
}

function deriveIv(key, fileId, partNumber) {
    return crypto
        .createHash('sha256')
        .update(key)
        .update(':')
        .update(String(fileId))
        .update(':')
        .update(String(partNumber))
        .digest()
        .subarray(0, IV_BYTES);
}

/**
 * @param {Buffer} key 32-byte transfer key
 * @param {string|number} fileId
 * @param {number} partNumber 1-based chunk index
 * @param {Buffer} plaintext
 * @returns {Buffer} ciphertext with the 16-byte GCM auth tag appended
 */
function encryptChunk(key, fileId, partNumber, plaintext) {
    const iv = deriveIv(key, fileId, partNumber);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

/**
 * @param {Buffer} key 32-byte transfer key
 * @param {string|number} fileId
 * @param {number} partNumber 1-based chunk index
 * @param {Buffer} ciphertextWithTag output of encryptChunk
 * @returns {Buffer} plaintext
 * @throws if the auth tag doesn't match (corrupted/tampered ciphertext)
 */
function decryptChunk(key, fileId, partNumber, ciphertextWithTag) {
    if (ciphertextWithTag.length < AUTH_TAG_BYTES) {
        throw new Error('ciphertext too short to contain an auth tag');
    }
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_BYTES);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_BYTES);
    const iv = deriveIv(key, fileId, partNumber);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
    ALGO,
    IV_BYTES,
    AUTH_TAG_BYTES,
    generateTransferKey,
    encryptChunk,
    decryptChunk,
};
