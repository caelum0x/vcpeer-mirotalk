'use strict';

/**
 * "Send a link" download page: `/send?t=<transferId>`. Fetches public
 * metadata, renders the file list with cheap previews (image/video inline,
 * PDF via the browser's native viewer in an iframe) for small enough files,
 * offers a streamed "Download all (.zip)" plus per-file downloads, shows the
 * expiry/remaining-downloads line, and an abuse-report link.
 */
import { bytesToSize } from './format.js';
import { escapeHtml } from './file-list-ui.js';
import { getTransferMeta, downloadFileUrl, previewFileUrl, zipUrl, reportTransfer } from './transfer-api.js';

const el = (id) => document.getElementById(id);
const PREVIEWABLE_RE = /^(image\/|video\/)/;

function formatExpiry(expiresAt) {
    const ms = expiresAt - Date.now();
    if (ms <= 0) return 'expired';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days >= 1) return `Expires in ${days} day${days === 1 ? '' : 's'}`;
    const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
    return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}

function renderPreview(transferId, file) {
    if (file.size > file.previewMaxBytes) return '';
    if (PREVIEWABLE_RE.test(file.type)) {
        const url = previewFileUrl(transferId, file.fileId);
        if (file.type.startsWith('image/')) {
            return `<img class="send-link-preview" src="${url}" alt="Preview of ${escapeHtml(file.name)}" loading="lazy" />`;
        }
        return `<video class="send-link-preview" src="${url}" controls preload="metadata"></video>`;
    }
    if (file.type === 'application/pdf') {
        return `<iframe class="send-link-preview send-link-preview-pdf" src="${previewFileUrl(transferId, file.fileId)}" title="Preview of ${escapeHtml(file.name)}"></iframe>`;
    }
    return '';
}

/** @param {string} transferId */
export async function renderDownloadPage(transferId) {
    const panel = el('sendLinkDownloadPanel');
    panel.hidden = false;

    let meta;
    try {
        meta = await getTransferMeta(transferId);
    } catch (err) {
        el('sendLinkDownloadHeadline').textContent = 'This link is unavailable';
        el('sendLinkDownloadMeta').textContent = err.message;
        el('sendLinkDownloadAllBtn').hidden = true;
        return;
    }

    el('sendLinkDownloadHeadline').textContent =
        meta.files.length === 1 ? meta.files[0].name : `${meta.files.length} files, ${bytesToSize(meta.totalBytes)}`;

    const remaining =
        meta.maxDownloads != null ? `${Math.max(0, meta.maxDownloads - meta.downloadCount)} downloads left · ` : '';
    el('sendLinkDownloadMeta').textContent = `${remaining}${formatExpiry(meta.expiresAt)}`;

    if (meta.message) {
        el('sendLinkDownloadMessage').textContent = meta.message;
        el('sendLinkDownloadMessage').hidden = false;
    }

    const list = el('sendLinkDownloadList');
    list.innerHTML = meta.files
        .map((file) => {
            const previewHtml = renderPreview(transferId, { ...file, previewMaxBytes: meta.previewMaxBytes });
            return `
                <li class="send-link-file-row">
                    ${previewHtml}
                    <div class="send-file-meta">
                        <span class="send-file-name">${escapeHtml(file.name)}</span>
                        <span class="send-file-size">${bytesToSize(file.size)}</span>
                    </div>
                    <a class="button button-secondary br-6" href="${downloadFileUrl(transferId, file.fileId)}" download="${escapeHtml(file.name)}">Download</a>
                </li>
            `;
        })
        .join('');

    el('sendLinkDownloadAllBtn').hidden = meta.files.length < 2;
    el('sendLinkDownloadAllBtn').addEventListener('click', () => {
        window.location.href = zipUrl(transferId);
    });

    el('sendLinkReportBtn').addEventListener('click', async () => {
        el('sendLinkReportBtn').disabled = true;
        el('sendLinkReportBtn').textContent = 'Reported';
        try {
            await reportTransfer(transferId, 'reported from download page');
        } catch {
            // best-effort — the button already reflects the attempt to the user
        }
    });
}
