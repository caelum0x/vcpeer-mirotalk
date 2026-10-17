'use strict';

// npx mocha tests/test-launchboardRoute.js

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3097;
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

describe('test-launchboardRoute', function () {
    this.timeout(20000);

    before(async () => {
        tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchboard-route-test-'));
        serverProcess = spawn(process.execPath, [SERVER], {
            env: { ...process.env, PORT: String(PORT), LAUNCHBOARD_DATA_DIR: tmpDataDir },
            stdio: 'ignore',
        });
        await waitForServer(15000);
    });

    after(() => {
        serverProcess?.kill();
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
    });

    it('serves the /launchboard page with the seed listings', async () => {
        const response = await fetch(`${BASE}/launchboard`);
        response.status.should.equal(200);
        const body = await response.text();
        body.should.containEql('Launchboard');
        body.should.containEql('VCPeer');
        body.should.containEql('Menivor');
    });

    it('returns the listings as real JSON via the API', async () => {
        const response = await fetch(`${BASE}/api/v1/launchboard/listings`);
        response.status.should.equal(200);
        const { listings } = await response.json();
        listings.should.be.an.Array();
        listings.length.should.be.above(0);
    });

    it('submitting a valid listing redirects to /launchboard?submitted=1 and the listing appears', async () => {
        const response = await fetch(`${BASE}/launchboard/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            redirect: 'manual',
            body: new URLSearchParams({
                name: 'E2E Test Co',
                url: 'https://e2e-test.example.com',
                pitch: 'Submitted by the VCPeer route test suite end to end.',
                category: 'saas',
            }),
        });
        response.status.should.equal(303);
        response.headers.get('location').should.equal('/launchboard?submitted=1');

        const listPage = await fetch(`${BASE}/launchboard?submitted=1`);
        const body = await listPage.text();
        body.should.containEql('E2E Test Co');
        body.should.containEql('Grab your free launch video above');
    });

    it('rejects a submission with an invalid URL and shows the error, not a crash', async () => {
        const response = await fetch(`${BASE}/launchboard/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                name: 'Bad URL Co',
                url: 'not-a-url',
                pitch: 'This should fail validation cleanly.',
                category: 'saas',
            }),
        });
        response.status.should.equal(422);
        const body = await response.text();
        body.should.containEql('valid http');
    });

    it('rejects an XSS payload in the name field without reflecting it unescaped', async () => {
        const payload = '<script>alert(1)</script>';
        const response = await fetch(`${BASE}/launchboard/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                name: payload,
                url: 'https://xss-test.example.com',
                pitch: 'Testing that script tags never render unescaped.',
                category: 'saas',
            }),
        });
        const body = await response.text();
        body.should.not.containEql('<script>alert(1)</script>');
    });
});
