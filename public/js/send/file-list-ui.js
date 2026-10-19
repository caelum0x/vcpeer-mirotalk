'use strict';

/**
 * Shared file-list row rendering, used by the live P2P "Send now" flow
 * (app.js) and by "Send a link" (link-sender.js / link-download.js) so both
 * modes render identical `.send-file-row` markup/behavior.
 */
import { bytesToSize, formatSpeed, formatEta, clampPercent, estimateThroughput } from './format.js';

/**
 * @param {{ id: string, name: string, size: number }} file
 * @returns {HTMLLIElement}
 */
export function renderFileRow(file) {
    const li = document.createElement('li');
    li.className = 'send-file-row';
    li.dataset.fileId = file.id;
    li.innerHTML = `
        <span class="send-file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z" stroke-linejoin="round"/><path d="M15 2v5h5" stroke-linejoin="round"/></svg>
        </span>
        <span class="send-file-meta">
            <span class="send-file-name">${escapeHtml(file.name)}</span>
            <span class="send-file-size">${bytesToSize(file.size)}</span>
            <span class="send-file-progress-track"><span class="send-file-progress-bar"></span></span>
            <span class="send-file-stat"></span>
        </span>
    `;
    return li;
}

/** @param {unknown} str @returns {string} */
export function escapeHtml(str) {
    return String(str).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}

/**
 * @param {HTMLElement} list
 * @param {string} fileId
 * @param {number} sentOrReceivedBytes
 * @param {number} totalBytes
 * @param {Array<{bytes:number, atMs:number}>} samples mutated in place (rolling throughput window)
 */
export function updateFileRowProgress(list, fileId, sentOrReceivedBytes, totalBytes, samples) {
    const row = list.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
    if (!row) return;
    const pct = clampPercent((sentOrReceivedBytes / Math.max(totalBytes, 1)) * 100);
    row.querySelector('.send-file-progress-bar').style.width = `${pct}%`;

    const now = Date.now();
    samples.push({ bytes: sentOrReceivedBytes, atMs: now });
    if (samples.length > 20) samples.shift();
    const throughput = estimateThroughput(samples);
    const remaining = totalBytes - sentOrReceivedBytes;

    row.querySelector('.send-file-stat').textContent =
        `${pct.toFixed(0)}% · ${formatSpeed(throughput)} · ${formatEta(remaining, throughput)} left`;
}

/**
 * @param {HTMLElement} list
 * @param {string} fileId
 * @param {{ verified?: boolean|null, blob?: Blob, name?: string, fallbackLabel?: string }} [options]
 */
export function markFileRowComplete(list, fileId, { verified, blob, name, fallbackLabel = 'Received' } = {}) {
    const row = list.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
    if (!row) return;
    row.querySelector('.send-file-progress-bar').style.width = '100%';
    const statEl = row.querySelector('.send-file-stat');

    if (verified === true) {
        statEl.innerHTML = '<span class="send-file-badge send-file-badge-verified">Verified</span>';
    } else if (verified === false) {
        statEl.innerHTML = '<span class="send-file-badge send-file-badge-unverified">Hash mismatch</span>';
    } else {
        statEl.textContent = fallbackLabel;
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.className = 'button button-secondary br-6 send-file-save-btn mt-8';
        link.textContent = `Save ${name}`;
        row.appendChild(link);
    }
}
