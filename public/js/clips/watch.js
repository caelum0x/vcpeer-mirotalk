'use strict';

import { getClipMeta, registerClipView, clipVideoUrl, watchUrl } from './clip-api.js';

/** Extracts the clip id from a /watch/:id path, without relying on an Express router on the client. */
function getClipIdFromPath() {
    const match = /\/watch\/([^/?#]+)/.exec(window.location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
}

function formatDate(ms) {
    try {
        return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

function formatViews(count) {
    return `${count} view${count === 1 ? '' : 's'}`;
}

async function main() {
    const loadingEl = document.getElementById('watchLoading');
    const errorEl = document.getElementById('watchError');
    const playerEl = document.getElementById('watchPlayer');

    const clipId = getClipIdFromPath();
    if (!clipId) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        return;
    }

    let meta;
    try {
        meta = await getClipMeta(clipId);
    } catch {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        return;
    }

    document.title = `${meta.title || 'Recording'} — VCPeer`;
    document.getElementById('watchTitle').innerText = meta.title || 'Recording';
    document.getElementById('watchDate').innerText = formatDate(meta.createdAt);
    document.getElementById('watchVideo').src = clipVideoUrl(clipId);

    const shareInput = document.getElementById('watchShareUrl');
    shareInput.value = watchUrl(clipId);
    document.getElementById('watchCopyBtn').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const originalText = button.innerText;
        try {
            await navigator.clipboard.writeText(shareInput.value);
            button.innerText = 'Copied!';
        } catch {
            shareInput.select();
            button.innerText = 'Select & copy';
        }
        setTimeout(() => {
            button.innerText = originalText;
        }, 2000);
    });

    loadingEl.hidden = true;
    playerEl.hidden = false;

    const viewCountEl = document.getElementById('watchViewCount');
    viewCountEl.innerText = formatViews(meta.viewCount);
    // Count the view once this page has actually rendered a player for a
    // real clip — not on every background/prefetch request to /:id above.
    registerClipView(clipId)
        .then((result) => {
            viewCountEl.innerText = formatViews(result.viewCount);
        })
        .catch(() => {
            // Non-critical: the view counter is a nice-to-have, never blocks playback.
        });
}

main();
