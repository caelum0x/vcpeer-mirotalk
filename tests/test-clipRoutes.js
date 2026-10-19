'use strict';

// npx mocha tests/test-clipRoutes.js
//
// Integration test: mounts the real clipRoutes.js router on a bare Express
// app (not the full server.js) listening on an ephemeral port, with a
// tmp-dir local-disk storage backend. Same shape as tests/test-transferRoutes.js.

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { createClipRoutes } = require('../app/src/clips/clipRoutes');
const { ClipStore } = require('../app/src/clips/clipStore');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');
const { QuotaTracker } = require('../app/src/transfers/quota');

const fakeLog = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function buildTestConfig(overrides = {}) {
    return {
        chunkBytes: 16, // tiny, so multi-chunk tests don't need huge buffers
        maxClipBytes: 1024 * 1024,
        dailyIpQuotaBytes: 1024 * 1024,
        defaultExpiryDays: 30,
        ...overrides,
    };
}

function startTestServer({ configOverrides = {} } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-clip-routes-'));
    const config = buildTestConfig(configOverrides);
    // Metadata and blob storage must be separate directories — see the
    // comment in app/src/clips/index.js (storage key = plain clip id, so a
    // meta.json dropped in the same "<id>/" dir would be misread as a part).
    const store = new ClipStore({ dataDir: path.join(dataDir, 'meta') });
    const storage = new LocalDiskStorage({ baseDir: path.join(dataDir, 'blobs') });
    const ipQuota = new QuotaTracker({ limit: config.dailyIpQuotaBytes });

    const app = express();
    app.set('trust proxy', true);
    const router = createClipRoutes({ config, store, storage, ipQuota, log: fakeLog });
    app.use('/api/v1/clips', router);

    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const port = server.address().port;
            resolve({
                base: `http://localhost:${port}/api/v1/clips`,
                server,
                store,
                storage,
                dataDir,
                config,
                close: () =>
                    new Promise((res) => {
                        server.close(() => {
                            fs.rmSync(dataDir, { recursive: true, force: true });
                            res();
                        });
                    }),
            });
        });
    });
}

