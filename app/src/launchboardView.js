'use strict';

const fs = require('fs');
const path = require('path');
const he = require('he');

const { CATEGORIES } = require('./launchboard');

const TEMPLATE_PATH = path.join(__dirname, '../../', 'public/views/launchboard.html');

const CATEGORY_LABELS = {
    saas: 'SaaS',
    'dev-tools': 'Dev tools',
    ai: 'AI',
    marketing: 'Marketing',
    fintech: 'Fintech',
    productivity: 'Productivity',
    other: 'Other',
};

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

function renderCategoryOptions(selected) {
    return CATEGORIES.map((value) => {
        const label = CATEGORY_LABELS[value] || value;
        const isSelected = value === selected ? ' selected' : '';
        return `<option value="${escapeAttr(value)}"${isSelected}>${escapeHtml(label)}</option>`;
    }).join('\n');
}

function renderListingCard(listing) {
    const featuredBadge = listing.featured
        ? '<span class="launchboard-badge launchboard-badge-featured">Featured</span>'
        : listing.featuredRequested
          ? '<span class="launchboard-badge launchboard-badge-pending">Featured requested</span>'
          : '';
    const categoryLabel = CATEGORY_LABELS[listing.category] || 'Other';

    return `
        <article class="launchboard-card">
            <div class="launchboard-card-head">
                <h3 class="m-0"><a href="${escapeAttr(listing.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(listing.name)}</a></h3>
                ${featuredBadge}
            </div>
            <p class="launchboard-card-category text-xxs">${escapeHtml(categoryLabel)}</p>
            <p class="launchboard-card-pitch text-sm">${escapeHtml(listing.pitch)}</p>
        </article>`;
}

function renderListings(listings) {
    if (listings.length === 0) {
        return '<p class="text-sm">No listings yet — be the first.</p>';
    }
    return listings.map(renderListingCard).join('\n');
}

function renderMessage(message, messageType) {
    if (!message) return '';
    const cls = messageType === 'error' ? 'launchboard-message-error' : 'launchboard-message-success';
    return `<div class="launchboard-message ${cls}" role="status">${escapeHtml(message)}</div>`;
}

function renderErrors(errors) {
    if (!errors || errors.length === 0) return '';
    const items = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    return `<ul class="launchboard-form-errors" role="alert">${items}</ul>`;
}

/**
 * @param {object} opts
 * @param {Array<object>} opts.listings
 * @param {string} [opts.message]
 * @param {'success'|'error'} [opts.messageType]
 * @param {string[]} [opts.errors]
 * @param {{name?: string, url?: string, pitch?: string, category?: string}} [opts.values] sticky form values after a failed submit
 * @returns {string} full HTML page
 */
function renderLaunchboardPage({ listings, message, messageType, errors, values } = {}) {
    const safeListings = Array.isArray(listings) ? listings : [];
    const formValues = values || {};

    return readTemplate()
        .replace('<!--LISTING_COUNT-->', String(safeListings.length))
        .replace('<!--TOP_MESSAGE-->', renderMessage(message, messageType))
        .replace('<!--FORM_ERRORS-->', renderErrors(errors))
        .replace('<!--FORM_NAME_VALUE-->', escapeAttr(formValues.name))
        .replace('<!--FORM_URL_VALUE-->', escapeAttr(formValues.url))
        .replace('<!--FORM_PITCH_VALUE-->', escapeHtml(formValues.pitch))
        .replace('<!--CATEGORY_OPTIONS-->', renderCategoryOptions(formValues.category))
        .replace('<!--LISTINGS-->', renderListings(safeListings));
}

function invalidateTemplateCache() {
    templateCache = null;
}

module.exports = { renderLaunchboardPage, invalidateTemplateCache };
