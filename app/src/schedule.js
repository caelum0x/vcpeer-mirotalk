'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const Validate = require('./validate');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('Schedule');

/**
 * Meeting scheduling — same-origin `/schedule` create form + `/schedule/:id`
 * view page + a downloadable `.ics` calendar file, see backlog item #6 in
 * BUILD-LOG-2026-10-23.md.
 *
 * Before this, the only way to "schedule" a VCPeer call was the in-room
 * "Schedule email invitation" button (public/js/client.js `shareRoomByEmail`),
 * which just opens the visitor's own mail client with a `mailto:` link — it
 * never persists anything server-side, has no page to revisit, and produces
 * no calendar file a recipient can actually import. This module gives a
 * scheduled meeting a real id, a shareable `/schedule/:id` page, and a
 * standards-compliant `.ics` file any calendar app (Google/Outlook/Apple)
 * can import directly.
 *
 * Same on-disk-JSON-file pattern as notify.js/roomLink.js/roomClaims.js/
 * meetingNotes.js — no database wired into this fork.
 *
 * SCHEDULE_DATA_DIR lets production point this at a path a redeploy never
 * overwrites, same convention as the other *_DATA_DIR vars; defaults to
 * app/data/ for local dev.
 */

const DEFAULTS = {
    dataDir: path.join(__dirname, '../data'),
    maxRecords: 20000,
    retentionDaysAfterMeeting: 60,
    titleMaxChars: 200,
    descriptionMaxChars: 2000,
    organizerNameMaxChars: 200,
    minDurationMinutes: 5,
    maxDurationMinutes: 480,
    // A schedule can't be set further out than this — keeps the data file
    // from being used to park near-infinite-future junk rows.
    maxFutureDays: 730,
    // Small grace window so a legitimate submission isn't rejected purely
    // from client/server clock drift a few seconds apart.
    pastGraceMinutes: 5,
};

const ROOM_ID_MAX = 200;
const MANAGE_TOKEN_BYTES = 24;
const AUTO_ROOM_PREFIX = 'meeting-';

function dataFileFor(cfg) {
    return path.join(cfg.dataDir || DEFAULTS.dataDir, 'schedule.json');
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
        log.error('Failed to read schedule data file, treating as empty', err);
        return [];
    }
}

function writeAll(cfg, records) {
    writeJsonFileAtomic(dataFileFor(cfg), records);
}

/**
 * Drops records whose meeting ended more than retentionDaysAfterMeeting ago,
 * then, if still over maxRecords, evicts the soonest-to-expire overflow.
 * Called before every write so the file self-prunes without a background
 * timer.
 */
function pruneExpired(cfg, records) {
    const retentionMs = (cfg.retentionDaysAfterMeeting ?? DEFAULTS.retentionDaysAfterMeeting) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const notExpired = records.filter((r) => r.startTime + r.durationMinutes * 60 * 1000 + retentionMs >= now);

    const maxRecords = cfg.maxRecords || DEFAULTS.maxRecords;
    if (notExpired.length <= maxRecords) return notExpired;

    return notExpired.sort((a, b) => b.createdAt - a.createdAt).slice(0, maxRecords);
}

function randomRoomId() {
    return AUTO_ROOM_PREFIX + crypto.randomBytes(5).toString('hex');
}

function isRoomIdTaken(records, roomId) {
    return records.some((r) => r.roomId === roomId);
}

/**
 * @param {{roomId?: unknown, title?: unknown, description?: unknown, organizerName?: unknown,
 *   startTime?: unknown, durationMinutes?: unknown}} fields already-XSS-sanitized by the caller
 * @param {object} rawConfig config.schedule
 * @returns {{ok: true, record: object}|{ok: false, error: string}}
 */
