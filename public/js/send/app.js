'use strict';

/**
 * VCPeer Send — page glue.
 *
 * Wires the DOM in public/views/send.html to the pure/testable modules in
 * this directory. Not unit tested directly (there's no DOM in the unit test
 * run); covered by the Playwright end-to-end test instead
 * (tests/test-sendE2E.js), which drives this exact file in two real browser
 * contexts.
 */
import { SignalingClient } from './signaling.js';
import { PeerSession } from './peer.js';
import { SendSession } from './sender.js';
import { ReceiveSession } from './receiver.js';
import { generateRoomToken, isValidRoomToken, buildShareUrl } from './room-token.js';
import { bytesToSize, formatSpeed, formatEta, clampPercent, estimateThroughput } from './format.js';
import { renderFileRow, updateFileRowProgress, markFileRowComplete } from './file-list-ui.js';
import { initLinkMode } from './link-sender.js';
import { renderDownloadPage } from './link-download.js';
import { renderManagePage } from './link-manage.js';

const API_BASE = '/api/v1';

const el = (id) => document.getElementById(id);

const panels = {
    pick: el('sendPickPanel'),
    share: el('sendSharePanel'),
    connecting: el('sendConnectingPanel'),
    manifest: el('sendManifestPanel'),
    transfer: el('sendTransferPanel'),
    complete: el('sendCompletePanel'),
    error: el('sendErrorPanel'),
};

function showPanel(name) {
    for (const key of Object.keys(panels)) {
        panels[key].hidden = key !== name;
    }
}

function showError(message) {
    el('sendErrorText').textContent = message;
    showPanel('error');
}

/** @param {string} name a short, cosmetic-only peer label */
function randomPeerName(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------------------------- */
/* Sender flow                                                                 */
/* -------------------------------------------------------------------------- */

async function startSenderFlow(files) {
    const token = generateRoomToken();
    const shareUrl = buildShareUrl(window.location.origin, token);

    el('sendShareLink').value = shareUrl;
    renderQrCode(shareUrl);
    requestSendCode(token);

    el('sendModeTabs').hidden = true;
    showPanel('share');

    const signaling = new SignalingClient();
    const peers = new Map(); // peer_id -> PeerSession
    let sendSessionStarted = false;

    signaling.on('addPeer', ({ peer_id, should_create_offer, iceServers }) => {
        if (peers.has(peer_id)) return;

        const session = new PeerSession({
            peerId: peer_id,
            iceServers,
            shouldCreateOffer: should_create_offer,
            signaling,
            onDataChannel: ({ channel }) => {
                const begin = () => {
                    if (sendSessionStarted) return; // v1: stream to the first receiver only
                    sendSessionStarted = true;
                    beginSending(channel, files);
                };
                if (channel.readyState === 'open') begin();
                else channel.addEventListener('open', begin, { once: true });
            },
        });
        peers.set(peer_id, session);
    });

    signaling.on('sessionDescription', ({ peer_id, session_description }) => {
        peers.get(peer_id)?.handleRemoteSessionDescription(session_description);
    });
    signaling.on('iceCandidate', ({ peer_id, ice_candidate }) => {
        peers.get(peer_id)?.handleRemoteIceCandidate(ice_candidate);
    });
    signaling.on('removePeer', ({ peer_id }) => {
        peers.get(peer_id)?.close();
        peers.delete(peer_id);
        if (sendSessionStarted) {
            el('sendShareStatusText').textContent = 'The other device disconnected.';
        }
    });

    signaling.join(token, randomPeerName('sender'));

    el('sendCancelBtn').addEventListener('click', () => window.location.reload());
}

async function beginSending(channel, files) {
    showPanel('transfer');
    el('sendTransferHeadline').textContent = 'Sending…';
    const list = el('sendTransferList');
    list.innerHTML = '';

    const samplesByFile = new Map();
    const manifestFiles = files.map((f, i) => ({ id: String(i), name: f.name, size: f.size }));
    for (const f of manifestFiles) list.appendChild(renderFileRow(f));

    const session = new SendSession({
        channel,
        files,
        onProgress: ({ fileId, sentBytes, totalBytes }) => {
            if (!samplesByFile.has(fileId)) samplesByFile.set(fileId, []);
            updateFileRowProgress(list, fileId, sentBytes, totalBytes, samplesByFile.get(fileId));
        },
        onFileSent: (fileId) => markFileRowComplete(list, fileId, { verified: null, fallbackLabel: 'Sent' }),
        onDone: () => {
            el('sendTransferHeadline').textContent = 'All files sent';
        },
    });

    await session.waitForReceiverReady();
    await session.sendAll();
}

function renderQrCode(url) {
    if (typeof window.QRCode !== 'function') return;
    el('sendQrWrap').hidden = false;
    try {
        // eslint-disable-next-line no-new -- QRCode renders into the DOM as a side effect
        new window.QRCode(el('sendQrBox'), {
            text: url,
            width: 180,
            height: 180,
            colorDark: '#000000',
            colorLight: '#ffffff',
        });
    } catch {
        el('sendQrWrap').hidden = true;
    }
}

async function requestSendCode(token) {
    try {
        const response = await fetch(`${API_BASE}/send/code`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: token }),
        });
        if (!response.ok) throw new Error(`send/code ${response.status}`);
        const { code } = await response.json();
        el('sendCodeValue').textContent = code;
    } catch (err) {
        console.warn('[VCPeer Send] could not mint a 6-digit code, link sharing still works', err);
        el('sendCodeValue').closest('.send-code').hidden = true;
    }
}

