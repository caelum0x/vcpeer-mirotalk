'use strict';

// npx mocha tests/test-sendRoute.js

require('should');

const path = require('path');
const { spawn } = require('child_process');

const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');

let serverProcess;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`${BASE}/`, { redirect: 'manual' });
            return;
        } catch (err) {
            await sleep(200);
        }
    }
    throw new Error('Server did not become ready in time');
}

describe('test-sendRoute', function () {
    this.timeout(20000);

    before(async () => {
        serverProcess = spawn(process.execPath, [SERVER], {
            env: { ...process.env, PORT: String(PORT) },
            stdio: 'ignore',
        });
        await waitForServer(15000);
    });

    after(() => {
        serverProcess?.kill();
    });

    it('serves the /send page', async () => {
        const response = await fetch(`${BASE}/send`);
        response.status.should.equal(200);
        const body = await response.text();
        body.should.containEql('Send large files free, no upload, no size limit');
    });

    it('serves the send app.js module with a JS content type', async () => {
        const response = await fetch(`${BASE}/js/send/app.js`);
        response.status.should.equal(200);
        response.headers.get('content-type').should.containEql('javascript');
    });

    it('mints and resolves a 6-digit code for a valid send- channel', async () => {
        const mint = await fetch(`${BASE}/api/v1/send/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: 'send-' + '0'.repeat(32) }),
        });
        mint.status.should.equal(200);
        const { code } = await mint.json();
        code.should.match(/^\d{6}$/);

        const resolve = await fetch(`${BASE}/api/v1/send/code/${code}`);
        resolve.status.should.equal(200);
        const { channel } = await resolve.json();
        channel.should.equal('send-' + '0'.repeat(32));
    });

    it('rejects minting a code for a non-"send-" channel (can\'t be used to probe call rooms)', async () => {
        const response = await fetch(`${BASE}/api/v1/send/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: 'some-call-room' }),
        });
        response.status.should.equal(400);
    });

    it('returns 404 for an unknown code', async () => {
        const response = await fetch(`${BASE}/api/v1/send/code/000000`);
        response.status.should.equal(404);
    });

    it('returns 400 for a malformed code', async () => {
        const response = await fetch(`${BASE}/api/v1/send/code/not-a-code`);
        response.status.should.equal(400);
    });
});
