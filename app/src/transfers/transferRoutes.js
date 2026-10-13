'use strict';

const crypto = require('crypto');
const express = require('express');
const { ZipArchive } = require('archiver');
const he = require('he');

const checkXSS = require('../xss');
const {
    transferCreateLimiter,
    transferChunkLimiter,
    transferEmailVerifyLimiter,
    transferReportLimiter,
} = require('../middleware/rateLimiter');
const { generateTransferKey, encryptChunk } = require('./cryptoStream');
const { createDecryptedReadStream } = require('./decryptedRead');
const { isBlockedFileType } = require('./fileTypeBlocklist');
const {
    MAX_RECIPIENTS,
    isValidEmail,
    isValidExpiryDays,
    parseMaxDownloads,
    isValidDelivery,
    sanitizeRecipients,
    clampMessage,
} = require('./validators');

const PREVIEWABLE_MIME_RE = /^(image\/|video\/)/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the `/api/v1/transfers*` router for VCPeer Send's "Send a link"
 * (WeTransfer-style upload-and-share) mode.
 *
 * @param {object} deps
 * @param {object} deps.config `config.transfers` (see config.template.js)
 * @param {import('./transferStore').TransferStore} deps.store
 * @param {import('../storage/StorageInterface')} deps.storage
 * @param {import('./quota').QuotaTracker} deps.ipQuota bytes/day/IP
 * @param {import('./quota').QuotaTracker} deps.emailQuota transfers/day/sender-email
 * @param {import('./emailVerification').EmailVerificationStore} deps.emailVerification
 * @param {(msg: object) => Promise<{sent:boolean,id?:string,reason?:string}>} deps.sendMail
 * @param {import('../logs')} deps.log
 * @returns {express.Router}
 */
