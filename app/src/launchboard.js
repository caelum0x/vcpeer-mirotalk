'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('./logs');
const { writeJsonFileAtomic } = require('./lib/atomicJsonFile');
const log = new Logger('Launchboard');

/**
 * Launchboard — VCPeer's public startup/product directory.
 *
 * Founders submit a product (name, URL, one-line pitch, category) and see it
 * listed immediately. There is no database wired into this fork, so
 * submissions persist to a single JSON file on disk — the same
 * in-memory/on-disk-file pattern already used by sendCode.js, just with a
 * disk-backed array instead of a Map, since listings must survive a restart
 * (unlike a 30-minute transfer code).
 *
 * The "Featured" tier is a real, working flag, but the $29/week payment is
 * not wired up yet: a submitter can only request it (featuredRequested),
 * never set `featured` directly. An operator flips `featured: true` by hand
 * in the data file until Dodo billing lands (see plans/vcpeer.md).
 *
 * LAUNCHBOARD_DATA_DIR lets production point this at a path that a redeploy
 * never overwrites (see deploy/README.md); defaults to app/data/ for local
 * dev.
 */

const DATA_DIR = process.env.LAUNCHBOARD_DATA_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'launchboard.json');

const CATEGORIES = ['saas', 'dev-tools', 'ai', 'marketing', 'fintech', 'productivity', 'other'];

// Guardrail so a submission flood can't grow the data file without bound.
const MAX_LISTINGS = 5000;

const NAME_MIN = 2;
const NAME_MAX = 80;
const PITCH_MIN = 10;
const PITCH_MAX = 280;
const URL_MAX = 500;

function seedListings() {
    const now = Date.now();
    return [
        {
            id: crypto.randomUUID(),
            name: 'VCPeer',
            url: 'https://vcpeer.com',
            pitch: 'Free peer-to-peer video calls, file transfer, scheduling and multistreaming — no signup to join.',
            category: 'productivity',
            featured: true,
            featuredRequested: false,
            createdAt: now,
        },
        {
            id: crypto.randomUUID(),
            name: 'Menivor',
            url: 'https://menivor.com?utm_source=vcpeer&utm_medium=launchboard&utm_campaign=seed_listing',
            pitch: 'Turn a product URL into ready-to-post video ads and reels — the free launch video every listing gets.',
            category: 'marketing',
            featured: false,
            featuredRequested: false,
            createdAt: now - 1000,
        },
    ];
}

function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        writeJsonFileAtomic(DATA_FILE, seedListings());
    }
}

function readAll() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        log.error('Failed to read launchboard data file, treating as empty', err);
        return [];
    }
}

function writeAll(listings) {
    writeJsonFileAtomic(DATA_FILE, listings);
}

/**
 * @returns {Array<object>} all listings, featured first, then newest first.
 */
function listAll() {
    return readAll()
        .slice()
        .sort((a, b) => {
            if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
}

function isValidUrl(input) {
    if (typeof input !== 'string' || input.length === 0 || input.length > URL_MAX) return false;
    try {
        const parsed = new URL(input);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        // Reject bare hostnames with no dot (e.g. "https://spa"). The WHATWG URL
        // parser happily accepts these as a valid origin, but no real public
        // product lives at a dotless host — this is always a truncated or
        // mistyped submission, and left live it's a dead link on the directory.
        // (Found in production: a real submission persisted as "https://spa".)
        return parsed.hostname.includes('.');
    } catch {
        return false;
    }
}

/**
 * @param {object} fields raw (already XSS-sanitized by the caller) submission fields
 * @returns {{errors: string[], cleanName: string, cleanUrl: string, cleanPitch: string, cleanCategory: string}}
 */
function validateSubmission({ name, url, pitch, category }) {
    const errors = [];
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const cleanPitch = typeof pitch === 'string' ? pitch.trim() : '';
    const cleanCategory = CATEGORIES.includes(category) ? category : 'other';

    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) {
        errors.push(`Product name must be ${NAME_MIN}-${NAME_MAX} characters.`);
    }
    if (!isValidUrl(cleanUrl)) {
        errors.push('Enter a valid http:// or https:// URL.');
    }
    if (cleanPitch.length < PITCH_MIN || cleanPitch.length > PITCH_MAX) {
        errors.push(`One-line pitch must be ${PITCH_MIN}-${PITCH_MAX} characters.`);
    }

    return { errors, cleanName, cleanUrl, cleanPitch, cleanCategory };
}

/**
 * @param {object} fields raw (already XSS-sanitized by the caller) submission fields
 * @returns {{listing: object}|{errors: string[]}|{error: string}}
 */
function create(fields) {
    const listings = readAll();
    if (listings.length >= MAX_LISTINGS) {
        return { error: 'Launchboard is full for now — please try again later.' };
    }

    const { errors, cleanName, cleanUrl, cleanPitch, cleanCategory } = validateSubmission(fields);
    if (errors.length > 0) return { errors };

    const listing = {
        id: crypto.randomUUID(),
        name: cleanName,
        url: cleanUrl,
        pitch: cleanPitch,
        category: cleanCategory,
        featured: false,
        featuredRequested: Boolean(fields.featuredRequested),
        createdAt: Date.now(),
    };

    listings.push(listing);
    writeAll(listings);
    return { listing };
}

function reset() {
    writeAll(seedListings());
}

module.exports = {
    CATEGORIES,
    DATA_FILE,
    listAll,
    create,
    isValidUrl,
    validateSubmission,
    reset,
};
