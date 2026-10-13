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

// VCPeer Send "Send a link": creating a transfer declares a size and reserves
// quota, so keep this tighter than the cheap read-only endpoints below.
const transferCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many transfers created. Please try again in an hour.' },
    keyGenerator: getClientIP,
});

// Chunk uploads are frequent and expected for any multi-GB transfer (a 2 GiB
// upload at the default 8 MiB chunk size is ~256 PUTs) — generous ceiling,
// still bounds a single IP from hammering disk/CPU with encryption work.
const transferChunkLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 4000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many chunk uploads. Please slow down and retry shortly.' },
    keyGenerator: getClientIP,
});

// Sender-email verification code request/confirm — must be tight, this is the
// anti-spam gate for "Send by email".
const transferEmailVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many verification attempts. Please try again later.' },
    keyGenerator: getClientIP,
});

// Abuse-report link on download pages.
const transferReportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many reports. Please try again later.' },
    keyGenerator: getClientIP,
});

module.exports = {
    loginLimiter,
    createRoomTokenLimiter,
    sendCodeLimiter,
    transferCreateLimiter,
    transferChunkLimiter,
    transferEmailVerifyLimiter,
    transferReportLimiter,
};
