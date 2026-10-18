'use strict';

// npx mocha tests/test-notifyRoute.js

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3098;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');

let serverProcess;
let tmpDataDir;

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

describe('test-notifyRoute', function () {
    this.timeout(20000);

    before(async () => {
        tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-route-test-'));
        serverProcess = spawn(process.execPath, [SERVER], {
            env: { ...process.env, PORT: String(PORT), NOTIFY_DATA_DIR: tmpDataDir },
            stdio: 'ignore',
        });
        await waitForServer(15000);
    });

    after(() => {
        serverProcess?.kill();
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
    });

    it('serves the /notify page', async () => {
        const response = await fetch(`${BASE}/notify`);
        response.status.should.equal(200);
        const body = await response.text();
        body.should.containEql('Get notified');
    });

    it('submitting a valid email redirects to /notify?submitted=1 and the success message shows', async () => {
        const response = await fetch(`${BASE}/notify/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            redirect: 'manual',
            body: new URLSearchParams({ email: 'e2e-test@example.com', source: 'notify_page' }),
        });
        response.status.should.equal(303);
        response.headers.get('location').should.equal('/notify?submitted=1');

        const page = await fetch(`${BASE}/notify?submitted=1`);
        const body = await page.text();
        body.should.containEql('something new ships');
    });

    it('rejects an invalid email and shows the error, not a crash', async () => {
        const response = await fetch(`${BASE}/notify/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ email: 'not-an-email', source: 'notify_page' }),
        });
        response.status.should.equal(422);
        const body = await response.text();
        body.should.containEql('valid email');
    });

    it('rejects an XSS payload in the email field without reflecting it unescaped', async () => {
        const payload = '<script>alert(1)</script>';
        const response = await fetch(`${BASE}/notify/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ email: payload, source: 'notify_page' }),
        });
        const body = await response.text();
        body.should.not.containEql('<script>alert(1)</script>');
    });
});
