'use strict';

/**
 * Room/link token helpers for VCPeer Send.
 *
 * A send "room" is just a signaling channel name (see app/src/server.js's
 * existing 'join' / 'relaySDP' / 'relayICE' / 'addPeer' events — reused as-is,
 * no new backend service). We prefix tokens with `send-` so they can never
 * collide with a regular call room name a user might type into /newcall.
 */

const TOKEN_PREFIX = 'send-';
const TOKEN_BYTES = 16; // 128 bits of randomness, hex-encoded below

/**
 * @param {(n: number) => Uint8Array} [randomBytes] injectable for tests;
 *   defaults to Web Crypto's getRandomValues.
 * @returns {string} e.g. "send-3f9a2b7c1d4e5f6a7b8c9d0e1f2a3b4c"
 */
export function generateRoomToken(randomBytes = defaultRandomBytes) {
    const bytes = randomBytes(TOKEN_BYTES);
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `${TOKEN_PREFIX}${hex}`;
}

/**
 * @param {string} token
 * @returns {boolean}
 */
export function isValidRoomToken(token) {
    if (typeof token !== 'string') return false;
    return new RegExp(`^${TOKEN_PREFIX}[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(token);
}

/**
 * @param {string} origin e.g. "https://vcpeer.com"
 * @param {string} token room token from generateRoomToken()
 * @returns {string} shareable URL, e.g. "https://vcpeer.com/send?r=send-...."
 */
export function buildShareUrl(origin, token) {
    if (!isValidRoomToken(token)) throw new RangeError('invalid room token');
    const url = new URL('/send', origin);
    url.searchParams.set('r', token);
    return url.toString();
}

/**
 * @param {number} length
 * @returns {Uint8Array}
 */
function defaultRandomBytes(length) {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
        throw new Error('crypto.getRandomValues is not available in this environment');
    }
    return crypto.getRandomValues(new Uint8Array(length));
}
