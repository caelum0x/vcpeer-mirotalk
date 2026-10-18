'use strict';

// npx mocha tests/routes.test.js
//
// Boots the real server (same pattern as tests/test-signalingRelay.js) and checks
// the 5 new VCPeer SEO pages + sitemap.xml + robots.txt return 200 with sane
// content, and that /about now points at our own source repo instead of
// upstream's docs.

require('should');

const path = require('path');
const { spawn } = require('child_process');

const PORT = 3098;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');

let serverProcess;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe('VCPeer routes', function () {
    this.timeout(20000);

    before(async () => {
        serverProcess = spawn(process.execPath, [SERVER], {
            env: {
                ...process.env,
                PORT: String(PORT),
                JWT_KEY: 'test-jwt-key-0123456789-abcdefghijklmnop',
                HOST_PROTECTED: 'false',
                HOST_USER_AUTH: 'false',
                NGROK_ENABLED: 'false',
                SENTRY_ENABLED: 'false',
                IP_LOOKUP_ENABLED: 'false',
                OIDC_ENABLED: 'false',
            },
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        await waitForServer(10000);
    });

    after(() => {
        if (serverProcess) serverProcess.kill();
    });

    const seoPages = [
        { route: '/free-video-call', titleContains: 'Free Video Call' },
        { route: '/video-call-no-time-limit', titleContains: 'No Time Limit' },
        { route: '/video-call-link', titleContains: 'Video Call Link' },
        { route: '/group-video-call-free', titleContains: 'Group Video Call' },
        { route: '/screen-share-no-signup', titleContains: 'Screen Share' },
        { route: '/wetransfer-alternative', titleContains: 'WeTransfer Alternative' },
        { route: '/free-scheduling-link', titleContains: 'Free Scheduling Link' },
        { route: '/stream-to-twitch-and-kick', titleContains: 'Stream to Twitch and Kick' },
        { route: '/self-hosted-zoom-alternative', titleContains: 'Self-Hosted Zoom Alternative' },
        { route: '/firefox-send-alternative', titleContains: 'Firefox Send Alternative' },
    ];

    seoPages.forEach(({ route, titleContains }) => {
        it(`GET ${route} returns 200 html with the expected title`, async () => {
            const res = await fetch(`${BASE}${route}`);
            res.status.should.equal(200);
            (res.headers.get('content-type') || '').should.match(/html/);
            const body = await res.text();
            body.should.match(/<title>/);
            body.should.containEql(titleContains);
            body.should.not.containEql('MiroTalk');
        });
    });

    it('GET /sitemap.xml returns 200 xml with all core + SEO pages listed', async () => {
        const res = await fetch(`${BASE}/sitemap.xml`);
        res.status.should.equal(200);
        (res.headers.get('content-type') || '').should.match(/xml/);
        const body = await res.text();
        body.should.containEql('https://vcpeer.com/');
        body.should.containEql('https://vcpeer.com/free-video-call');
        body.should.containEql('https://vcpeer.com/video-call-no-time-limit');
        body.should.containEql('https://vcpeer.com/video-call-link');
        body.should.containEql('https://vcpeer.com/group-video-call-free');
        body.should.containEql('https://vcpeer.com/screen-share-no-signup');
        body.should.containEql('https://vcpeer.com/send');
        body.should.containEql('https://vcpeer.com/wetransfer-alternative');
        body.should.containEql('https://vcpeer.com/free-scheduling-link');
        body.should.containEql('https://vcpeer.com/stream-to-twitch-and-kick');
        body.should.containEql('https://vcpeer.com/self-hosted-zoom-alternative');
        body.should.containEql('https://vcpeer.com/firefox-send-alternative');
    });

    it('GET / includes the suite nav links to every VCPeer tool', async () => {
        const res = await fetch(`${BASE}/`);
        res.status.should.equal(200);
        const body = await res.text();
        body.should.containEql('href="/send"');
        body.should.containEql('href="https://share.vcpeer.com"');
        body.should.containEql('href="https://book.vcpeer.com/admin/30min"');
        body.should.containEql('href="https://live.vcpeer.com"');
        body.should.containEql('href="/launchboard"');
    });

    it('GET on old VC-investor legacy paths 301s home instead of "joining" them as a room', async () => {
        for (const legacyPath of ['/vcs/anything', '/fresh-funding', '/tools', '/pricing', '/support']) {
            const res = await fetch(`${BASE}${legacyPath}`, { redirect: 'manual' });
            res.status.should.equal(301);
            res.headers.get('location').should.equal('/');
        }
    });

    it('GET /robots.txt returns 200 text and allows indexing', async () => {
        const res = await fetch(`${BASE}/robots.txt`);
        res.status.should.equal(200);
        const body = await res.text();
        body.should.containEql('Allow: /');
        body.should.containEql('Sitemap: https://vcpeer.com/sitemap.xml');
        body.should.not.match(/Disallow:\s*\/\s*$/m);
    });

    it('GET / returns 200 and VCPeer branding, not MiroTalk', async () => {
        const res = await fetch(`${BASE}/`);
        res.status.should.equal(200);
        const body = await res.text();
        body.should.containEql('VCPeer');
    });

    it('GET /about redirects to our own source repo, not upstream docs', async () => {
        const res = await fetch(`${BASE}/about`, { redirect: 'manual' });
        res.status.should.equal(301);
        res.headers.get('location').should.equal('https://github.com/caelum0x/vcpeer-mirotalk');
    });

    it('GET on an unmatched static-asset-style path returns a real 404, not a soft 200', async () => {
        const res = await fetch(`${BASE}/images/this-file-does-not-exist.png`);
        res.status.should.equal(404);
        const body = await res.text();
        body.should.containEql('Page not found');
    });

    it('GET / does not show the upstream MiroTalk fork author as a VCPeer team member', async () => {
        const res = await fetch(`${BASE}/`);
        const body = await res.text();
        body.should.not.containEql('Meet the team');
        body.should.not.containEql('Miroslav Pejic');
        body.should.not.containEql('miroslav-pejic');
    });
});
