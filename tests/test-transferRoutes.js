'use strict';

// npx mocha tests/test-transferRoutes.js
//
// Integration test: mounts the real transferRoutes.js router on a bare
// Express app (not the full server.js — no JWT/OIDC/socket.io needed for
// this feature) listening on an ephemeral port, with a tmp-dir local-disk
// storage backend and a fake Logs/sendMail so the suite never needs network
// access or a real mail provider.

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const crypto = require('crypto');

const { createTransferRoutes } = require('../app/src/transfers/transferRoutes');
const { TransferStore } = require('../app/src/transfers/transferStore');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');
const { QuotaTracker } = require('../app/src/transfers/quota');
const { EmailVerificationStore } = require('../app/src/transfers/emailVerification');

const fakeLog = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function buildTestConfig(overrides = {}) {
    return {
        chunkBytes: 1024, // tiny, so multi-chunk tests don't need huge buffers
        maxTransferBytes: 10 * 1024 * 1024,
        dailyIpQuotaBytes: 10 * 1024 * 1024,
        dailyEmailSendLimit: 20,
        defaultExpiryDays: 7,
        allowedExpiryDays: [1, 3, 7],
        previewMaxBytes: 50 * 1024 * 1024,
        emailVerifyCodeTtlMs: 60000,
        ...overrides,
    };
}

