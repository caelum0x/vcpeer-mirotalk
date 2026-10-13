'use strict';

/**
 * Input validation for VCPeer Send's "Send a link" create-transfer request.
 * Pure functions, no Express/req coupling, so they're directly unit testable.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MAX_DOWNLOADS = 10000;

/** @param {unknown} value @returns {boolean} */
function isValidEmail(value) {
    return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** @param {unknown} value @param {number[]} allowedDays @returns {boolean} */
function isValidExpiryDays(value, allowedDays) {
    return allowedDays.includes(Number(value));
}

/**
 * @param {unknown} value
 * @returns {{ valid: boolean, value: number|null }} null means "no limit"
 */
function parseMaxDownloads(value) {
    if (value == null || value === '') return { valid: true, value: null };
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MAX_DOWNLOADS) return { valid: false, value: null };
    return { valid: true, value: n };
}

/**
 * @param {unknown} delivery
 * @returns {boolean}
 */
function isValidDelivery(delivery) {
    return delivery === 'link' || delivery === 'email';
}

/**
 * Dedupes, trims, lower-cases, validates format, and caps the recipient list.
 * @param {unknown} recipients
 * @returns {{ valid: boolean, recipients: string[], reason?: string }}
 */
function sanitizeRecipients(recipients) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return { valid: false, recipients: [], reason: 'at_least_one_recipient_required' };
    }
    if (recipients.length > MAX_RECIPIENTS) {
        return { valid: false, recipients: [], reason: `at_most_${MAX_RECIPIENTS}_recipients` };
    }
    const seen = new Set();
    const cleaned = [];
    for (const raw of recipients) {
        if (typeof raw !== 'string') return { valid: false, recipients: [], reason: 'invalid_recipient' };
        const email = raw.trim().toLowerCase();
        if (!isValidEmail(email)) return { valid: false, recipients: [], reason: `invalid_email: ${raw}` };
        if (!seen.has(email)) {
            seen.add(email);
            cleaned.push(email);
        }
    }
    return { valid: true, recipients: cleaned };
}

/** @param {unknown} message @returns {string} truncated to MAX_MESSAGE_LENGTH */
function clampMessage(message) {
    if (typeof message !== 'string') return '';
    return message.slice(0, MAX_MESSAGE_LENGTH);
}

module.exports = {
    MAX_RECIPIENTS,
    MAX_MESSAGE_LENGTH,
    MAX_MAX_DOWNLOADS,
    isValidEmail,
    isValidExpiryDays,
    parseMaxDownloads,
    isValidDelivery,
    sanitizeRecipients,
    clampMessage,
};
