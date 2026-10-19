'use strict';

const crypto = require('crypto');

/**
 * In-memory 6-digit sender-email verification codes for VCPeer Send's
 * "Send by email" delivery mode — same in-memory-map-with-TTL shape as
 * app/src/sendCode.js, scoped per (transferId, email) so a code can't be
 * replayed against a different transfer.
 *
 * This exists purely to slow down spam: before recipient emails go out, the
 * sender must prove they control the "from" address they typed in.
 */
class EmailVerificationStore {
    /** @param {{ ttlMs: number, now?: () => number }} options */
    constructor({ ttlMs, now = Date.now }) {
        this.ttlMs = ttlMs;
        this._now = now;
        this._codes = new Map(); // `${transferId}:${email}` -> { code, expiresAt, attempts }
    }

    _key(transferId, email) {
        return `${transferId}:${String(email).trim().toLowerCase()}`;
    }

    /**
     * @param {string} transferId
     * @param {string} email
     * @returns {string} a fresh 6-digit code, replacing any prior one for this pair
     */
    createCode(transferId, email) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        this._codes.set(this._key(transferId, email), {
            code,
            expiresAt: this._now() + this.ttlMs,
            attempts: 0,
        });
        return code;
    }

    /**
     * @param {string} transferId
     * @param {string} email
     * @param {string} code
     * @returns {{ valid: boolean, reason?: 'not_found'|'expired'|'too_many_attempts'|'mismatch' }}
     *   A correct match consumes (deletes) the code; a wrong guess increments
     *   an attempt counter and locks out after 5 tries.
     */
    verify(transferId, email, code) {
        const key = this._key(transferId, email);
        const entry = this._codes.get(key);
        if (!entry) return { valid: false, reason: 'not_found' };
        if (entry.expiresAt <= this._now()) {
            this._codes.delete(key);
            return { valid: false, reason: 'expired' };
        }
        if (entry.attempts >= 5) {
            this._codes.delete(key);
            return { valid: false, reason: 'too_many_attempts' };
        }
        if (entry.code !== String(code).trim()) {
            entry.attempts += 1;
            return { valid: false, reason: 'mismatch' };
        }
        this._codes.delete(key);
        return { valid: true };
    }

    /** Drops expired entries — call periodically to bound memory. */
    prune() {
        const now = this._now();
        for (const [key, entry] of this._codes) {
            if (entry.expiresAt <= now) this._codes.delete(key);
        }
    }

    reset() {
        this._codes.clear();
    }
}

module.exports = { EmailVerificationStore };
