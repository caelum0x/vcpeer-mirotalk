'use strict';

// npx mocha tests/test-sendLinkE2E.js --timeout 120000
//
// End-to-end test for VCPeer Send's "Send a link" (WeTransfer-style
// upload-and-share) mode: uploads a real file through the actual browser UI
// (chunked upload → finalize → share link), opens that link in a brand new
// browser context (simulating a different device entirely — no state is
// shared), downloads it, and verifies the SHA-256 matches. Then verifies a
// transfer created with a 1-download limit refuses a second download.

require('should');

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');

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

describe('test-sendLinkE2E', function () {
    this.timeout(120000);

    let serverProcess;
    let browser;
    let workDir;
    let dataDir;
    let sourceFilePath;
    let expectedSha256;

    before(async () => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-sendlink-e2e-'));
        dataDir = path.join(workDir, 'transfers-data');

        serverProcess = spawn(process.execPath, [SERVER], {
            env: { ...process.env, PORT: String(PORT), SEND_LINK_DATA_DIR: dataDir },
            stdio: 'ignore',
        });
        await waitForServer(15000);

        sourceFilePath = path.join(workDir, 'source.bin');
        const content = crypto.randomBytes(2 * 1024 * 1024); // 2 MB — a few chunks at the default 8 MiB? use small chunk override via env not needed, default chunk 8MiB means 1 chunk; still exercises the real pipeline
        fs.writeFileSync(sourceFilePath, content);
        expectedSha256 = crypto.createHash('sha256').update(content).digest('hex');

        browser = await chromium.launch();
    });

    after(async () => {
        await browser?.close();
        serverProcess?.kill();
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('uploads via "Send a link", opens the link in a fresh context, downloads, and hashes match', async () => {
        const senderContext = await browser.newContext();
        const senderPage = await senderContext.newPage();

        let shareUrl;
        try {
            await senderPage.goto(`${BASE}/send`);
            // "Send a link" is the default mode — no tab click needed.
            await senderPage.setInputFiles('#sendLinkFileInput', sourceFilePath);
            await senderPage.waitForSelector('#sendLinkForm:not([hidden])', { timeout: 10000 });
            await senderPage.click('#sendLinkSubmitBtn');

            await senderPage.waitForSelector('#sendLinkResultPanel:not([hidden])', { timeout: 30000 });
            shareUrl = await senderPage.inputValue('#sendLinkResultUrl');
            shareUrl.should.match(/\/send\?t=[0-9a-f]+/);
        } finally {
            await senderContext.close();
        }

        // Fresh context = simulates an entirely different device/browser.
        const receiverContext = await browser.newContext({ acceptDownloads: true });
        const receiverPage = await receiverContext.newPage();
        try {
            await receiverPage.goto(shareUrl);
            await receiverPage.waitForSelector('#sendLinkDownloadList li', { timeout: 10000 });

            const [download] = await Promise.all([
                receiverPage.waitForEvent('download', { timeout: 15000 }),
                receiverPage.click('#sendLinkDownloadList a.button'),
            ]);

            const downloadedPath = path.join(workDir, 'downloaded.bin');
            await download.saveAs(downloadedPath);
            const downloadedBytes = fs.readFileSync(downloadedPath);
            const actualSha256 = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
            actualSha256.should.equal(expectedSha256);
        } finally {
            await receiverContext.close();
        }
    });

    it('enforces a 1-download limit end to end: the second download is refused', async () => {
        const senderContext = await browser.newContext();
        const senderPage = await senderContext.newPage();

        let shareUrl;
        try {
            await senderPage.goto(`${BASE}/send`);
            await senderPage.setInputFiles('#sendLinkFileInput', sourceFilePath);
            await senderPage.waitForSelector('#sendLinkForm:not([hidden])', { timeout: 10000 });
            await senderPage.selectOption('#sendLinkMaxDownloads', '1');
            await senderPage.click('#sendLinkSubmitBtn');
            await senderPage.waitForSelector('#sendLinkResultPanel:not([hidden])', { timeout: 30000 });
            shareUrl = await senderPage.inputValue('#sendLinkResultUrl');
        } finally {
            await senderContext.close();
        }

        const transferId = new URL(shareUrl).searchParams.get('t');

        const metaBefore = await fetch(`${BASE}/api/v1/transfers/${transferId}`);
        metaBefore.status.should.equal(200);
        const { files } = await metaBefore.json();
        const fileId = files[0].fileId;

        const dl1 = await fetch(`${BASE}/api/v1/transfers/${transferId}/files/${fileId}/download`);
        dl1.status.should.equal(200);

        const dl2 = await fetch(`${BASE}/api/v1/transfers/${transferId}/files/${fileId}/download`);
        (dl2.status === 404 || dl2.status === 410).should.be.true();
    });
});
