'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('MeetingNotes');

/**
 * Meeting Notes — persisted caption/Whisper transcript + an AI-generated
 * summary and action-item list, surfaced at /notes/:id.
 *
 * The live caption/Whisper transcript (app/src/server.js `caption` socket
 * event + `getWhisperTranscription`) only ever exists inside each peer's own
 * browser tab, carried peer-to-peer over the WebRTC DataChannel — the server
 * never sees it, and it is gone the moment every tab closes. This module
 * persists an opt-in snapshot of that transcript (the participant clicks
 * "Share meeting notes" in public/js/client.js) server-side, so a host who
 * re-uses the same room every week has something to send a client/candidate
 * afterward instead of nothing.
 *
 * Same on-disk-JSON-file pattern as notify.js/roomLink.js/roomClaims.js — no
 * database wired into this fork. The AI summary (see server.js's
 * `POST /api/v1/notes` route, which calls the same OpenAI-compatible relay
 * already wired for VCPeer Coworker) is best-effort: the raw transcript is
 * always saved and servable even if summarization is disabled, unavailable,
 * or fails.
 *
 * MEETING_NOTES_DATA_DIR lets production point this at a path a redeploy
 * never overwrites, same convention as the other *_DATA_DIR vars; defaults
 * to app/data/ for local dev.
 */

const DEFAULTS = {
    dataDir: path.join(__dirname, '../data'),
    maxEntries: 4000,
    maxEntryChars: 2000,
    maxTotalChars: 90000,
    retentionDays: 90,
    maxRecords: 20000,
    summaryMaxLines: 400,
};

const ROOM_ID_MAX = 200;
const MANAGE_TOKEN_BYTES = 24;

function dataFileFor(cfg) {
    return path.join(cfg.dataDir || DEFAULTS.dataDir, 'meeting-notes.json');
}

function ensureDataFile(cfg) {
    const dir = cfg.dataDir || DEFAULTS.dataDir;
    const file = dataFileFor(cfg);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(file)) {
        writeJsonFileAtomic(file, []);
    }
    return file;
}

function readAll(cfg) {
    const file = ensureDataFile(cfg);
    try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        log.error('Failed to read meeting-notes data file, treating as empty', err);
        return [];
    }
}

function writeAll(cfg, records) {
    writeJsonFileAtomic(dataFileFor(cfg), records);
}

/**
 * Drops records past retentionDays and, if still over maxRecords, evicts the
 * oldest ones. Called before every write so the file self-prunes without a
 * background timer.
 */
function pruneExpired(cfg, records) {
    const retentionMs = (cfg.retentionDays || DEFAULTS.retentionDays) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    const notExpired = records.filter((r) => r.createdAt >= cutoff);

    const maxRecords = cfg.maxRecords || DEFAULTS.maxRecords;
    if (notExpired.length <= maxRecords) return notExpired;

    return notExpired.sort((a, b) => b.createdAt - a.createdAt).slice(0, maxRecords);
}

/**
 * @param {string} input
 * @returns {boolean}
 */
function isValidRoomId(input) {
    return typeof input === 'string' && input.length > 0 && input.length <= ROOM_ID_MAX;
}

/**
 * Normalizes and caps a raw transcript array to a bounded, storable shape.
 * Entries that aren't well-formed (missing text, wrong types) are dropped
 * rather than rejecting the whole submission — a single malformed line from
 * a client bug should not lose the rest of a real call's transcript.
 *
 * @param {unknown} rawTranscripts already-XSS-sanitized by the caller
 * @param {{maxEntries: number, maxEntryChars: number, maxTotalChars: number}} cfg
 * @returns {{entries: Array<{time: string, name: string, caption: string}>, truncated: boolean}}
 */
