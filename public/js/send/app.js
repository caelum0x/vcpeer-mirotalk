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

/**
 * Renders a file-list `<li>` matching the .send-file-* CSS, shared across the
 * manifest/transfer/complete panels.
 * @param {{ id: string, name: string, size: number }} file
 * @returns {HTMLLIElement}
 */
function renderFileRow(file) {
    const li = document.createElement('li');
    li.className = 'send-file-row';
    li.dataset.fileId = file.id;
    li.innerHTML = `
        <span class="send-file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z" stroke-linejoin="round"/><path d="M15 2v5h5" stroke-linejoin="round"/></svg>
        </span>
        <span class="send-file-meta">
            <span class="send-file-name">${escapeHtml(file.name)}</span>
            <span class="send-file-size">${bytesToSize(file.size)}</span>
            <span class="send-file-progress-track"><span class="send-file-progress-bar"></span></span>
            <span class="send-file-stat"></span>
        </span>
    `;
    return li;
}

function escapeHtml(str) {
    return String(str).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}

function updateFileRowProgress(list, fileId, sentOrReceivedBytes, totalBytes, samples) {
    const row = list.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
    if (!row) return;
    const pct = clampPercent((sentOrReceivedBytes / Math.max(totalBytes, 1)) * 100);
    row.querySelector('.send-file-progress-bar').style.width = `${pct}%`;

    const now = Date.now();
    samples.push({ bytes: sentOrReceivedBytes, atMs: now });
    if (samples.length > 20) samples.shift();
    const throughput = estimateThroughput(samples);
    const remaining = totalBytes - sentOrReceivedBytes;

    row.querySelector('.send-file-stat').textContent =
        `${pct.toFixed(0)}% · ${formatSpeed(throughput)} · ${formatEta(remaining, throughput)} left`;
}

function markFileRowComplete(list, fileId, { verified, blob, name, fallbackLabel = 'Received' } = {}) {
    const row = list.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
    if (!row) return;
    row.querySelector('.send-file-progress-bar').style.width = '100%';
    const statEl = row.querySelector('.send-file-stat');

    if (verified === true) {
        statEl.innerHTML = '<span class="send-file-badge send-file-badge-verified">Verified</span>';
    } else if (verified === false) {
        statEl.innerHTML = '<span class="send-file-badge send-file-badge-unverified">Hash mismatch</span>';
    } else {
        statEl.textContent = fallbackLabel;
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.className = 'button button-secondary br-6 send-file-save-btn mt-8';
        link.textContent = `Save ${name}`;
        row.appendChild(link);
    }
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

    el('sendTelegramBtn').addEventListener('click', () => {
        const link = el('sendShareLink').value;
        if (!link) return;
        const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Sending you a file via VCPeer, no account needed:')}`;
        window.open(telegramUrl, '_blank', 'noopener,noreferrer');
    });
}

async function boot() {
    wireDropzone();

    const token = await resolveReceiverToken();
    if (token) {
        startReceiverFlow(token);
        return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('r') || params.get('c')) {
        showError('This link looks invalid. Ask the sender for a new one at vcpeer.com/send.');
    }
    // else: stay on the pick/drop panel (default state, already visible)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