/** Creates+uploads+finalizes a clip of `plaintext` bytes, returns {id, manageToken, chunkBytes}. */
async function createAndUploadClip(base, plaintext, { title = 'Test clip', mimeType = 'video/webm' } = {}) {
    const created = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mimeType, sizeBytes: plaintext.length }),
    }).then((r) => r.json());

    const { id, chunkBytes, manageToken } = created;
    const totalChunks = Math.ceil(plaintext.length / chunkBytes);
    for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
        const start = (partNumber - 1) * chunkBytes;
        const end = Math.min(start + chunkBytes, plaintext.length);
        // eslint-disable-next-line no-await-in-loop -- sequential upload, test helper
        await fetch(`${base}/${id}/chunks/${partNumber}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: plaintext.subarray(start, end),
        });
    }
    const finalizeRes = await fetch(`${base}/${id}/finalize`, { method: 'POST' }).then((r) => r.json());
    return { id, manageToken, chunkBytes, finalizeRes };
}

describe('test-clipRoutes', () => {
    let ctx;

    afterEach(async () => {
        if (ctx) await ctx.close();
        ctx = null;
    });

    it('GET /config returns the public limits', async () => {
        ctx = await startTestServer();
        const res = await fetch(`${ctx.base}/config`).then((r) => r.json());
        res.chunkBytes.should.equal(ctx.config.chunkBytes);
        res.maxClipBytes.should.equal(ctx.config.maxClipBytes);
    });

    it('creates a clip, uploads chunks, finalizes, and plays back the exact bytes', async () => {
        ctx = await startTestServer();
        const plaintext = Buffer.from('0123456789ABCDEFGHIJ'); // 20 bytes, chunkBytes=16 => 2 chunks

        const { id, finalizeRes } = await createAndUploadClip(ctx.base, plaintext);
        finalizeRes.status.should.equal('ready');
        finalizeRes.shareUrl.should.containEql(`/watch/${id}`);

        const meta = await fetch(`${ctx.base}/${id}`).then((r) => r.json());
        meta.title.should.equal('Test clip');
        meta.size.should.equal(plaintext.length);
        meta.viewCount.should.equal(0);

        const videoRes = await fetch(`${ctx.base}/${id}/video`);
        videoRes.status.should.equal(200);
        const body = Buffer.from(await videoRes.arrayBuffer());
        body.toString().should.equal(plaintext.toString());
    });

    it('serves a byte-range request with 206 and the correct slice', async () => {
        ctx = await startTestServer();
        const plaintext = Buffer.from('0123456789ABCDEFGHIJ'); // 20 bytes
        const { id } = await createAndUploadClip(ctx.base, plaintext);

        const rangeRes = await fetch(`${ctx.base}/${id}/video`, { headers: { Range: 'bytes=5-9' } });
        rangeRes.status.should.equal(206);
        rangeRes.headers.get('content-range').should.equal(`bytes 5-9/${plaintext.length}`);
        const body = Buffer.from(await rangeRes.arrayBuffer());
        body.toString().should.equal(plaintext.subarray(5, 10).toString());
    });

    it('rejects a chunk whose size does not match the expected chunk size', async () => {
        ctx = await startTestServer();
        const created = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', mimeType: 'video/webm', sizeBytes: 20 }),
        }).then((r) => r.json());

        const res = await fetch(`${ctx.base}/${created.id}/chunks/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.from('short'),
        });
        res.status.should.equal(400);
    });

    it('finalize fails with 409 when a chunk is missing', async () => {
        ctx = await startTestServer();
        const created = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', mimeType: 'video/webm', sizeBytes: 32 }), // 2 chunks of 16
        }).then((r) => r.json());

        await fetch(`${ctx.base}/${created.id}/chunks/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.alloc(16, 'a'),
        });
        // chunk 2 never uploaded

        const res = await fetch(`${ctx.base}/${created.id}/finalize`, { method: 'POST' });
        res.status.should.equal(409);
    });

    it('rejects an invalid mimeType', async () => {
        ctx = await startTestServer();
        const res = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', mimeType: 'application/zip', sizeBytes: 10 }),
        });
        res.status.should.equal(400);
    });

    it('rejects a clip whose size exceeds maxClipBytes', async () => {
        ctx = await startTestServer({ configOverrides: { maxClipBytes: 100 } });
        const res = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', mimeType: 'video/webm', sizeBytes: 1000 }),
        });
        res.status.should.equal(413);
    });

    it('enforces the per-IP daily quota', async () => {
        ctx = await startTestServer({ configOverrides: { dailyIpQuotaBytes: 100 } });
        const first = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'X', mimeType: 'video/webm', sizeBytes: 60 }),
        });
        first.status.should.equal(201);
        const second = await fetch(ctx.base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Y', mimeType: 'video/webm', sizeBytes: 60 }),
        });
        second.status.should.equal(429);
    });

    it('POST /:id/view increments the view counter', async () => {
        ctx = await startTestServer();
        const { id } = await createAndUploadClip(ctx.base, Buffer.from('hello world'));

        const first = await fetch(`${ctx.base}/${id}/view`, { method: 'POST' }).then((r) => r.json());
        first.viewCount.should.equal(1);
        const second = await fetch(`${ctx.base}/${id}/view`, { method: 'POST' }).then((r) => r.json());
        second.viewCount.should.equal(2);

        const meta = await fetch(`${ctx.base}/${id}`).then((r) => r.json());
        meta.viewCount.should.equal(2);
    });

    it('returns 404 for an unknown clip id', async () => {
        ctx = await startTestServer();
        const res = await fetch(`${ctx.base}/doesnotexist`);
        res.status.should.equal(404);
    });

    it('returns 404 for a clip past its expiresAt', async () => {
        ctx = await startTestServer();
        const { id } = await createAndUploadClip(ctx.base, Buffer.from('hello world'));
        ctx.store.update(id, (r) => ({ ...r, expiresAt: Date.now() - 1000 }));

        const res = await fetch(`${ctx.base}/${id}`);
        res.status.should.equal(404);
    });

    it('manage endpoint reports clip metadata and supports early delete', async () => {
        ctx = await startTestServer();
        const { id, manageToken } = await createAndUploadClip(ctx.base, Buffer.from('hello world'));

        const managed = await fetch(`${ctx.base}/manage/${manageToken}`).then((r) => r.json());
        managed.id.should.equal(id);

        const del = await fetch(`${ctx.base}/manage/${manageToken}`, { method: 'DELETE' }).then((r) => r.json());
        del.deleted.should.be.true();

        const afterDelete = await fetch(`${ctx.base}/${id}`);
        afterDelete.status.should.equal(404);
    });
});
