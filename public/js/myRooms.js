'use strict';

const lookupForm = document.getElementById('lookupForm');
const emailInput = document.getElementById('emailInput');
const lookupBtn = document.getElementById('lookupBtn');
const statusMessage = document.getElementById('statusMessage');
const roomsList = document.getElementById('roomsList');

// Sticky across a reload of this tab only (never sent anywhere but our own
// lookup endpoint) so a user who bounces back to this page doesn't retype.
try {
    const remembered = window.sessionStorage.getItem('myRoomsEmail');
    if (remembered) emailInput.value = remembered;
} catch (e) {
    /* sessionStorage unavailable (private mode, etc.) — not fatal */
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`=\/]/g, (c) => {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#96;',
            '=': '&#61;',
            '/': '&#47;',
        }[c];
    });
}

function formatRelativeTime(timestampMs) {
    const diffMs = Date.now() - timestampMs;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
}

function setStatus(text, kind) {
    statusMessage.textContent = text || '';
    statusMessage.className = 'status-message' + (kind ? ` status-${kind}` : '');
}

function renderRooms(links) {
    if (!Array.isArray(links) || links.length === 0) {
        roomsList.innerHTML = '';
        setStatus('No room links found for that email yet.', 'empty');
        return;
    }

    setStatus('');
    roomsList.innerHTML = links
        .map(
            (link) => `
        <div class="room-card">
            <div class="room-card-main">
                <i class="fa-solid fa-video" aria-hidden="true"></i>
                <div class="room-card-text">
                    <div class="room-card-id">${escapeHtml(link.roomId)}</div>
                    <div class="room-card-time">${escapeHtml(formatRelativeTime(link.createdAt))}</div>
                </div>
            </div>
            <a class="room-card-join" href="${escapeHtml(link.roomUrl)}">
                <span>Join</span>
                <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </a>
        </div>
    `
        )
        .join('');
}

async function lookup(email) {
    lookupBtn.disabled = true;
    lookupBtn.classList.add('is-loading');
    setStatus('Looking up your rooms...', 'loading');

    try {
        const response = await axios.post('/api/v1/room-link/lookup', { email });
        renderRooms(response.data && response.data.links);
    } catch (err) {
        setStatus('Something went wrong. Please try again in a moment.', 'error');
    } finally {
        lookupBtn.disabled = false;
        lookupBtn.classList.remove('is-loading');
    }
}

lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    try {
        window.sessionStorage.setItem('myRoomsEmail', email);
    } catch (err) {
        /* ignore */
    }

    lookup(email);
});

// If the user arrived with ?email= pre-filled (e.g. from the room-link
// email itself), run the lookup immediately.
const presetEmail = new URLSearchParams(window.location.search).get('email');
if (presetEmail) {
    emailInput.value = presetEmail;
    lookup(presetEmail);
}
