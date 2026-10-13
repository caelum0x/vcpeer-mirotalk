'use strict';

/**
 * Storage interface contract for VCPeer Send's "Send a link" mode.
 *
 * Both `LocalDiskStorage` (default, SEND_LINK_STORAGE_DRIVER=local) and
 * `R2Storage` (SEND_LINK_STORAGE_DRIVER=r2, Cloudflare R2 / any S3-compatible
 * bucket) implement this duck-typed interface so `transferRoutes.js` never
 * branches on which backend is active.
 *
 * Every object stored through this interface is ciphertext — encryption
 * happens in `cryptoStream.js` before a buffer reaches `putPart`, and
 * decryption happens after `getPartStream` reads come back. Nothing in this
 * interface ever sees plaintext.
 *
 * Files are modeled as an ordered set of immutable "parts" (one per uploaded
 * chunk — see public/js/send/transfer-upload.js), addressed by
 * `key = "<transferId>/<fileId>"` and a 1-based `partNumber`. There is no
 * separate "finalize into one blob" step: a part, once written, is the unit
 * of storage forever (concatenating would lose the per-part GCM boundaries
 * each chunk's encryption depends on). Resuming a stalled upload is just
 * `listParts(key)` minus the part numbers the client already sent.
 *
 * Methods every implementation must provide:
 *
 *   putPart(key, partNumber, buffer): Promise<{ size: number }>
 *   listParts(key): Promise<Array<{ partNumber: number, size: number }>>  (sorted ascending)
 *   getPartStream(key, partNumber): Promise<Readable>
 *   deleteAll(key): Promise<void>   -- removes every part under this key
 *   totalSize(key): Promise<number> -- sum of all parts' sizes, 0 if none
 *   exists(key): Promise<boolean>
 */

/**
 * Throws if `storage` is missing any required method — used by factory
 * selection and by tests that want a fast, readable failure instead of a
 * TypeError three calls deep.
 * @param {object} storage
 */
function assertImplementsStorageInterface(storage) {
    const required = ['putPart', 'listParts', 'getPartStream', 'deleteAll', 'totalSize', 'exists'];
    const missing = required.filter((method) => typeof storage?.[method] !== 'function');
    if (missing.length) {
        throw new TypeError(`storage implementation is missing required method(s): ${missing.join(', ')}`);
    }
}

module.exports = { assertImplementsStorageInterface };
