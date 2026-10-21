'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('Notify');

/**
 * Notify — "tell me when VCPeer ships a new self-hosted feature" lead capture.
 *
 * Same on-disk-JSON-file pattern as launchboard.js: no database wired into
 * this fork, so signups persist to a single JSON file on disk, keyed by
 * normalized email so a repeat signup is an idempotent no-op rather than a
 * duplicate row.
 *
 * NOTIFY_DATA_DIR lets production point this at a path a redeploy never
 * overwrites, same convention as LAUNCHBOARD_DATA_DIR; defaults to app/data/
 * for local dev.
 */

const DATA_DIR = process.env.NOTIFY_DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'notify.json');

// Guardrail so a submission flood can't grow the data file without bound.
const MAX_SIGNUPS = 20000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

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
        log.error('Failed to read notify data file, treating as empty', err);
        return [];
    }
}

function writeAll(signups) {
    writeJsonFileAtomic(DATA_FILE, signups);
}

function normalizeEmail(input) {
    return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

function isValidEmail(input) {
    return typeof input === 'string' && input.length > 0 && input.length <= EMAIL_MAX && EMAIL_RE.test(input);
}

/**
 * @returns {number} total distinct signups currently stored.
 */
function count() {
    return readAll().length;
}

/**
 * @param {{ email?: unknown, source?: unknown }} fields
 * @returns {{ok: true, alreadySubscribed: boolean}|{ok: false, error: string}}
 */
function subscribe(fields) {
    const email = normalizeEmail(fields && fields.email);
    if (!isValidEmail(email)) {
        return { ok: false, error: 'Enter a valid email address.' };
    }

    const signups = readAll();
    if (signups.some((s) => s.email === email)) {
        return { ok: true, alreadySubscribed: true };
    }

    if (signups.length >= MAX_SIGNUPS) {
        return { ok: false, error: 'Signups are temporarily full — please try again later.' };
    }

    signups.push({
        id: crypto.randomUUID(),
        email,
        source: typeof (fields && fields.source) === 'string' ? fields.source.slice(0, 80) : undefined,
        createdAt: Date.now(),
    });
    writeAll(signups);
    return { ok: true, alreadySubscribed: false };
}

module.exports = {
    DATA_FILE,
    count,
    subscribe,
    isValidEmail,
    normalizeEmail,
};
