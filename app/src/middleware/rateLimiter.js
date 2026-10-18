'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

/**
 * Rate limiters.
 *
 * Throttle by client IP only (req.ip honours the Express `trust proxy` setting).
 * A client-supplied value (e.g. username) could be varied per request to get a
 * fresh bucket and defeat the limit.
 */
// ipKeyGenerator groups IPv6 addresses by subnet so a client can't dodge the limit by rotating addresses
const getClientIP = (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress);

const plural = (minutes) => `${minutes} minute${minutes == 1 ? '' : 's'}`;

// Login attempts limit
const maxAttempts = config.host.maxLoginAttempts;
const minBlockTime = config.host.minLoginBlockTime; // in minutes
const loginLimiter = rateLimit({
    windowMs: minBlockTime * 60 * 1000, // 15 minutes default
    max: maxAttempts,
    message: {
        message: `Too many login attempts. Please try again after ${plural(minBlockTime)}.`,
    },
    keyGenerator: getClientIP,
});

// /createRoomToken runs the room creation policy and mints tokens, so cap request volume per IP.
const createRoomTokenWindowMinutes = config.host.createRoomTokenWindowMinutes || 1;
const createRoomTokenLimiter = rateLimit({
    windowMs: createRoomTokenWindowMinutes * 60 * 1000,
    max: config.host.createRoomTokenMaxRequests || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: `Too many room token requests. Please try again after ${plural(createRoomTokenWindowMinutes)}.`,
    },
    keyGenerator: getClientIP,
});

// VCPeer Send: minting a 6-digit code is cheap but should still be capped per IP
// (it's an unauthenticated POST) — same shape as createRoomTokenLimiter.
const sendCodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many requests. Please try again in a minute.',
    },
    keyGenerator: getClientIP,
});

// VCPeer Send: resolving a 6-digit code is the side that actually matters for
// brute force — the codespace is only 1,000,000 combinations and a hit hijacks
// someone else's active file transfer. This endpoint had NO rate limiting at
// all (unlike sendCodeLimiter above, which only throttles minting), so an
// attacker could hammer it unthrottled and guess a live code well inside its
// 30-minute TTL. Cap it tighter than minting since legitimate use is a single
// lookup, not a burst.
const sendCodeResolveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many requests. Please try again in a minute.',
    },
    keyGenerator: getClientIP,
});

// Launchboard: submitting a listing is an unauthenticated POST that writes to
// disk, so cap it per IP the same way as sendCodeLimiter.
const launchboardSubmitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many submissions. Please try again in a minute.',
    },
    keyGenerator: getClientIP,
});

// Notify signup: same shape as launchboardSubmitLimiter — unauthenticated
// POST that writes to disk.
const notifySubmitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many submissions. Please try again in a minute.',
    },
    keyGenerator: getClientIP,
});

module.exports = {
    loginLimiter,
    createRoomTokenLimiter,
    sendCodeLimiter,
    sendCodeResolveLimiter,
    launchboardSubmitLimiter,
    notifySubmitLimiter,
};
