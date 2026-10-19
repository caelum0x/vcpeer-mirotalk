'use strict';

const crypto = require('crypto');
const express = require('express');

const checkXSS = require('../xss');
const { clipCreateLimiter, clipChunkLimiter, clipViewLimiter } = require('../middleware/rateLimiter');
const { generateTransferKey, encryptChunk } = require('../transfers/cryptoStream');
const { createRangeReadStream } = require('./clipRangeStream');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIME_RE = /^(video|audio)\//;
const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * Builds the `/api/v1/clips*` router for VCPeer's async "Record & share"
 * feature (Loom-style: record once in a room — solo or with others — get a
 * link, the viewer watches it later on their own time).
 *
 * Reuses the same storage backend, per-chunk AES-256-GCM encryption
 * (transfers/cryptoStream.js), and resumable-chunked-upload shape as VCPeer
 * Send's "Send a link" transfers (app/src/transfers/), but a clip is always
 * exactly one file, so there's no fileId — the clip's own id is the storage
 * key.
 *
 * @param {object} deps
 * @param {object} deps.config `config.clips` (see config.template.js)
 * @param {import('./clipStore').ClipStore} deps.store
 * @param {import('../storage/StorageInterface')} deps.storage
 * @param {import('../transfers/quota').QuotaTracker} deps.ipQuota bytes/day/IP
 * @param {import('../logs')} deps.log
 * @returns {express.Router}
 */
