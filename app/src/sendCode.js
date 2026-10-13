'use strict';

const crypto = require('crypto');

/**
 * In-memory 6-digit code <-> room token mapping for VCPeer Send.
 *
 * This is purely a convenience alias so a sender can read a 6-digit code out
 * loud (phone-to-laptop) instead of typing/scanning a long link. It reuses
 * the same signaling room (`channel`) as the link — no new backend service,
 * no persistence, same in-memory-map pattern as app/src/roomPassword.js.
 *
 * Codes expire after TTL_MS even if never used, and are released early via
 * release(channel) when the sender's socket disconnects (wired in server.js).
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ACTIVE_CODES = 100000; // guardrail: refuse to mint more than this many concurrently

const codeToChannel = new Map(); // code -> { channel, expiresAt }
const channelToCode = new Map(); // channel -> code (reverse index, for release-on-disconnect)

function prune(now = Date.now()) {
    for (const [code, entry] of codeToChannel) {
        if (entry.expiresAt <= now) {
            codeToChannel.delete(code);
            channelToCode.delete(entry.channel);
        }
    }
}

const pruneTimer = setInterval(() => prune(), 5 * 60 * 1000);
if (pruneTimer.unref) pruneTimer.unref();

function randomSixDigitCode() {
    // crypto.randomInt is uniformly distributed and cheap; zero-pad to always be 6 digits.
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Mint a fresh 6-digit code for a room token, replacing any existing code for
 * that same channel (so re-requesting doesn't leak old codes).
 * @param {string} channel room token
 * @param {number} [now]
 * @returns {string|null} the code, or null if the active-code guardrail is hit
 */
function createCode(channel, now = Date.now()) {
    prune(now);
    release(channel);

    if (codeToChannel.size >= MAX_ACTIVE_CODES) return null;

    let code = randomSixDigitCode();
    // Collisions are astronomically unlikely at realistic load (100k / 1M codespace)
    // but loop defensively instead of ever handing out a colliding code.
    while (codeToChannel.has(code)) code = randomSixDigitCode();

    codeToChannel.set(code, { channel, expiresAt: now + TTL_MS });
    channelToCode.set(channel, code);
    return code;
}

/**
 * @param {string} code
 * @param {number} [now]
 * @returns {string|null} the channel it maps to, or null if unknown/expired
 */
function resolveCode(code, now = Date.now()) {
    const entry = codeToChannel.get(code);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
        codeToChannel.delete(code);
        channelToCode.delete(entry.channel);
        return null;
    }
    return entry.channel;
}

/**
 * Release the code (if any) minted for this channel — called when the sender
 * disconnects, so a stale code can't resolve to a room nobody is in anymore.
 * @param {string} channel
 */
function release(channel) {
    const code = channelToCode.get(channel);
    if (!code) return;
    channelToCode.delete(channel);
    codeToChannel.delete(code);
}

function reset() {
    codeToChannel.clear();
    channelToCode.clear();
}

module.exports = {
    TTL_MS,
    MAX_ACTIVE_CODES,
    createCode,
    resolveCode,
    release,
    reset,
};
