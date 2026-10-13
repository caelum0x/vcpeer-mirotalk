'use strict';

/**
 * "Send a link" sender flow: pick files → compose (delivery/expiry/email) →
 * upload (chunked, resumable) → verify sender email (if "Send by email") →
 * finalize → show the result (link/QR, or "sent" confirmation).
 */
import { bytesToSize, clampPercent } from './format.js';
import { renderFileRow, updateFileRowProgress, markFileRowComplete } from './file-list-ui.js';
import {
    getTransferConfig,
    createTransfer,
    finalizeTransfer,
    requestEmailVerification,
    confirmEmailVerification,
} from './transfer-api.js';
import { uploadAllChunked } from './transfer-upload.js';

const el = (id) => document.getElementById(id);

function parseRecipients(raw) {
    return String(raw || '')
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function showFormError(message) {
    const errEl = el('sendLinkFormError');
    errEl.textContent = message;
    errEl.hidden = !message;
}

/** Wires the "Send a link" panels. Call once at boot; a no-op until the user interacts with it. */
export function initLinkMode() {
    let pickedFiles = [];
    let delivery = 'link';

    getTransferConfig()
        .then((cfg) => {
            const capGb = (cfg.maxTransferBytes / (1024 * 1024 * 1024)).toFixed(1);
            el('sendLinkCapNotice').textContent = `or click to browse — up to ${capGb} GB per transfer`;
        })
        .catch(() => {
            /* keep the static default copy in the HTML */
        });

    function renderPickedFiles() {
        const list = el('sendLinkFileList');
        const totalBar = el('sendLinkTotalBar');
        const form = el('sendLinkForm');
        list.innerHTML = '';

        if (pickedFiles.length === 0) {
            list.hidden = true;
            totalBar.hidden = true;
            form.hidden = true;
            return;
        }

        for (const file of pickedFiles) {
            const row = renderFileRow({ id: file.__id, name: file.webkitRelativePath || file.name, size: file.size });
            list.appendChild(row);
        }
        list.hidden = false;

        const totalBytes = pickedFiles.reduce((sum, f) => sum + f.size, 0);
        el('sendLinkTotalBarText').textContent =
            `${pickedFiles.length} file${pickedFiles.length === 1 ? '' : 's'} · ${bytesToSize(totalBytes)}`;
        el('sendLinkTotalBarFill').style.width = '0%';
        totalBar.hidden = false;
        form.hidden = false;
        showFormError('');
    }

    function addFiles(fileList) {
        const incoming = Array.from(fileList).filter((f) => f.size > 0);
        for (const file of incoming) file.__id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        pickedFiles = [...pickedFiles, ...incoming];
        renderPickedFiles();
    }

    el('sendLinkFileInput').addEventListener('change', (e) => addFiles(e.target.files));
    el('sendLinkFolderInput').addEventListener('change', (e) => addFiles(e.target.files));
    el('sendLinkFolderBtn').addEventListener('click', () => el('sendLinkFolderInput').click());

    const dropzone = el('sendLinkDropzone');
    ['dragenter', 'dragover'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.add('is-dragover');
        })
    );
    ['dragleave', 'drop'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.remove('is-dragover');
        })
    );
    dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files?.length) addFiles(files);
    });

    document.querySelectorAll('.send-delivery-tabs .send-mode-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            delivery = btn.dataset.delivery;
            document.querySelectorAll('.send-delivery-tabs .send-mode-tab').forEach((b) => {
                b.classList.toggle('is-active', b === btn);
                b.setAttribute('aria-selected', String(b === btn));
            });
            el('sendLinkEmailFields').hidden = delivery !== 'email';
        });
    });

    el('sendLinkSubmitBtn').addEventListener('click', () => submit().catch((err) => showFormError(err.message)));

    async function submit() {
        showFormError('');
        if (pickedFiles.length === 0) return showFormError('Choose at least one file first.');

        const expiryDays = Number(el('sendLinkExpiry').value);
        const maxDownloadsRaw = el('sendLinkMaxDownloads').value;
        const maxDownloads = maxDownloadsRaw ? Number(maxDownloadsRaw) : null;

        const payloadFiles = pickedFiles.map((f) => ({
            name: f.webkitRelativePath || f.name,
            size: f.size,
            type: f.type || 'application/octet-stream',
        }));

        const payload = { files: payloadFiles, delivery, expiryDays, maxDownloads };
        let senderEmail = '';
        if (delivery === 'email') {
            const recipients = parseRecipients(el('sendLinkRecipients').value);
            senderEmail = el('sendLinkSenderEmail').value.trim();
            if (recipients.length === 0) return showFormError('Add at least one recipient email.');
            if (!senderEmail) return showFormError('Your email is required to verify you before sending.');
            payload.recipients = recipients;
            payload.senderEmail = senderEmail;
            payload.message = el('sendLinkMessage').value;
        }

        el('sendLinkSubmitBtn').disabled = true;
        let created;
        try {
            created = await createTransfer(payload);
        } catch (err) {
            el('sendLinkSubmitBtn').disabled = false;
            return showFormError(err.message);
        }

        await runUpload(created, payload, senderEmail);
    }

    async function runUpload(created, payload, senderEmail) {
        setPanel('upload');
        el('sendLinkUploadHeadline').textContent = 'Uploading…';
        const uploadList = el('sendLinkUploadList');
        uploadList.innerHTML = '';
        const samplesByFile = new Map();
        const fileByName = new Map(pickedFiles.map((f) => [f.webkitRelativePath || f.name, f]));

        for (const f of created.files) {
            uploadList.appendChild(
                renderFileRow({ id: f.fileId, name: f.name, size: fileByName.get(f.name)?.size || 0 })
            );
        }

        const uploadTargets = created.files.map((f) => ({ fileId: f.fileId, file: fileByName.get(f.name) }));

        try {
            await uploadAllChunked({
                transferId: created.id,
                files: uploadTargets,
                chunkBytes: created.chunkBytes,
                onTotalProgress: (sent, total) => {
                    const pct = clampPercent((sent / Math.max(total, 1)) * 100);
                    el('sendLinkUploadTotalFill').style.width = `${pct}%`;
                    el('sendLinkUploadTotalText').textContent =
                        `${pct.toFixed(0)}% · ${bytesToSize(sent)} / ${bytesToSize(total)}`;
                },
                onFileProgress: (fileId, sent, total) => {
                    if (!samplesByFile.has(fileId)) samplesByFile.set(fileId, []);
                    updateFileRowProgress(uploadList, fileId, sent, total, samplesByFile.get(fileId));
                    if (sent >= total)
                        markFileRowComplete(uploadList, fileId, { verified: null, fallbackLabel: 'Uploaded' });
                },
            });
        } catch (err) {
            el('sendLinkUploadHeadline').textContent = `Upload failed: ${err.message}`;
            return;
        }

        if (payload.delivery === 'email') {
            await startEmailVerification(created, senderEmail, payload.delivery);
        } else {
            await finalizeAndShowResult(created, payload.delivery);
        }
    }

    async function startEmailVerification(created, senderEmail, deliveryMode) {
        setPanel('verify');
        el('sendLinkVerifyText').textContent =
            `We sent a 6-digit code to ${senderEmail}. Enter it below to send your files.`;
        const verifyErrEl = el('sendLinkVerifyError');
        verifyErrEl.hidden = true;

        try {
            await requestEmailVerification(created.id, senderEmail);
        } catch (err) {
            verifyErrEl.textContent = err.message;
            verifyErrEl.hidden = false;
            return;
        }

        el('sendLinkVerifyBtn').onclick = async () => {
            const code = el('sendLinkVerifyCode').value.trim();
            el('sendLinkVerifyBtn').disabled = true;
            try {
                await confirmEmailVerification(created.id, senderEmail, code);
                await finalizeAndShowResult(created, deliveryMode);
            } catch (err) {
                verifyErrEl.textContent = err.message;
                verifyErrEl.hidden = false;
            } finally {
                el('sendLinkVerifyBtn').disabled = false;
            }
        };
    }

    async function finalizeAndShowResult(created, deliveryMode) {
        let result;
        try {
            result = await finalizeTransfer(created.id);
        } catch (err) {
            setPanel('verify');
            const verifyErrEl = el('sendLinkVerifyError');
            verifyErrEl.textContent = err.message;
            verifyErrEl.hidden = false;
            return;
        }

        setPanel('result');
        const isEmail = deliveryMode === 'email';
        el('sendLinkResultHeadline').textContent = isEmail ? 'Sent' : 'Your link is ready';
        el('sendLinkResultShareRow').hidden = isEmail;
        if (!isEmail) el('sendLinkResultUrl').value = result.shareUrl;
        el('sendLinkResultMeta').textContent = isEmail
            ? 'Your recipients have been emailed a download link.'
            : `Share this link — it expires per the settings you chose.`;
        const manageLink = el('sendLinkResultManageUrl');
        manageLink.href = result.manageUrl;
        manageLink.textContent = result.manageUrl;
    }

    el('sendLinkResultCopyBtn').addEventListener('click', async () => {
        const input = el('sendLinkResultUrl');
        try {
            await navigator.clipboard.writeText(input.value);
            const original = el('sendLinkResultCopyBtn').textContent;
            el('sendLinkResultCopyBtn').textContent = 'Copied';
            setTimeout(() => (el('sendLinkResultCopyBtn').textContent = original), 1500);
        } catch {
            input.select();
        }
    });

    const linkPanels = {
        compose: el('sendLinkComposePanel'),
        verify: el('sendLinkVerifyPanel'),
        upload: el('sendLinkUploadPanel'),
        result: el('sendLinkResultPanel'),
    };
    function setPanel(name) {
        for (const key of Object.keys(linkPanels)) linkPanels[key].hidden = key !== name;
        if (name !== 'compose') el('sendModeTabs').hidden = true;
    }
}