function createClipRoutes({ config, store, storage, ipQuota, log }) {
    const router = express.Router();

    const originOf = (req) => `${req.protocol}://${req.get('host')}`;

    function isGoneOrExpired(record, now = Date.now()) {
        if (!record || record.status === 'deleted') return true;
        if (record.status === 'ready' && record.expiresAt && record.expiresAt <= now) return true;
        return false;
    }

    function publicMeta(record) {
        return {
            id: record.id,
            title: record.title,
            mimeType: record.mimeType,
            size: record.size,
            createdAt: record.createdAt,
            viewCount: record.viewCount,
            expiresAt: record.expiresAt,
        };
    }

    // Public config so the client never hardcodes limits that could drift from the server.
    router.get('/config', (req, res) => {
        res.json({
            chunkBytes: config.chunkBytes,
            maxClipBytes: config.maxClipBytes,
            defaultExpiryDays: config.defaultExpiryDays,
        });
    });

    router.post('/', clipCreateLimiter, express.json(), (req, res) => {
        const body = checkXSS(req.body || {});
        const { title, mimeType } = body;
        const sizeBytes = Number(body.sizeBytes);

        if (typeof mimeType !== 'string' || !MIME_RE.test(mimeType)) {
            return res.status(400).json({ message: 'mimeType must be a video/* or audio/* type' });
        }
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
            return res.status(400).json({ message: 'sizeBytes must be a positive number' });
        }
        if (sizeBytes > config.maxClipBytes) {
            return res.status(413).json({
                message: `Recording exceeds the ${(config.maxClipBytes / (1024 * 1024)).toFixed(0)} MiB cap for shareable links`,
            });
        }

        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const quotaResult = ipQuota.consume(ip, sizeBytes);
        if (!quotaResult.allowed) {
            return res.status(429).json({
                message: 'Daily recording-upload quota for this network exceeded. Please try again tomorrow.',
            });
        }

        const chunkBytes = config.chunkBytes;
        const totalChunks = Math.ceil(sizeBytes / chunkBytes);
        const cleanTitle =
            typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Untitled recording';

        const record = store.create({
            title: cleanTitle,
            mimeType: mimeType.slice(0, 100),
            size: sizeBytes,
            chunkBytes,
            totalChunks,
            expiresAt: Date.now() + config.defaultExpiryDays * DAY_MS,
            manageToken: crypto.randomBytes(16).toString('hex'),
            encKeyB64: generateTransferKey().toString('base64'),
            ip,
        });

        res.status(201).json({
            id: record.id,
            manageToken: record.manageToken,
            chunkBytes,
            totalChunks,
        });
    });

    router.get('/:id/status', (req, res) => {
        const record = store.get(req.params.id);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });

        storage
            .listParts(record.id)
            .then((parts) =>
                res.json({ uploadedParts: parts.map((p) => p.partNumber), totalChunks: record.totalChunks })
            )
            .catch((err) => {
                log.error('clip status: listParts failed', err.message);
                res.status(500).json({ message: 'Could not read upload status' });
            });
    });

    router.put(
        '/:id/chunks/:partNumber',
        clipChunkLimiter,
        express.raw({ type: '*/*', limit: config.chunkBytes + 1024 * 1024 }),
        async (req, res) => {
            const record = store.get(req.params.id);
            if (!record || record.status !== 'uploading') {
                return res.status(404).json({ message: 'Clip not found or already finalized' });
            }

            const partNumber = Number(req.params.partNumber);
            if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > record.totalChunks) {
                return res.status(400).json({ message: 'Invalid chunk index' });
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ message: 'Empty chunk body' });
            }
            const expectedSize = Math.min(record.chunkBytes, record.size - (partNumber - 1) * record.chunkBytes);
            if (req.body.length !== expectedSize) {
                return res.status(400).json({
                    message: `Chunk ${partNumber} is ${req.body.length} bytes, expected ${expectedSize}`,
                });
            }

            try {
                const keyBuf = Buffer.from(record.encKeyB64, 'base64');
                const ciphertext = encryptChunk(keyBuf, record.id, partNumber, req.body);
                await storage.putPart(record.id, partNumber, ciphertext);
                res.json({ partNumber, received: true });
            } catch (err) {
                log.error('clip chunk upload failed', err.message);
                res.status(500).json({ message: 'Chunk upload failed, please retry' });
            }
        }
    );

    router.post('/:id/finalize', express.json(), async (req, res) => {
        const record = store.get(req.params.id);
        if (!record || record.status !== 'uploading') {
            return res.status(404).json({ message: 'Clip not found or already finalized' });
        }

        const parts = await storage.listParts(record.id);
        const uploadedSize = parts.reduce((sum, p) => sum + p.size - 16, 0); // minus GCM auth tag per part
        if (parts.length !== record.totalChunks || uploadedSize !== record.size) {
            return res.status(409).json({
                message: `Recording is incomplete (${parts.length}/${record.totalChunks} chunks). Resume the upload and retry.`,
            });
        }

        const updated = store.update(record.id, (r) => ({ ...r, status: 'ready' }));
        res.json({
            id: updated.id,
            status: 'ready',
            shareUrl: `${originOf(req)}/watch/${updated.id}`,
            manageToken: updated.manageToken,
        });
    });

    router.get('/:id', (req, res) => {
        const record = store.get(req.params.id);
        if (isGoneOrExpired(record) || record.status !== 'ready') {
            return res.status(404).json({ message: 'This clip is invalid, expired, or has been deleted.' });
        }
        res.json(publicMeta(record));
    });

    router.post('/:id/view', clipViewLimiter, (req, res) => {
        const record = store.get(req.params.id);
        if (isGoneOrExpired(record) || record.status !== 'ready') {
            return res.status(404).json({ message: 'Not found' });
        }
        const updated = store.update(record.id, (r) => ({ ...r, viewCount: r.viewCount + 1 }));
        res.json({ viewCount: updated.viewCount });
    });

    router.get('/:id/video', async (req, res) => {
        const record = store.get(req.params.id);
        if (isGoneOrExpired(record) || record.status !== 'ready') return res.status(404).end();

        try {
            const parts = await storage.listParts(record.id);
            const size = record.size;
            const keyBuf = Buffer.from(record.encKeyB64, 'base64');

            let start = 0;
            let end = size - 1;
            let status = 200;
            const rangeHeader = req.headers.range;
            if (rangeHeader) {
                const match = RANGE_RE.exec(rangeHeader);
                if (!match || (!match[1] && !match[2])) {
                    res.setHeader('Content-Range', `bytes */${size}`);
                    return res.status(416).end();
                }
                if (match[1]) {
                    start = Number(match[1]);
                    end = match[2] ? Number(match[2]) : size - 1;
                } else {
                    // suffix range, e.g. "bytes=-500" => last 500 bytes
                    start = Math.max(0, size - Number(match[2]));
                    end = size - 1;
                }
                if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size || start < 0) {
                    res.setHeader('Content-Range', `bytes */${size}`);
                    return res.status(416).end();
                }
                status = 206;
                res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            }

            res.status(status);
            res.setHeader('Content-Type', record.mimeType || 'video/webm');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', String(end - start + 1));
            res.setHeader('Cache-Control', 'private, max-age=3600');

            const stream = createRangeReadStream({
                storage,
                key: record.id,
                fileId: record.id,
                keyBuf,
                chunkBytes: record.chunkBytes,
                start,
                end,
                parts,
            });
            stream.on('error', (err) => {
                log.error('clip video stream failed', err.message);
                if (!res.headersSent) res.status(500);
                res.end();
            });
            stream.pipe(res);
        } catch (err) {
            log.error('clip video failed', err.message);
            res.status(500).end();
        }
    });

    router.get('/manage/:manageToken', (req, res) => {
        const record = store.findByManageToken(req.params.manageToken);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });
        res.json({ ...publicMeta(record), status: record.status });
    });

    router.delete('/manage/:manageToken', async (req, res) => {
        const record = store.findByManageToken(req.params.manageToken);
        if (!record || record.status === 'deleted') return res.status(404).json({ message: 'Not found' });
        await storage.deleteAll(record.id).catch((err) => log.error('manual clip delete failed', err.message));
        store.remove(record.id);
        res.json({ deleted: true });
    });

    return router;
}

module.exports = { createClipRoutes };
