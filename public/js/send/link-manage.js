'use strict';

/**
 * "Send a link" manage page: `/send?m=<manageToken>`. Shows download count
 * and lets the sender delete the transfer early.
 */
import { bytesToSize } from './format.js';
import { escapeHtml } from './file-list-ui.js';
import { getManageMeta, deleteTransfer } from './transfer-api.js';

const el = (id) => document.getElementById(id);

/** @param {string} manageToken */
export async function renderManagePage(manageToken) {
    const panel = el('sendLinkManagePanel');
    panel.hidden = false;

    let meta;
    try {
        meta = await getManageMeta(manageToken);
    } catch (err) {
        el('sendLinkManageStatus').textContent = err.message;
        return;
    }

    const limitText = meta.maxDownloads != null ? ` / ${meta.maxDownloads}` : '';
    el('sendLinkManageStatus').textContent =
        `${meta.downloadCount}${limitText} downloads · ${meta.status === 'ready' ? 'active' : meta.status}` +
        (meta.reports > 0 ? ` · ${meta.reports} abuse report${meta.reports === 1 ? '' : 's'}` : '');

    const list = el('sendLinkManageList');
    list.innerHTML = meta.files
        .map(
            (file) => `
                <li class="send-file-row">
                    <span class="send-file-meta">
                        <span class="send-file-name">${escapeHtml(file.name)}</span>
                        <span class="send-file-size">${bytesToSize(file.size)}</span>
                    </span>
                </li>
            `
        )
        .join('');

    el('sendLinkManageDeleteBtn').addEventListener('click', async () => {
        if (!window.confirm('Delete this transfer now? This cannot be undone.')) return;
        el('sendLinkManageDeleteBtn').disabled = true;
        try {
            await deleteTransfer(manageToken);
            el('sendLinkManageStatus').textContent = 'Deleted.';
            list.innerHTML = '';
            el('sendLinkManageDeleteBtn').hidden = true;
        } catch (err) {
            el('sendLinkManageStatus').textContent = err.message;
            el('sendLinkManageDeleteBtn').disabled = false;
        }
    });
}