/* -------------------------------------------------------------------------- */
/* Receiver flow                                                              */
/* -------------------------------------------------------------------------- */

async function resolveReceiverToken() {
    const params = new URLSearchParams(window.location.search);
    const linkToken = params.get('r');
    if (linkToken) return isValidRoomToken(linkToken) ? linkToken : null;

    const code = params.get('c');
    if (code) {
        try {
            const response = await fetch(`${API_BASE}/send/code/${encodeURIComponent(code)}`, {
                credentials: 'same-origin',
            });
            if (!response.ok) return null;
            const { channel } = await response.json();
            return isValidRoomToken(channel) ? channel : null;
        } catch {
            return null;
        }
    }
    return null;
}

async function startReceiverFlow(token) {
    showPanel('connecting');

    const signaling = new SignalingClient();
    const peers = new Map(); // peer_id -> PeerSession

    signaling.on('addPeer', ({ peer_id, should_create_offer, iceServers }) => {
        if (peers.has(peer_id)) return;

        const session = new PeerSession({
            peerId: peer_id,
            iceServers,
            shouldCreateOffer: should_create_offer,
            signaling,
            onDataChannel: ({ channel }) => {
                const begin = () => wireReceiveSession(channel, signaling, peer_id);
                if (channel.readyState === 'open') begin();
                else channel.addEventListener('open', begin, { once: true });
            },
        });
        peers.set(peer_id, session);
    });

    signaling.on('sessionDescription', ({ peer_id, session_description }) => {
        peers.get(peer_id)?.handleRemoteSessionDescription(session_description);
    });
    signaling.on('iceCandidate', ({ peer_id, ice_candidate }) => {
        peers.get(peer_id)?.handleRemoteIceCandidate(ice_candidate);
    });
    signaling.on('removePeer', ({ peer_id }) => {
        peers.get(peer_id)?.close();
        peers.delete(peer_id);
        if (panels.complete.hidden) showError('The sender disconnected before the transfer finished.');
    });

    signaling.join(token, randomPeerName('receiver'));
}

function wireReceiveSession(channel, signaling, senderPeerId) {
    const samplesByFile = new Map();

    const session = new ReceiveSession({
        channel,
        onManifest: (manifest) => {
            showPanel('manifest');
            el('sendManifestHeadline').textContent =
                manifest.files.length === 1 ? 'Incoming file' : `Incoming files (${manifest.files.length})`;
            const list = el('sendManifestList');
            list.innerHTML = '';
            for (const file of manifest.files) list.appendChild(renderFileRow(file));

            el('sendAcceptBtn').addEventListener(
                'click',
                async () => {
                    el('sendAcceptBtn').disabled = true;
                    try {
                        await session.accept();
                        showPanel('transfer');
                        el('sendTransferHeadline').textContent = 'Receiving…';
                        el('sendTransferList').innerHTML = el('sendManifestList').innerHTML;
                    } catch (err) {
                        console.error('[VCPeer Send] accept() failed', err);
                        showError('Could not start the transfer. Please try again.');
                    }
                },
                { once: true }
            );
        },
        onProgress: ({ fileId, receivedBytes, totalBytes }) => {
            if (!samplesByFile.has(fileId)) samplesByFile.set(fileId, []);
            updateFileRowProgress(el('sendTransferList'), fileId, receivedBytes, totalBytes, samplesByFile.get(fileId));
        },
        onFileComplete: ({ fileId, verified, blob, name }) => {
            markFileRowComplete(el('sendTransferList'), fileId, { verified, blob, name });
        },
        onDone: () => {
            el('sendCompleteList').innerHTML = el('sendTransferList').innerHTML;
            showPanel('complete');
        },
        onAbort: (reason) => showError(reason),
    });

    // keep references reachable for GC-safety debugging; no-op otherwise
    window.__vcpeerSendDebug = { channel, signaling, senderPeerId, session };
}

