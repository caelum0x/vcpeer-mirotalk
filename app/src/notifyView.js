'use strict';

const fs = require('fs');
const path = require('path');
const he = require('he');

const TEMPLATE_PATH = path.join(__dirname, '../../', 'public/views/notify.html');

// Template read fresh on first use, then cached — the template itself never
// changes per-request, only the data substituted into it does.
let templateCache = null;
function readTemplate() {
    if (!templateCache) {
        templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    }
    return templateCache;
}

function escapeHtml(value) {
    return he.encode(String(value == null ? '' : value), { useNamedReferences: false });
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

function renderMessage(message, messageType) {
    if (!message) return '';
    const cls = messageType === 'error' ? 'notify-message-error' : 'notify-message-success';
    return `<div class="notify-message ${cls}" role="status">${escapeHtml(message)}</div>`;
}

function renderSignupCount(count) {
    if (!count || count < 1) return '';
    const plural = count === 1 ? 'person' : 'people';
    return ` ${count} ${plural} already signed up.`;
}

/**
 * @param {object} opts
 * @param {number} [opts.signupCount]
 * @param {string} [opts.message]
 * @param {'success'|'error'} [opts.messageType]
 * @param {string} [opts.emailValue] sticky form value after a failed submit
 * @returns {string} full HTML page
 */
function renderNotifyPage({ signupCount, message, messageType, emailValue } = {}) {
    return readTemplate()
        .replace('<!--SIGNUP_COUNT-->', renderSignupCount(signupCount))
        .replace('<!--TOP_MESSAGE-->', renderMessage(message, messageType))
        .replace('<!--FORM_EMAIL_VALUE-->', escapeAttr(emailValue));
}

function invalidateTemplateCache() {
    templateCache = null;
}

module.exports = { renderNotifyPage, invalidateTemplateCache };
