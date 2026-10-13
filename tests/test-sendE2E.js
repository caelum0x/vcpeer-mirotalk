'use strict';

// npx mocha tests/test-sendE2E.js --timeout 120000
//
// End-to-end test for VCPeer Send: generates a ~50 MB file, sends it from one
// real browser context to another over the actual WebRTC data channel (both
// contexts talk to the same local server instance, localhost-only — no TURN
// relay is exercised, but the full signaling + RTCPeerConnection + data
// channel + chunking + backpressure + SHA-256 verification path is).
//
// Requires network access to the hash-wasm CDN URL (public/js/send/hash.js's
// default loader) — the app's SHA-256 implementation is loaded the same way
// in this test as it would be in production. If this test can't reach
// cdn.jsdelivr.net it will fail at the "Verified" assertion; that's an
// environment limitation, not a product bug.

require('should');

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');
const FILE_SIZE = 50 * 1024 * 1024; // ~50 MB, matches the brief

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`${BASE}/`, { redirect: 'manual' });
            return;
        } catch {
            await sleep(200);
        }
    }
    throw new Error('Server did not become ready in time');
}

describe('test-sendE2E', function () {
    this.timeout(120000);

    let serverProcess;
    let browser;
    let sourceFilePath;
    let downloadDir;
    let expectedSha256;

    before(async () => {
        serverProcess = spawn(process.execPath, [SERVER], {
            env: { ...process.env, PORT: String(PORT) },
            stdio: 'ignore',
        });
        await waitForServer(15000);

        // Deterministic-content-but-large random file, generated in chunks so
        // we never hold the whole 50 MB twice (once as the buffer, once in a
        // second copy) — same chunked-write discipline the app itself follows.
        downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-send-e2e-'));
        sourceFilePath = path.join(downloadDir, 'source.bin');
        const hasher = crypto.createHash('sha256');
        const fd = fs.openSync(sourceFilePath, 'w');
        const chunkSize = 1024 * 1024;
        let remaining = FILE_SIZE;
        while (remaining > 0) {
            const size = Math.min(chunkSize, remaining);
            const chunk = crypto.randomBytes(size);
            fs.writeSync(fd, chunk);
            hasher.update(chunk);
            remaining -= size;
        }
        fs.closeSync(fd);
        expectedSha256 = hasher.digest('hex');

        browser = await chromium.launch();
    });

    after(async () => {
        await browser?.close();
        serverProcess?.kill();
        fs.rmSync(downloadDir, { recursive: true, force: true });
    });

    it('streams a ~50MB file directly between two browser contexts and verifies its SHA-256', async () => {
        const senderContext = await browser.newContext();
        // Force the Blob-fallback receive path (no File System Access API):
        // removes showDirectoryPicker/showSaveFilePicker before any page script
        // runs, so requestStorage() falls through to 'blob' mode deterministically
        // instead of trying to drive a native OS file picker under automation.
        const receiverContext = await browser.newContext({ acceptDownloads: true });
        await receiverContext.addInitScript(() => {
            // eslint-disable-next-line no-undef
            delete window.showDirectoryPicker;
            // eslint-disable-next-line no-undef
            delete window.showSaveFilePicker;
        });

        const senderPage = await senderContext.newPage();
        const receiverPage = await receiverContext.newPage();

        try {
            await senderPage.goto(`${BASE}/send`);
            await senderPage.setInputFiles('#sendFileInput', sourceFilePath);

            await senderPage.waitForSelector('#sendSharePanel:not([hidden])', { timeout: 15000 });
            const shareLink = await senderPage.inputValue('#sendShareLink');
            shareLink.should.match(/\/send\?r=send-[0-9a-f]{32}/);

            await receiverPage.goto(shareLink);
            await receiverPage.waitForSelector('#sendManifestPanel:not([hidden])', { timeout: 20000 });

            const manifestText = await receiverPage.textContent('#sendManifestList');
            manifestText.should.containEql('source.bin');

            await receiverPage.click('#sendAcceptBtn');

            // Transfer + both sides' incremental SHA-256 should finish well within the timeout.
            await receiverPage.waitForSelector('#sendCompletePanel:not([hidden])', { timeout: 90000 });

            const verifiedBadge = await receiverPage.$('#sendCompleteList .send-file-badge-verified');
            (verifiedBadge !== null).should.be.true();

            const [download] = await Promise.all([
                receiverPage.waitForEvent('download', { timeout: 15000 }),
                receiverPage.click('#sendCompleteList a[download]'),
            ]);

            const downloadedPath = path.join(downloadDir, 'downloaded.bin');
            await download.saveAs(downloadedPath);

            const downloadedBytes = fs.readFileSync(downloadedPath);
            downloadedBytes.length.should.equal(FILE_SIZE);

            const actualSha256 = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
            actualSha256.should.equal(expectedSha256);
        } finally {
            await senderContext.close();
            await receiverContext.close();
        }
    });
});
