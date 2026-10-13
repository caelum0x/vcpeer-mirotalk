'use strict';

/**
 * Incremental SHA-256 for the optional end-to-end integrity check.
 *
 * The Web Crypto API (`crypto.subtle.digest`) has no incremental/streaming
 * mode, and hashing a multi-GB file in one `arrayBuffer()` call would defeat
 * the whole point of chunked transfer (requirement: never hold a 2+ GB file
 * in memory at once). hash-wasm provides a real, incremental, standard
 * SHA-256 (verified in tests against Node's built-in crypto.createHash) with
 * an update()/digest() API, backed by WASM for speed.
 *
 * Loaded from a pinned CDN URL (same pattern as the other third-party
 * scripts this project already loads from cdnjs/jsdelivr — crypto-js,
 * qrcodejs, sweetalert2, xss). MIT licensed, see NOTICE.md.
 *
 * The hasher factory is injectable so this module can be unit tested in
 * Node without network access (tests pass the local `hash-wasm` npm
 * package's createSHA256 instead of importing the CDN URL).
 */

const HASH_WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/hash-wasm@4.12.0/dist/index.esm.min.js';

let cachedFactory = null;

/**
 * Default hasher factory: lazily imports hash-wasm from the CDN, cached after
 * the first call so repeated StreamingSha256 instances don't re-fetch it.
 * @returns {Promise<() => Promise<object>>}
 */
async function defaultCreateHasherFactory() {
    if (!cachedFactory) {
        cachedFactory = import(/* webpackIgnore: true */ HASH_WASM_CDN_URL).then((mod) => mod.createSHA256);
    }
    const createSHA256 = await cachedFactory;
    return createSHA256();
}

export class StreamingSha256 {
    /**
     * @param {() => Promise<object>} [createHasher] factory returning a hash-wasm IHasher instance.
     *   Defaults to hash-wasm's createSHA256 loaded from the CDN.
     */
    constructor(createHasher = defaultCreateHasherFactory) {
        this._createHasher = createHasher;
        this._hasher = null;
    }

    /** Must be called (and awaited) before the first update(). */
    async init() {
        this._hasher = await this._createHasher();
        this._hasher.init();
        return this;
    }

    /**
     * @param {ArrayBuffer|ArrayBufferView} chunk
     */
    update(chunk) {
        if (!this._hasher) throw new Error('StreamingSha256.init() must be called before update()');
        const view = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
        this._hasher.update(view);
    }

    /** @returns {string} lowercase hex SHA-256 digest of everything update() has seen so far */
    digest() {
        if (!this._hasher) throw new Error('StreamingSha256.init() must be called before digest()');
        return this._hasher.digest('hex');
    }
}

export { HASH_WASM_CDN_URL };