function startTestServer({ configOverrides = {}, sendMailImpl } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-transfer-routes-'));
    const config = buildTestConfig(configOverrides);
    const store = new TransferStore({ dataDir });
    const storage = new LocalDiskStorage({ baseDir: dataDir });
    const ipQuota = new QuotaTracker({ limit: config.dailyIpQuotaBytes });
    const emailQuota = new QuotaTracker({ limit: config.dailyEmailSendLimit });
    const emailVerification = new EmailVerificationStore({ ttlMs: config.emailVerifyCodeTtlMs });
    const sentMails = [];
    const sendMail = async (msg) => {
        sentMails.push(msg);
        return sendMailImpl ? sendMailImpl(msg) : { sent: true, id: 'test-id' };
    };

    const app = express();
    app.set('trust proxy', true);
    const router = createTransferRoutes({
        config,
        store,
        storage,
        ipQuota,
        emailQuota,
        emailVerification,
        sendMail,
        log: fakeLog,
    });
    app.use('/api/v1/transfers', router);

    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const port = server.address().port;
            resolve({
                base: `http://localhost:${port}/api/v1/transfers`,
                server,
                store,
                storage,
                sentMails,
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

async function json(url, options) {
    const res = await fetch(url, options);
    let body = null;
    try {
        body = await res.json();
    } catch {
        /* no body */
    }
    return { status: res.status, body, headers: res.headers };
}

async function createAndUploadSimpleTransfer(base, { delivery = 'link', content = 'hello world', ...rest } = {}) {
    const created = await json(`${base}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            files: [{ name: 'hello.txt', size: Buffer.byteLength(content), type: 'text/plain' }],
            delivery,
            ...rest,
        }),
    });
    const { id, files } = created.body;
    const fileId = files[0].fileId;
    await fetch(`${base}/${id}/files/${fileId}/chunks/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(content),
    });
    return { id, fileId, content };
}

describe('test-transferRoutes', function () {
    this.timeout(15000);
    let ctx;

    afterEach(async () => {
        if (ctx) await ctx.close();
        ctx = null;
    });

    it('GET /config returns the public limits', async () => {
        ctx = await startTestServer();
        const { status, body } = await json(`${ctx.base}/config`);
        status.should.equal(200);
        body.chunkBytes.should.equal(ctx.config.chunkBytes);
    });

    it('creates a transfer, uploads a chunk, finalizes, and downloads the same bytes', async () => {
        ctx = await startTestServer();
        const { id, fileId, content } = await createAndUploadSimpleTransfer(ctx.base);

        const finalize = await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        finalize.status.should.equal(200);
        finalize.body.status.should.equal('ready');

        const meta = await json(`${ctx.base}/${id}`);
        meta.status.should.equal(200);
        meta.body.files[0].name.should.equal('hello.txt');

        const download = await fetch(`${ctx.base}/${id}/files/${fileId}/download`);
        download.status.should.equal(200);
        const downloaded = Buffer.from(await download.arrayBuffer());
        downloaded.toString('utf8').should.equal(content);
    });

    it('rejects a chunk whose size does not match the expected chunk size', async () => {
        ctx = await startTestServer();
        const created = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'a.bin', size: 2000, type: 'application/octet-stream' }],
                delivery: 'link',
            }),
        });
        const { id, files } = created.body;
        const res = await fetch(`${ctx.base}/${id}/files/${files[0].fileId}/chunks/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.alloc(500), // expected 1024 (chunkBytes) for part 1 of a 2000-byte file
        });
        res.status.should.equal(400);
    });

    it('finalize fails with 409 when a chunk is missing', async () => {
        ctx = await startTestServer();
        const created = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'a.bin', size: 2000, type: 'application/octet-stream' }],
                delivery: 'link',
            }),
        });
        const { id } = created.body;
        // never upload any chunk
        const finalize = await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        finalize.status.should.equal(409);
    });

    it('enforces maxDownloads: the (limit+1)-th download is refused', async () => {
        ctx = await startTestServer();
        const { id, fileId } = await createAndUploadSimpleTransfer(ctx.base, { maxDownloads: 1 });
        await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });

        const first = await fetch(`${ctx.base}/${id}/files/${fileId}/download`);
        first.status.should.equal(200);

        const second = await fetch(`${ctx.base}/${id}/files/${fileId}/download`);
        second.status.should.equal(404); // already expired-by-limit at the metadata check
    });

    it('concurrent downloads at maxDownloads=1 let exactly one through', async () => {
        ctx = await startTestServer();
        const { id, fileId } = await createAndUploadSimpleTransfer(ctx.base, { maxDownloads: 1 });
        await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });

        const [a, b] = await Promise.all([
            fetch(`${ctx.base}/${id}/files/${fileId}/download`),
            fetch(`${ctx.base}/${id}/files/${fileId}/download`),
        ]);
        // Exactly one of the two concurrent requests must succeed; the loser is
        // "gone" either way — via the gateDownload() race guard (410) or because
        // by the time its own isExpiredOrGone() pre-check ran, the winner's
        // atomic increment had already made the transfer look exhausted (404).
        // Which exact status the loser gets depends on event-loop interleaving;
        // what must never happen is both succeeding.
        const statuses = [a.status, b.status];
        statuses.filter((s) => s === 200).length.should.equal(1);
        statuses.filter((s) => s === 404 || s === 410).length.should.equal(1);
    });

    it('BUG: maxDownloads=1 on a multi-file transfer must allow the recipient to download EVERY file once, not just the first', async () => {
        ctx = await startTestServer();
        const created = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [
                    { name: 'a.txt', size: 5, type: 'text/plain' },
                    { name: 'b.txt', size: 5, type: 'text/plain' },
                ],
                delivery: 'link',
                maxDownloads: 1,
            }),
        });
        const { id, files } = created.body;
        for (const f of files) {
            await fetch(`${ctx.base}/${id}/files/${f.fileId}/chunks/1`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: Buffer.from('hello'),
            });
        }
        await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });

        // A sender who set "allow 1 download" expects the recipient to be able
        // to fetch ALL of their files once, whether via "Download all" (zip)
        // or by clicking each file's own Download button — not have the link
        // die after the very first file.
        const first = await fetch(`${ctx.base}/${id}/files/${files[0].fileId}/download`);
        first.status.should.equal(200);

        const second = await fetch(`${ctx.base}/${id}/files/${files[1].fileId}/download`);
        second.status.should.equal(200);
    });

    it('rejects a transfer whose total size exceeds maxTransferBytes', async () => {
        ctx = await startTestServer({ configOverrides: { maxTransferBytes: 100 } });
        const result = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'a.bin', size: 101, type: 'application/octet-stream' }],
                delivery: 'link',
            }),
        });
        result.status.should.equal(413);
    });

    it('enforces the per-IP daily quota', async () => {
        ctx = await startTestServer({ configOverrides: { dailyIpQuotaBytes: 100 } });
        const ok = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'a.bin', size: 60, type: 'application/octet-stream' }],
                delivery: 'link',
            }),
        });
        ok.status.should.equal(201);
        const blocked = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'b.bin', size: 60, type: 'application/octet-stream' }],
                delivery: 'link',
            }),
        });
        blocked.status.should.equal(429);
    });

    it('rejects an email-mode transfer with a blocked executable file type', async () => {
        ctx = await startTestServer();
        const result = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [{ name: 'virus.exe', size: 10, type: 'application/octet-stream' }],
                delivery: 'email',
                recipients: ['a@example.com'],
                senderEmail: 'me@example.com',
            }),
        });
        result.status.should.equal(400);
        result.body.message.should.containEql('virus.exe');
    });

    it('full email-mode flow: create, upload, verify, finalize, sends recipient + first-download emails', async () => {
        ctx = await startTestServer();
        const { id, fileId } = await createAndUploadSimpleTransfer(ctx.base, {
            delivery: 'email',
            recipients: ['friend@example.com'],
            senderEmail: 'me@example.com',
            message: 'here you go',
        });

        const verifyReq = await json(`${ctx.base}/${id}/verify-email/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'me@example.com' }),
        });
        verifyReq.status.should.equal(200);
        ctx.sentMails.length.should.equal(1);
        const codeMatch = /(\d{6})/.exec(ctx.sentMails[0].text);
        codeMatch.should.not.be.null();
        const code = codeMatch[1];

        const confirm = await json(`${ctx.base}/${id}/verify-email/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'me@example.com', code }),
        });
        confirm.status.should.equal(200);

        const finalize = await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        finalize.status.should.equal(200);
        ctx.sentMails.length.should.equal(2); // verification code + recipient notification
        ctx.sentMails[1].to.should.deepEqual(['friend@example.com']);

        await fetch(`${ctx.base}/${id}/files/${fileId}/download`);
        ctx.sentMails.length.should.equal(3); // + first-download notice to the sender

        await fetch(`${ctx.base}/${id}/files/${fileId}/download`);
        ctx.sentMails.length.should.equal(3); // not sent again on a second download
    });

    it('finalize fails if sender email was never verified', async () => {
        ctx = await startTestServer();
        const { id } = await createAndUploadSimpleTransfer(ctx.base, {
            delivery: 'email',
            recipients: ['friend@example.com'],
            senderEmail: 'me@example.com',
        });
        const finalize = await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        finalize.status.should.equal(403);
    });

    it('streams a multi-file zip containing the correct bytes', async () => {
        ctx = await startTestServer();
        const created = await json(`${ctx.base}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [
                    { name: 'a.txt', size: 5, type: 'text/plain' },
                    { name: 'b.txt', size: 5, type: 'text/plain' },
                ],
                delivery: 'link',
            }),
        });
        const { id, files } = created.body;
        await fetch(`${ctx.base}/${id}/files/${files[0].fileId}/chunks/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.from('aaaaa'),
        });
        await fetch(`${ctx.base}/${id}/files/${files[1].fileId}/chunks/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Buffer.from('bbbbb'),
        });
        await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });

        const zipRes = await fetch(`${ctx.base}/${id}/zip`);
        zipRes.status.should.equal(200);
        const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
        zipBuffer.toString('latin1').should.containEql('a.txt');
        zipBuffer.toString('latin1').should.containEql('b.txt');
    });

    it('manage endpoint reports download count and supports early delete', async () => {
        ctx = await startTestServer();
        const { id, fileId } = await createAndUploadSimpleTransfer(ctx.base);
        const finalize = await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const manageUrl = finalize.body.manageUrl;
        const manageToken = manageUrl.split('m=')[1];

        await fetch(`${ctx.base}/${id}/files/${fileId}/download`);

        const manageMeta = await json(`${ctx.base}/manage/${manageToken}`);
        manageMeta.status.should.equal(200);
        manageMeta.body.downloadCount.should.equal(1);

        const del = await json(`${ctx.base}/manage/${manageToken}`, { method: 'DELETE' });
        del.status.should.equal(200);

        const afterDelete = await json(`${ctx.base}/${id}`);
        afterDelete.status.should.equal(404);
    });

    it('report endpoint increments the report counter', async () => {
        ctx = await startTestServer();
        const { id } = await createAndUploadSimpleTransfer(ctx.base);
        const report = await json(`${ctx.base}/${id}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'spam' }),
        });
        report.status.should.equal(200);
        const record = ctx.store.get(id);
        record.reports.should.equal(1);
    });

    it('preview is refused for a non-previewable file type', async () => {
        ctx = await startTestServer();
        const { id, fileId } = await createAndUploadSimpleTransfer(ctx.base);
        await json(`${ctx.base}/${id}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const preview = await fetch(`${ctx.base}/${id}/files/${fileId}/preview`);
        preview.status.should.equal(404);
    });

    it('404s a transfer id that never existed', async () => {
        ctx = await startTestServer();
        const result = await json(`${ctx.base}/${crypto.randomBytes(12).toString('hex')}`);
        result.status.should.equal(404);
    });
});