function createSchedule(fields, rawConfig = {}) {
    const cfg = { ...DEFAULTS, ...rawConfig };

    const title = typeof (fields && fields.title) === 'string' ? fields.title.trim().slice(0, cfg.titleMaxChars) : '';
    if (!title) {
        return { ok: false, error: 'Enter a meeting title.' };
    }

    const description =
        typeof (fields && fields.description) === 'string'
            ? fields.description.trim().slice(0, cfg.descriptionMaxChars)
            : '';

    const organizerName =
        typeof (fields && fields.organizerName) === 'string'
            ? fields.organizerName.trim().slice(0, cfg.organizerNameMaxChars)
            : '';

    const startTime = Number(fields && fields.startTime);
    if (!Number.isFinite(startTime)) {
        return { ok: false, error: 'Choose a valid meeting date and time.' };
    }
    const now = Date.now();
    const pastGraceMs = (cfg.pastGraceMinutes ?? DEFAULTS.pastGraceMinutes) * 60 * 1000;
    if (startTime < now - pastGraceMs) {
        return { ok: false, error: 'Choose a meeting time in the future.' };
    }
    const maxFutureMs = (cfg.maxFutureDays || DEFAULTS.maxFutureDays) * 24 * 60 * 60 * 1000;
    if (startTime > now + maxFutureMs) {
        return { ok: false, error: 'That date is too far in the future.' };
    }

    const durationMinutes = Number(fields && fields.durationMinutes);
    const minDuration = cfg.minDurationMinutes || DEFAULTS.minDurationMinutes;
    const maxDuration = cfg.maxDurationMinutes || DEFAULTS.maxDurationMinutes;
    if (!Number.isFinite(durationMinutes) || durationMinutes < minDuration || durationMinutes > maxDuration) {
        return { ok: false, error: `Meeting length must be between ${minDuration} and ${maxDuration} minutes.` };
    }

    const records = pruneExpired(cfg, readAll(cfg));

    let roomId = typeof (fields && fields.roomId) === 'string' ? fields.roomId.trim() : '';
    if (roomId) {
        if (!Validate.isValidRoomName(roomId) || roomId.length > ROOM_ID_MAX) {
            return { ok: false, error: 'Invalid room name.' };
        }
    } else {
        // Auto-generate a readable, collision-checked room slug when the
        // organizer doesn't want to pick their own name.
        do {
            roomId = randomRoomId();
        } while (isRoomIdTaken(records, roomId));
    }

    if (records.length >= cfg.maxRecords) {
        return { ok: false, error: 'Too many meetings scheduled right now — please try again later.' };
    }

    const record = {
        id: crypto.randomUUID(),
        manageToken: crypto.randomBytes(MANAGE_TOKEN_BYTES).toString('hex'),
        roomId,
        title,
        description,
        organizerName,
        startTime,
        durationMinutes,
        createdAt: now,
    };
    records.push(record);
    writeAll(cfg, records);

    return { ok: true, record };
}

/**
 * Public read — never includes manageToken.
 * @param {string} id
 * @param {object} rawConfig
 * @returns {object|null}
 */
function getSchedule(id, rawConfig = {}) {
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
function cancelByManageToken(manageToken, rawConfig = {}) {
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

function escapeIcsText(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Folds an ICS content line at 75 octets per RFC 5545 section 3.1, since
 * long SUMMARY/DESCRIPTION values would otherwise produce an invalid file
 * some calendar clients reject outright.
 * @param {string} line
 * @returns {string}
 */
function foldIcsLine(line) {
    if (line.length <= 75) return line;
    let folded = line.slice(0, 75);
    let rest = line.slice(75);
    while (rest.length > 0) {
        folded += '\r\n ' + rest.slice(0, 74);
        rest = rest.slice(74);
    }
    return folded;
}

function toIcsUtc(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Builds a standards-compliant VEVENT .ics file for a scheduled meeting.
 * @param {{id: string, title: string, description: string, roomId: string,
 *   roomUrl: string, startTime: number, durationMinutes: number, createdAt: number}} record
 * @returns {string}
 */
function buildIcs(record) {
    const dtStart = toIcsUtc(record.startTime);
    const dtEnd = toIcsUtc(record.startTime + record.durationMinutes * 60 * 1000);
    const dtStamp = toIcsUtc(record.createdAt || Date.now());
    const descriptionLines = [record.description, `Join: ${record.roomUrl}`].filter(Boolean).join('\n\n');

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//VCPeer//Schedule//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${record.id}@vcpeer`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${escapeIcsText(record.title)}`,
        `DESCRIPTION:${escapeIcsText(descriptionLines)}`,
        `URL:${escapeIcsText(record.roomUrl)}`,
        `LOCATION:${escapeIcsText(record.roomUrl)}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ];

    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function reset(rawConfig = {}) {
    writeAll({ ...DEFAULTS, ...rawConfig }, []);
}

module.exports = {
    createSchedule,
    getSchedule,
    cancelByManageToken,
    buildIcs,
    reset,
};