function createTransferRoutes({ config, store, storage, ipQuota, emailQuota, emailVerification, sendMail, log }) {
    const router = express.Router();

    const originOf = (req) => `${req.protocol}://${req.get('host')}`;
    const keyOf = (transferId, fileId) => `${transferId}/${fileId}`;

    function publicFile(file) {
        return { fileId: file.fileId, name: file.name, size: file.size, type: file.type };
    }

    function isExpiredOrGone(record, now = Date.now()) {
        if (!record || record.status === 'deleted') return true;
        if (record.status === 'ready' && record.expiresAt && record.expiresAt <= now) return true;
        if (record.status === 'ready' && record.maxDownloads != null && record.downloadCount >= record.maxDownloads)
            return true;
        return false;
    }

    // Public config so the client never hardcodes limits that could drift from the server.
    router.get('/config', (req, res) => {
        res.json({
            chunkBytes: config.chunkBytes,
            maxTransferBytes: config.maxTransferBytes,
            defaultExpiryDays: config.defaultExpiryDays,
            allowedExpiryDays: config.allowedExpiryDays,
            previewMaxBytes: config.previewMaxBytes,
            maxRecipients: MAX_RECIPIENTS,
        });
    });

    router.post('/', transferCreateLimiter, express.json(), (req, res) => {
        const body = checkXSS(req.body || {});
        const { files, delivery, message } = body;
        let { expiryDays, maxDownloads, recipients, senderEmail } = body;

        if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ message: 'At least one file is required' });
        }
        if (files.length > 200) {
            return res.status(400).json({ message: 'At most 200 files per transfer' });
        }
        for (const f of files) {
            if (!f || typeof f.name !== 'string' || !f.name.trim() || !Number.isFinite(f.size) || f.size <= 0) {
                return res.status(400).json({ message: 'Each file needs a name and a positive size' });
            }
        }

        expiryDays = expiryDays == null ? config.defaultExpiryDays : Number(expiryDays);
        if (!isValidExpiryDays(expiryDays, config.allowedExpiryDays)) {
            return res
                .status(400)
                .json({ message: `expiryDays must be one of ${config.allowedExpiryDays.join(', ')}` });
        }

        const maxDownloadsResult = parseMaxDownloads(maxDownloads);
        if (!maxDownloadsResult.valid) {
            return res.status(400).json({ message: 'maxDownloads must be a positive integer' });
        }

        if (!isValidDelivery(delivery)) {
            return res.status(400).json({ message: "delivery must be 'link' or 'email'" });
        }

        let cleanRecipients = [];
        let cleanMessage = '';
        if (delivery === 'email') {
            const recipientResult = sanitizeRecipients(recipients);
            if (!recipientResult.valid) {
                return res.status(400).json({ message: `Invalid recipients: ${recipientResult.reason}` });
            }
            cleanRecipients = recipientResult.recipients;

            if (!isValidEmail(senderEmail)) {
                return res.status(400).json({ message: 'A valid sender email is required for "Send by email"' });
            }
            senderEmail = senderEmail.trim().toLowerCase();

            const blocked = files.map((f) => f.name).filter((name) => isBlockedFileType(name));
            if (blocked.length) {
                return res
                    .status(400)
                    .json({ message: `These file types can't be sent by email: ${blocked.join(', ')}` });
            }
            cleanMessage = clampMessage(message);
        } else {
            senderEmail = null;
        }

        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        if (totalBytes > config.maxTransferBytes) {
            return res.status(413).json({
                message: `Transfer exceeds the ${(config.maxTransferBytes / (1024 * 1024 * 1024)).toFixed(1)} GiB cap for "Send a link"`,
            });
        }

        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const quotaResult = ipQuota.consume(ip, totalBytes);
        if (!quotaResult.allowed) {
            return res
                .status(429)
                .json({ message: 'Daily upload quota for this network exceeded. Please try again tomorrow.' });
        }

        const fileRecords = files.map((f) => ({
            fileId: crypto.randomBytes(8).toString('hex'),
            name: String(f.name).slice(0, 500),
            size: f.size,
            type: typeof f.type === 'string' ? f.type.slice(0, 100) : 'application/octet-stream',
            totalChunks: Math.ceil(f.size / config.chunkBytes),
        }));

        const record = store.create({
            delivery,
            senderEmail,
            senderEmailVerified: false,
            recipients: cleanRecipients,
            message: cleanMessage,
            maxDownloads: maxDownloadsResult.value,
            expiresAt: Date.now() + expiryDays * DAY_MS,
            manageToken: crypto.randomBytes(16).toString('hex'),
            encKeyB64: generateTransferKey().toString('base64'),
            totalBytes,
            files: fileRecords,
            ip,
        });

        res.status(201).json({
            id: record.id,
            manageToken: record.manageToken,
            manageUrl: `${originOf(req)}/send?m=${record.manageToken}`,
            chunkBytes: config.chunkBytes,
            files: fileRecords.map((f) => ({ fileId: f.fileId, name: f.name, totalChunks: f.totalChunks })),
        });
    });

    router.get('/:id/files/:fileId/status', (req, res) => {
        const record = store.get(req.params.id);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });
        const file = record.files.find((f) => f.fileId === req.params.fileId);
        if (!file) return res.status(404).json({ message: 'Not found' });

        storage
            .listParts(keyOf(record.id, file.fileId))
            .then((parts) => res.json({ uploadedParts: parts.map((p) => p.partNumber), totalChunks: file.totalChunks }))
            .catch((err) => {
                log.error('status: listParts failed', err.message);
                res.status(500).json({ message: 'Could not read upload status' });
            });
    });

    router.put(
        '/:id/files/:fileId/chunks/:partNumber',
        transferChunkLimiter,
        express.raw({ type: '*/*', limit: config.chunkBytes + 1024 * 1024 }),
        async (req, res) => {
            const record = store.get(req.params.id);
            if (!record || record.status !== 'uploading') {
                return res.status(404).json({ message: 'Transfer not found or already finalized' });
            }
            const file = record.files.find((f) => f.fileId === req.params.fileId);
            if (!file) return res.status(404).json({ message: 'File not found' });

            const partNumber = Number(req.params.partNumber);
            if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > file.totalChunks) {
                return res.status(400).json({ message: 'Invalid chunk index' });
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ message: 'Empty chunk body' });
            }
            const expectedSize = Math.min(config.chunkBytes, file.size - (partNumber - 1) * config.chunkBytes);
            if (req.body.length !== expectedSize) {
                return res.status(400).json({
                    message: `Chunk ${partNumber} is ${req.body.length} bytes, expected ${expectedSize}`,
                });
            }

            try {
                const keyBuf = Buffer.from(record.encKeyB64, 'base64');
                const ciphertext = encryptChunk(keyBuf, file.fileId, partNumber, req.body);
                await storage.putPart(keyOf(record.id, file.fileId), partNumber, ciphertext);
                res.json({ partNumber, received: true });
            } catch (err) {
                log.error('chunk upload failed', err.message);
                res.status(500).json({ message: 'Chunk upload failed, please retry' });
            }
        }
    );

    router.post('/:id/verify-email/request', transferEmailVerifyLimiter, express.json(), async (req, res) => {
        const { email } = checkXSS(req.body || {});
        const record = store.get(req.params.id);
        if (!record || record.status !== 'uploading') return res.status(404).json({ message: 'Transfer not found' });
        if (record.delivery !== 'email')
            return res.status(400).json({ message: 'This transfer is not using email delivery' });
        if (!isValidEmail(email)) return res.status(400).json({ message: 'Invalid email address' });

        const code = emailVerification.createCode(record.id, email);
        const result = await sendMail({
            to: [email],
            subject: 'Your VCPeer Send verification code',
            text: `Your verification code is ${code}. It expires in ${Math.round(config.emailVerifyCodeTtlMs / 60000)} minutes.`,
            html: `<p>Your VCPeer Send verification code is <strong>${code}</strong>.</p><p>It expires in ${Math.round(config.emailVerifyCodeTtlMs / 60000)} minutes. If you didn't request this, you can ignore this email.</p>`,
        });
        if (!result.sent) {
            return res
                .status(503)
                .json({ message: 'Email delivery is not available right now. Try "Get a link" instead.' });
        }
        store.update(record.id, (t) => ({ ...t, senderEmail: email.trim().toLowerCase() }));
        res.json({ sent: true });
    });

    router.post('/:id/verify-email/confirm', transferEmailVerifyLimiter, express.json(), (req, res) => {
        const { email, code } = checkXSS(req.body || {});
        const record = store.get(req.params.id);
        if (!record) return res.status(404).json({ message: 'Transfer not found' });
        if (!isValidEmail(email) || typeof code !== 'string') {
            return res.status(400).json({ message: 'Invalid email or code' });
        }
        const result = emailVerification.verify(record.id, email, code);
        if (!result.valid) return res.status(400).json({ message: 'Invalid or expired code', reason: result.reason });
        store.update(record.id, (t) => ({ ...t, senderEmailVerified: true }));
        res.json({ verified: true });
    });

    router.post('/:id/finalize', express.json(), async (req, res) => {
        const record = store.get(req.params.id);
        if (!record || record.status !== 'uploading') {
            return res.status(404).json({ message: 'Transfer not found or already finalized' });
        }

        for (const file of record.files) {
            // eslint-disable-next-line no-await-in-loop -- small file counts per transfer
            const parts = await storage.listParts(keyOf(record.id, file.fileId));
            const uploadedSize = parts.reduce((sum, p) => sum + p.size - 16, 0); // minus GCM auth tag per part
            if (parts.length !== file.totalChunks || uploadedSize !== file.size) {
                return res.status(409).json({
                    message: `"${file.name}" is incomplete (${parts.length}/${file.totalChunks} chunks). Resume the upload and retry.`,
                });
            }
        }

        if (record.delivery === 'email') {
            if (!record.senderEmailVerified) {
                return res.status(403).json({ message: 'Verify your sender email before sending' });
            }
            const quotaResult = emailQuota.consume(record.senderEmail, 1);
            if (!quotaResult.allowed) {
                return res.status(429).json({ message: 'Daily email-send limit reached for this address.' });
            }
        }

        const updated = store.update(record.id, (t) => ({ ...t, status: 'ready' }));
        const shareUrl = `${originOf(req)}/send?t=${record.id}`;

        if (record.delivery === 'email') {
            const fileList = record.files.map((f) => `<li>${he.encode(f.name)}</li>`).join('');
            const messageHtml = record.message ? `<p>${he.encode(record.message)}</p>` : '';
            await sendMail({
                to: record.recipients,
                subject: `${he.encode(record.senderEmail)} sent you files via VCPeer Send`,
                html:
                    `<p><strong>${he.encode(record.senderEmail)}</strong> sent you ${record.files.length} file(s):</p>` +
                    `<ul>${fileList}</ul>${messageHtml}` +
                    `<p><a href="${shareUrl}">Download your files</a> (expires ${new Date(record.expiresAt).toUTCString()})</p>`,
                text: `${record.senderEmail} sent you files via VCPeer Send: ${shareUrl}`,
                replyTo: record.senderEmail,
            });
        }

        res.json({
            id: updated.id,
            status: 'ready',
            shareUrl,
            manageUrl: `${originOf(req)}/send?m=${updated.manageToken}`,
        });
    });

    router.get('/:id', (req, res) => {
        const record = store.get(req.params.id);
        if (isExpiredOrGone(record) || record.status !== 'ready') {
            return res
                .status(404)
                .json({ message: 'This link is invalid, expired, or has reached its download limit.' });
        }
        res.json({
            id: record.id,
            files: record.files.map(publicFile),
            totalBytes: record.totalBytes,
            expiresAt: record.expiresAt,
            maxDownloads: record.maxDownloads,
            downloadCount: record.downloadCount,
            message: record.message || '',
            previewMaxBytes: config.previewMaxBytes,
        });
    });

    router.get('/:id/files/:fileId/preview', async (req, res) => {
        const record = store.get(req.params.id);
        if (isExpiredOrGone(record) || record.status !== 'ready') return res.status(404).end();
        const file = record.files.find((f) => f.fileId === req.params.fileId);
        if (!file) return res.status(404).end();
        const isPreviewableType = PREVIEWABLE_MIME_RE.test(file.type) || file.type === 'application/pdf';
        if (!isPreviewableType || file.size > config.previewMaxBytes) return res.status(404).end();

        try {
            const parts = await storage.listParts(keyOf(record.id, file.fileId));
            const keyBuf = Buffer.from(record.encKeyB64, 'base64');
            res.setHeader('Content-Type', file.type);
            res.setHeader('Content-Length', String(file.size));
            res.setHeader('Cache-Control', 'private, max-age=60');
            const stream = createDecryptedReadStream({
                storage,
                key: keyOf(record.id, file.fileId),
                fileId: file.fileId,
                keyBuf,
                parts,
            });
            stream.on('error', (err) => {
                log.error('preview stream failed', err.message);
                if (!res.headersSent) res.status(500);
                res.end();
            });
            stream.pipe(res);
        } catch (err) {
            log.error('preview failed', err.message);
            res.status(500).end();
        }
    });

    router.get('/:id/files/:fileId/download', async (req, res) => {
        const record = store.get(req.params.id);
        if (isExpiredOrGone(record) || record.status !== 'ready') {
            return res
                .status(404)
                .json({ message: 'This link is invalid, expired, or has reached its download limit.' });
        }
        const file = record.files.find((f) => f.fileId === req.params.fileId);
        if (!file) return res.status(404).json({ message: 'File not found' });

        const gate = gateDownload(store, record.id);
        if (!gate.allowed) return res.status(410).json({ message: 'Download limit reached for this transfer.' });

        if (gate.shouldNotifyFirstDownload) notifyFirstDownload(record, sendMail, log);

        try {
            const parts = await storage.listParts(keyOf(record.id, file.fileId));
            const keyBuf = Buffer.from(record.encKeyB64, 'base64');
            res.setHeader('Content-Type', file.type || 'application/octet-stream');
            res.setHeader('Content-Length', String(file.size));
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
            const stream = createDecryptedReadStream({
                storage,
                key: keyOf(record.id, file.fileId),
                fileId: file.fileId,
                keyBuf,
                parts,
            });
            stream.on('error', (err) => {
                log.error('download stream failed', err.message);
                if (!res.headersSent) res.status(500);
                res.end();
            });
            stream.pipe(res);
        } catch (err) {
            log.error('download failed', err.message);
            res.status(500).json({ message: 'Download failed, please retry' });
        }
    });

    router.get('/:id/zip', async (req, res) => {
        const record = store.get(req.params.id);
        if (isExpiredOrGone(record) || record.status !== 'ready') {
            return res
                .status(404)
                .json({ message: 'This link is invalid, expired, or has reached its download limit.' });
        }

        const gate = gateDownload(store, record.id);
        if (!gate.allowed) return res.status(410).json({ message: 'Download limit reached for this transfer.' });
        if (gate.shouldNotifyFirstDownload) notifyFirstDownload(record, sendMail, log);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="vcpeer-send-${record.id}.zip"`);

        const archive = new ZipArchive({ zlib: { level: 6 } });
        archive.on('error', (err) => {
            log.error('zip stream failed', err.message);
            if (!res.headersSent) res.status(500);
            res.end();
        });
        archive.pipe(res);

        const keyBuf = Buffer.from(record.encKeyB64, 'base64');
        for (const file of record.files) {
            // eslint-disable-next-line no-await-in-loop -- archiver appends must be sequenced with their stream
            const parts = await storage.listParts(keyOf(record.id, file.fileId));
            const stream = createDecryptedReadStream({
                storage,
                key: keyOf(record.id, file.fileId),
                fileId: file.fileId,
                keyBuf,
                parts,
            });
            archive.append(stream, { name: file.name });
        }
        archive.finalize();
    });

    router.get('/manage/:manageToken', (req, res) => {
        const record = store.findByManageToken(req.params.manageToken);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });
        res.json({
            id: record.id,
            status: record.status,
            delivery: record.delivery,
            files: record.files.map(publicFile),
            totalBytes: record.totalBytes,
            expiresAt: record.expiresAt,
            maxDownloads: record.maxDownloads,
            downloadCount: record.downloadCount,
            reports: record.reports,
            recipients: record.delivery === 'email' ? record.recipients : [],
        });
    });

    router.delete('/manage/:manageToken', async (req, res) => {
        const record = store.findByManageToken(req.params.manageToken);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });
        for (const file of record.files) {
            // eslint-disable-next-line no-await-in-loop
            await storage
                .deleteAll(keyOf(record.id, file.fileId))
                .catch((err) => log.error('manual delete failed', err.message));
        }
        store.remove(record.id);
        res.json({ deleted: true });
    });

    router.post('/:id/report', transferReportLimiter, express.json(), (req, res) => {
        const { reason } = checkXSS(req.body || {});
        const record = store.get(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        store.update(record.id, (t) => ({ ...t, reports: (t.reports || 0) + 1 }));
        log.warn('abuse report received', { transferId: record.id, reason: String(reason || '').slice(0, 300) });
        res.json({ received: true });
    });

    return router;
}

/**
 * Atomically checks-and-increments downloadCount against maxDownloads, so two
 * concurrent download requests can't both slip in under a limit of 1. Also
 * flips `firstDownloadNotified` in the same update so the "your transfer was
 * downloaded" email can never fire twice, even under concurrent requests.
 * @param {import('./transferStore').TransferStore} store
 * @param {string} id
 * @returns {{ allowed: boolean, shouldNotifyFirstDownload: boolean }}
 */
function gateDownload(store, id) {
    let allowed = true;
    let shouldNotifyFirstDownload = false;
    store.update(id, (t) => {
        if (t.maxDownloads != null && t.downloadCount >= t.maxDownloads) {
            allowed = false;
            return t;
        }
        shouldNotifyFirstDownload =
            t.downloadCount === 0 && t.delivery === 'email' && !!t.senderEmail && !t.firstDownloadNotified;
        return {
            ...t,
            downloadCount: t.downloadCount + 1,
            firstDownloadNotified: t.firstDownloadNotified || shouldNotifyFirstDownload,
        };
    });
    return { allowed, shouldNotifyFirstDownload };
}

function notifyFirstDownload(record, sendMail, log) {
    sendMail({
        to: [record.senderEmail],
        subject: 'Your VCPeer Send transfer was just downloaded',
        text: `Someone just started downloading the files you sent via VCPeer Send.`,
        html: `<p>Someone just started downloading the files you sent via VCPeer Send.</p>`,
    }).catch((err) => log.error('first-download notification failed', err.message));
}

module.exports = { createTransferRoutes };