function normalizeTranscript(rawTranscripts, cfg) {
    const maxEntries = cfg.maxEntries || DEFAULTS.maxEntries;
    const maxEntryChars = cfg.maxEntryChars || DEFAULTS.maxEntryChars;
    const maxTotalChars = cfg.maxTotalChars || DEFAULTS.maxTotalChars;

    if (!Array.isArray(rawTranscripts)) return { entries: [], truncated: false };

    let totalChars = 0;
    let truncated = rawTranscripts.length > maxEntries;
    const entries = [];

    for (const raw of rawTranscripts.slice(0, maxEntries)) {
        if (!raw || typeof raw !== 'object') continue;
        const caption = typeof raw.caption === 'string' ? raw.caption.slice(0, maxEntryChars) : '';
        if (!caption) continue;

        const name = typeof raw.name === 'string' ? raw.name.slice(0, 200) : 'Participant';
        const time = typeof raw.time === 'string' ? raw.time.slice(0, 100) : '';

        if (totalChars + caption.length > maxTotalChars) {
            truncated = true;
            break;
        }
        totalChars += caption.length;
        entries.push({ time, name, caption });
    }

    return { entries, truncated };
}

/**
 * @param {{roomId?: unknown, transcripts?: unknown}} fields already-XSS-sanitized by the caller
 * @param {object} rawConfig config.meetingNotes
 * @returns {{ok: true, record: object}|{ok: false, error: string}}
 */
function createNote(fields, rawConfig = {}) {
    const cfg = { ...DEFAULTS, ...rawConfig };
    const roomId = typeof (fields && fields.roomId) === 'string' ? fields.roomId.trim() : '';

    if (!isValidRoomId(roomId)) {
        return { ok: false, error: 'Missing or invalid room.' };
    }

    const { entries, truncated } = normalizeTranscript(fields && fields.transcripts, cfg);
    if (entries.length === 0) {
        return { ok: false, error: 'No transcript to save yet — start captions first.' };
    }

    const records = pruneExpired(cfg, readAll(cfg));

    const record = {
        id: crypto.randomUUID(),
        manageToken: crypto.randomBytes(MANAGE_TOKEN_BYTES).toString('hex'),
        roomId,
        createdAt: Date.now(),
        transcripts: entries,
        truncated,
        summary: null,
        actionItems: null,
        // 'unavailable' until the caller (server.js, after calling the AI
        // relay) updates this via setSummary() — kept separate from a plain
        // null summary so the /notes/:id page can show "summary disabled"
        // vs. "summary pending" vs. "no summary" correctly.
        summaryStatus: 'pending',
    };
    records.push(record);
    writeAll(cfg, records);

    return { ok: true, record };
}

/**
 * @param {string} id
 * @param {{summary: string|null, actionItems: string[]|null, status: string}} update
 * @param {object} rawConfig
 */
function setSummary(id, update, rawConfig = {}) {
    const cfg = { ...DEFAULTS, ...rawConfig };
    const records = readAll(cfg);
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return false;

    records[idx] = {
        ...records[idx],
        summary: typeof update.summary === 'string' ? update.summary.slice(0, 8000) : null,
        actionItems: Array.isArray(update.actionItems) ? update.actionItems.slice(0, 50) : null,
        summaryStatus: update.status || 'unavailable',
    };
    writeAll(cfg, records);
    return true;
}

/**
 * Public read — never includes manageToken.
 * @param {string} id
 * @param {object} rawConfig
 * @returns {object|null}
 */
function getNote(id, rawConfig = {}) {
    const cfg = { ...DEFAULTS, ...rawConfig };
    const record = readAll(cfg).find((r) => r.id === id);
    if (!record) return null;
    const { manageToken, ...publicRecord } = record;
    return publicRecord;
}

function timingSafeTokenEqual(a, b) {
    const bufA = crypto.createHash('sha256').update(String(a || '')).digest();
    const bufB = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {string} manageToken
 * @param {object} rawConfig
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function deleteByManageToken(manageToken, rawConfig = {}) {
    const cfg = { ...DEFAULTS, ...rawConfig };
    if (!manageToken || typeof manageToken !== 'string') {
        return { ok: false, error: 'Not found.' };
    }
    const records = readAll(cfg);
    const idx = records.findIndex((r) => timingSafeTokenEqual(r.manageToken, manageToken));
    if (idx === -1) {
        return { ok: false, error: 'Not found.' };
    }
    records.splice(idx, 1);
    writeAll(cfg, records);
    return { ok: true };
}

function reset(rawConfig = {}) {
    writeAll({ ...DEFAULTS, ...rawConfig }, []);
}

module.exports = {
    createNote,
    setSummary,
    getNote,
    deleteByManageToken,
    normalizeTranscript,
    reset,
};