/* -------------------------------------------------------------------------- */
/* Dropzone + boot                                                            */
/* -------------------------------------------------------------------------- */

function wireDropzone() {
    const dropzone = el('sendDropzone');
    const input = el('sendFileInput');

    input.addEventListener('change', () => {
        if (input.files.length) startSenderFlow(Array.from(input.files));
    });

    ['dragenter', 'dragover'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.add('is-dragover');
        })
    );
    ['dragleave', 'drop'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.remove('is-dragover');
        })
    );
    dropzone.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) startSenderFlow(files);
    });

    el('sendCopyBtn').addEventListener('click', async () => {
        const link = el('sendShareLink');
        try {
            await navigator.clipboard.writeText(link.value);
            const original = el('sendCopyBtn').textContent;
            el('sendCopyBtn').textContent = 'Copied';
            setTimeout(() => (el('sendCopyBtn').textContent = original), 1500);
        } catch {
            link.select();
        }
    });
}

const BANNER_TEXT_BY_MODE = {
    link: '"Send a link" uploads are encrypted at rest on our server (not end-to-end) so we can build zip downloads and previews — see the FAQ below. Switch to "Send now" for a direct, unlimited-size transfer that never touches our server at all.',
    now: '"Send now" streams directly between browsers over an encrypted WebRTC connection — nothing is ever uploaded to or stored on our server, and there is no size limit. Both devices need to stay online and the tab open until it finishes.',
};

/** Top-level mode tabs ("Send a link" default / "Send now (direct)"), only relevant on a fresh visit. */
function wireModeTabs() {
    const tabs = el('sendModeTabs');
    const linkRoot = el('sendLinkModeRoot');
    const nowRoot = el('sendNowModeRoot');

    tabs.querySelectorAll('.send-mode-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            tabs.querySelectorAll('.send-mode-tab').forEach((b) => {
                b.classList.toggle('is-active', b === btn);
                b.setAttribute('aria-selected', String(b === btn));
            });
            linkRoot.hidden = mode !== 'link';
            nowRoot.hidden = mode !== 'now';
            el('sendBannerText').textContent = BANNER_TEXT_BY_MODE[mode] || BANNER_TEXT_BY_MODE.link;
        });
    });
}

function hideAllTopLevelChrome() {
    el('sendModeTabs').hidden = true;
    el('sendLinkModeRoot').hidden = true;
    el('sendNowModeRoot').hidden = true;
}

async function boot() {
    wireDropzone();
    wireModeTabs();
    initLinkMode();

    const params = new URLSearchParams(window.location.search);

    // "Send a link" download page.
    const transferId = params.get('t');
    if (transferId) {
        hideAllTopLevelChrome();
        await renderDownloadPage(transferId);
        return;
    }

    // "Send a link" manage page (sender's private link).
    const manageToken = params.get('m');
    if (manageToken) {
        hideAllTopLevelChrome();
        await renderManagePage(manageToken);
        return;
    }

    // Live P2P ("Send now") receiver — opened via ?r=<token> or ?c=<code>.
    const token = await resolveReceiverToken();
    if (token) {
        hideAllTopLevelChrome();
        startReceiverFlow(token);
        return;
    }
    if (params.get('r') || params.get('c')) {
        hideAllTopLevelChrome();
        showError('This link looks invalid. Ask the sender for a new one at vcpeer.com/send.');
        return;
    }

    // Fresh visit: show the mode tabs, "Send a link" selected by default.
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
