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

// Room Link: capturing an email->room association sends a transactional
// email and writes to disk — same shape as notifySubmitLimiter.
const roomLinkEmailLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// Room Link lookup (/my-rooms): a read-only endpoint, but it's keyed by an
// unauthenticated, attacker-controlled email string — cap it so it can't be
// used to hammer disk reads or enumerate addresses at volume.
const roomLinkLookupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// Durable named rooms: claiming/updating/releasing a room name writes to
// disk and is a guessable-passcode brute-force surface, so keep this tight
// — same shape as launchboardSubmitLimiter but a lower ceiling since a real
// user claims a handful of rooms, not dozens per minute.
const roomClaimLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// Checking whether a room name is already claimed is read-only but still
// unauthenticated and cheap to hammer — cap it generously.
const roomClaimStatusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
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

// VCPeer async "Record & share" clips: creating one declares a size and
// reserves quota, same shape as transferCreateLimiter but a looser ceiling —
// recording a clip is a much more common action during a call than sending
// a large file transfer.
const clipCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many recordings created. Please try again in an hour.' },
    keyGenerator: getClientIP,
});

// Chunk uploads: same reasoning as transferChunkLimiter — frequent and
// expected for any multi-minute recording.
const clipChunkLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 4000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many chunk uploads. Please slow down and retry shortly.' },
    keyGenerator: getClientIP,
});

// View-count increments on the public /watch/:id page — generous enough for
// real viewers (including a reload or two), tight enough to bound naive
// view-count inflation from a single IP.
const clipViewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// VCPeer Coworker: each message triggers a relay/LLM call, so cap it tighter
// than a cheap read-only endpoint — generous enough for a real conversation,
// tight enough to bound a single IP from burning the shared free relay quota.
const coworkerMessageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many messages. Please slow down and try again shortly.' },
    keyGenerator: getClientIP,
});

// Slack retries undelivered events, and a misbehaving/compromised workspace
// could otherwise hammer this endpoint — keyed by IP same as every other
// unauthenticated POST here (the HMAC signature check in coworkerRoutes.js
// is the real authorization gate, this just bounds request volume).
const coworkerSlackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// Meeting Notes: saving a transcript snapshot optionally triggers an AI
// summary call (the shared relay), so keep this tighter than a cheap
// read-only endpoint — same shape as clipCreateLimiter.
const notesCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many notes created. Please try again in an hour.' },
    keyGenerator: getClientIP,
});

// Reading a shared /notes/:id page is unauthenticated but the id itself is
// the secret — generous ceiling for real viewers/reloads, bounded against
// brute-force id guessing from a single IP.
const notesViewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again in a minute.' },
    keyGenerator: getClientIP,
});

// Deleting via manageToken — same tight ceiling as roomClaimLimiter.
const notesDeleteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
    keyGenerator: getClientIP,
});

module.exports = {
    loginLimiter,
    createRoomTokenLimiter,
    sendCodeLimiter,
    sendCodeResolveLimiter,
    launchboardSubmitLimiter,
    notifySubmitLimiter,
    roomLinkEmailLimiter,
    roomLinkLookupLimiter,
    roomClaimLimiter,
    roomClaimStatusLimiter,
    transferCreateLimiter,
    transferChunkLimiter,
    transferEmailVerifyLimiter,
    transferReportLimiter,
    clipCreateLimiter,
    clipChunkLimiter,
    clipViewLimiter,
    coworkerMessageLimiter,
    coworkerSlackLimiter,
    notesCreateLimiter,
    notesViewLimiter,
    notesDeleteLimiter,
};
