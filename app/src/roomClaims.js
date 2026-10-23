'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('RoomClaims');

/**
 * Durable named rooms with a reusable passcode.
 *
 * app/src/roomPassword.js's lock/password is per-call and lives only in
 * memory (`peers[channel]['password']`) — gone the moment the room empties
 * or the server restarts. Agencies and recruiters who reuse the exact same
 * room link every week need the opposite: claim a specific room name once,
 * set a fixed passcode, and have it enforced on every future join to that
 * name, across restarts, even before anyone has opened the room this time.
 *
 * Same on-disk-JSON-file pattern as launchboard.js/notify.js — no database
 * wired into this fork. The passcode itself is never stored in plaintext: a
 * random per-claim salt + scrypt-derived hash are stored instead (Node's
 * built-in crypto, no new dependency), compared at join time with a
 * timing-safe equality check — see passcodeMatches().
 *
 * ROOM_CLAIMS_DATA_DIR lets production point this at a path a redeploy
 * never overwrites, same convention as the other *_DATA_DIR vars; defaults
 * to app/data/ for local dev.
 */

const DATA_DIR = process.env.ROOM_CLAIMS_DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'room-claims.json');

// Guardrail so a submission flood can't grow the data file without bound.
const MAX_CLAIMS = 20000;
const PASSCODE_MIN = 4;
const PASSCODE_MAX = 64;
const ROOM_ID_MAX = 200;
const SCRYPT_KEYLEN = 64;

function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        writeJsonFileAtomic(DATA_FILE, []);
    }
}

function readAll() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        log.error('Failed to read room-claims data file, treating as empty', err);
        return [];
    }
}

function writeAll(claims) {
    writeJsonFileAtomic(DATA_FILE, claims);
}

function normalizeRoomId(input) {
    return typeof input === 'string' ? input.trim() : '';
}

function isValidPasscode(input) {
    return typeof input === 'string' && input.length >= PASSCODE_MIN && input.length <= PASSCODE_MAX;
}

/**
 * @param {string} passcode
 * @returns {{salt: string, hash: string}}
 */
function hashPasscode(passcode) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(passcode), salt, SCRYPT_KEYLEN).toString('hex');
    return { salt, hash };
}

/**
 * Timing-safe passcode check against a stored salt+hash pair.
 * @param {unknown} passcode
 * @param {string} salt
 * @param {string} hash
 * @returns {boolean}
 */
function passcodeMatches(passcode, salt, hash) {
    if (typeof passcode !== 'string' || !passcode || !salt || !hash) return false;
    try {
        const derived = crypto.scryptSync(passcode, salt, SCRYPT_KEYLEN);
        const stored = Buffer.from(hash, 'hex');
        if (derived.length !== stored.length) return false;
        return crypto.timingSafeEqual(derived, stored);
    } catch (err) {
        log.error('passcodeMatches failed', err.message);
        return false;
    }
}

/**
 * @param {string} roomId
 * @returns {object|null} the claim record for this room, or null if unclaimed
 */
function getClaim(roomId) {
    const normalized = normalizeRoomId(roomId);
    if (!normalized) return null;
    return readAll().find((c) => c.roomId === normalized) || null;
}

/**
 * @returns {boolean} true if this room name currently has an active claim
 */
function isClaimed(roomId) {
    return getClaim(roomId) !== null;
}

/**
 * Claim a room name, or update an already-claimed one (which requires
 * proving the CURRENT passcode, so a stranger can't silently steal or
 * relock someone else's already-claimed room name).
 * @param {{ roomId?: unknown, passcode?: unknown, currentPasscode?: unknown, ownerEmail?: unknown }} fields
 * @returns {{ok: true, claim: {roomId: string, ownerEmail?: string, createdAt: number}}|{ok: false, error: string}}
 */
function claimRoom(fields) {
    const roomId = normalizeRoomId(fields && fields.roomId);
    const passcode = fields && fields.passcode;
    const ownerEmail = typeof (fields && fields.ownerEmail) === 'string' ? fields.ownerEmail.trim().toLowerCase() : '';

    if (!roomId || roomId.length > ROOM_ID_MAX) {
        return { ok: false, error: 'Enter a valid room name.' };
    }
    if (!isValidPasscode(passcode)) {
        return { ok: false, error: `Passcode must be ${PASSCODE_MIN}-${PASSCODE_MAX} characters.` };
    }

    const claims = readAll();
    const existing = claims.find((c) => c.roomId === roomId);

    if (existing) {
        if (!passcodeMatches(fields && fields.currentPasscode, existing.salt, existing.hash)) {
            return {
                ok: false,
                error: 'This room name is already claimed. Provide its current passcode to update it.',
            };
        }
    } else if (claims.length >= MAX_CLAIMS) {
        return { ok: false, error: 'Too many rooms claimed right now — please try again later.' };
    }

    const { salt, hash } = hashPasscode(passcode);
    const record = {
        roomId,
        salt,
        hash,
        ownerEmail: ownerEmail || existing?.ownerEmail,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
    };

    writeAll(existing ? claims.map((c) => (c.roomId === roomId ? record : c)) : [...claims, record]);

    return { ok: true, claim: { roomId: record.roomId, ownerEmail: record.ownerEmail, createdAt: record.createdAt } };
}

/**
 * Verify a join attempt against a claimed room's passcode. Used at the
 * socket 'join' layer (see app/src/server.js), same enforcement point as
 * the ephemeral RoomPassword lock.
 * @param {string} roomId
 * @param {unknown} passcode
 * @returns {{claimed: false}|{claimed: true, ok: boolean}}
 */
function verify(roomId, passcode) {
    const claim = getClaim(roomId);
    if (!claim) return { claimed: false };
    return { claimed: true, ok: passcodeMatches(passcode, claim.salt, claim.hash) };
}

/**
 * Release a claim — requires the current passcode.
 * @param {string} roomId
 * @param {unknown} passcode
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function releaseClaim(roomId, passcode) {
    const claim = getClaim(roomId);
    if (!claim) return { ok: false, error: 'This room name is not claimed.' };
    if (!passcodeMatches(passcode, claim.salt, claim.hash)) {
        return { ok: false, error: 'Incorrect passcode.' };
    }
    writeAll(readAll().filter((c) => c.roomId !== claim.roomId));
    return { ok: true };
}

function reset() {
    writeAll([]);
}

module.exports = {
    DATA_FILE,
    PASSCODE_MIN,
    PASSCODE_MAX,
    claimRoom,
    getClaim,
    isClaimed,
    verify,
    releaseClaim,
    isValidPasscode,
    passcodeMatches,
    reset,
};
