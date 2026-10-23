'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('RoomLink');

/**
 * Room Link capture — "email me this room link" + /my-rooms lookup.
 *
 * STRATEGY-2026-10-23.md Section 5's #1 flagged gap: there was zero
 * re-engagement channel after a call ends. This captures an
 * email -> room link association so a participant who didn't bookmark the
 * room can look it up again later at /my-rooms, or just get it emailed to
 * them right after the call ends.
 *
 * Deliberately one row per submission (NOT deduped by email like
 * notify.js's signups) — the same address legitimately comes back for many
 * different rooms over time, and /my-rooms needs the full recent history,
 * not just the latest room. Same on-disk-JSON-file pattern as
 * notify.js/launchboard.js — no database wired into this fork.
 *
 * ROOM_LINK_DATA_DIR lets production point this at a path a redeploy never
 * overwrites (same convention as NOTIFY_DATA_DIR/LAUNCHBOARD_DATA_DIR);
 * defaults to app/data/ for local dev.
 */

const DATA_DIR = process.env.ROOM_LINK_DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'room-links.json');

// Guardrail so a submission flood can't grow the data file without bound.
const MAX_RECORDS = 50000;
// A single email re-requesting links doesn't need unbounded history kept
// around — cap how many rows /my-rooms will ever return per email, and
// evict the oldest once a given address exceeds it.
const MAX_PER_EMAIL = 25;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const ROOM_ID_MAX = 200;
const URL_MAX = 2000;

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
        log.error('Failed to read room-link data file, treating as empty', err);
        return [];
    }
}

function writeAll(records) {
    writeJsonFileAtomic(DATA_FILE, records);
}

function normalizeEmail(input) {
    return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

function isValidEmail(input) {
    return typeof input === 'string' && input.length > 0 && input.length <= EMAIL_MAX && EMAIL_RE.test(input);
}

/**
 * @param {{ email?: unknown, roomId?: unknown, roomUrl?: unknown }} fields already-XSS-sanitized by the caller
 * @returns {{ok: true, record: object}|{ok: false, error: string}}
 */
function saveRoomLink(fields) {
    const email = normalizeEmail(fields && fields.email);
    const roomId = typeof (fields && fields.roomId) === 'string' ? fields.roomId.trim() : '';
    const roomUrl = typeof (fields && fields.roomUrl) === 'string' ? fields.roomUrl.trim() : '';

    if (!isValidEmail(email)) {
        return { ok: false, error: 'Enter a valid email address.' };
    }
    if (!roomId || roomId.length > ROOM_ID_MAX || !roomUrl || roomUrl.length > URL_MAX) {
        return { ok: false, error: 'Missing or invalid room link.' };
    }

    const records = readAll();
    if (records.length >= MAX_RECORDS) {
        return { ok: false, error: 'Too many room links saved right now — please try again later.' };
    }

    const record = {
        id: crypto.randomUUID(),
        email,
        roomId,
        roomUrl,
        createdAt: Date.now(),
    };
    records.push(record);

    // Evict this email's oldest rows beyond MAX_PER_EMAIL so one address
    // can't grow the file unbounded by repeatedly requesting links.
    const forThisEmail = records.filter((r) => r.email === email).sort((a, b) => a.createdAt - b.createdAt);
    if (forThisEmail.length > MAX_PER_EMAIL) {
        const dropIds = new Set(forThisEmail.slice(0, forThisEmail.length - MAX_PER_EMAIL).map((r) => r.id));
        writeAll(records.filter((r) => !dropIds.has(r.id)));
    } else {
        writeAll(records);
    }

    return { ok: true, record };
}

/**
 * @param {string} email
 * @param {number} [limit]
 * @returns {Array<{id: string, roomId: string, roomUrl: string, createdAt: number}>} newest first
 */
function getLinksForEmail(email, limit = MAX_PER_EMAIL) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return [];
    return readAll()
        .filter((r) => r.email === normalized)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(({ id, roomId, roomUrl, createdAt }) => ({ id, roomId, roomUrl, createdAt }));
}

function escapeHtmlLite(value) {
    return String(value == null ? '' : value).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}

/**
 * Build the "here's your room link" transactional email content.
 * @param {{ roomUrl: string, roomId: string, myRoomsUrl: string }} fields
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildRoomLinkEmail({ roomUrl, roomId, myRoomsUrl }) {
    const subject = `Your VCPeer room link: ${roomId}`;
    const text = [
        `Here is the link to your VCPeer room "${roomId}":`,
        '',
        roomUrl,
        '',
        `You can look up your recent room links anytime at ${myRoomsUrl}.`,
    ].join('\n');
    const html = `
        <div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1d2026;">
            <h2 style="margin: 0 0 4px;">Your room link</h2>
            <p style="color: #6a6f82; margin: 0 0 16px;">Room: <strong>${escapeHtmlLite(roomId)}</strong></p>
            <p style="margin: 0 0 16px;">
                <a href="${escapeHtmlLite(roomUrl)}" style="display: inline-block; padding: 10px 18px; background: #4678f9; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
                    Open the room
                </a>
            </p>
            <p style="color: #6a6f82; font-size: 13px; word-break: break-all; margin: 0 0 16px;">
                Or copy this link: ${escapeHtmlLite(roomUrl)}
            </p>
            <p style="color: #6a6f82; font-size: 13px; margin: 0;">
                Look up your recent room links anytime at
                <a href="${escapeHtmlLite(myRoomsUrl)}" style="color: #4678f9;">${escapeHtmlLite(myRoomsUrl)}</a>.
            </p>
        </div>
    `;
    return { subject, html, text };
}

function reset() {
    writeAll([]);
}

module.exports = {
    DATA_FILE,
    MAX_PER_EMAIL,
    saveRoomLink,
    getLinksForEmail,
    buildRoomLinkEmail,
    isValidEmail,
    normalizeEmail,
    reset,
};
