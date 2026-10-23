'use strict';

/**
 * /notes/:id — shareable viewer for a persisted meeting-notes snapshot
 * (transcript + optional AI summary/action items). Same client-rendered,
 * dependency-free pattern as public/js/clips/watch.js.
 */

function getNoteIdFromPath() {
    const match = /\/notes\/([^/?#]+)/.exec(window.location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
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

function formatDate(ms) {
    try {
        return new Date(ms).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

async function fetchNote(id) {
    const response = await fetch(`/api/v1/notes/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function renderTranscript(transcripts) {
    if (!Array.isArray(transcripts) || transcripts.length === 0) {
        return '<p class="notes-transcript-empty">No transcript lines were saved.</p>';
    }
    return transcripts
        .map(
            (line) => `
        <div class="notes-transcript-line">
            <span class="notes-transcript-meta">${escapeHtml(line.name)}${line.time ? ' · ' + escapeHtml(line.time) : ''}</span>
            <span class="notes-transcript-text">${escapeHtml(line.caption)}</span>
        </div>`
        )
        .join('');
}

function renderActionItems(actionItems) {
    if (!Array.isArray(actionItems) || actionItems.length === 0) return '';
    return actionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

const SUMMARY_STATUS_MESSAGE = {
    pending: 'Summary is still being generated — refresh in a moment.',
    unavailable: 'AI summary isn’t available on this deployment — the raw transcript below is still complete.',
    failed: 'AI summary failed to generate, but the raw transcript below is still complete.',
};

async function main() {
    const loadingEl = document.getElementById('notesLoading');
    const errorEl = document.getElementById('notesError');
    const pageEl = document.getElementById('notesPage');

    const noteId = getNoteIdFromPath();
    if (!noteId) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        return;
    }

    let note;
    try {
        note = await fetchNote(noteId);
    } catch {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        return;
    }

    document.title = `${note.roomId || 'Meeting'} notes — VCPeer`;
    document.getElementById('notesRoomId').innerText = note.roomId || 'Meeting notes';
    document.getElementById('notesDate').innerText = formatDate(note.createdAt);

    const shareUrl = `${window.location.origin}/notes/${noteId}`;
    const shareInput = document.getElementById('notesShareUrl');
    shareInput.value = shareUrl;
    document.getElementById('notesCopyBtn').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const label = button.querySelector('span');
        const originalText = label.innerText;
        try {
            await navigator.clipboard.writeText(shareInput.value);
            label.innerText = 'Copied';
        } catch {
            shareInput.select();
            label.innerText = 'Select & copy';
        }
        setTimeout(() => {
            label.innerText = originalText;
        }, 2000);
    });

    if (note.summary) {
        document.getElementById('notesSummaryBlock').hidden = false;
        document.getElementById('notesSummaryText').innerText = note.summary;
    }

    const actionItemsHtml = renderActionItems(note.actionItems);
    if (actionItemsHtml) {
        document.getElementById('notesActionsBlock').hidden = false;
        document.getElementById('notesActionsList').innerHTML = actionItemsHtml;
    }

    const statusMessage = SUMMARY_STATUS_MESSAGE[note.summaryStatus];
    if (statusMessage && !note.summary) {
        const statusEl = document.getElementById('notesSummaryStatus');
        statusEl.hidden = false;
        statusEl.innerText = statusMessage;
    }

    document.getElementById('notesTranscript').innerHTML = renderTranscript(note.transcripts);

    // A delete action only ever appears for whoever holds the manageToken
    // (passed as a query param in the link the creator was shown) — never
    // discoverable from the public share link itself.
    const manageToken = new URLSearchParams(window.location.search).get('manageToken');
    if (manageToken) {
        const deleteBtn = document.getElementById('notesDeleteBtn');
        deleteBtn.hidden = false;
        deleteBtn.addEventListener('click', async () => {
            if (!window.confirm('Delete these meeting notes? This cannot be undone.')) return;
            deleteBtn.disabled = true;
            try {
                const response = await fetch(`/api/v1/notes/manage/${encodeURIComponent(manageToken)}`, {
                    method: 'DELETE',
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                loadingEl.hidden = true;
                pageEl.hidden = true;
                errorEl.hidden = false;
                errorEl.innerText = 'These notes have been deleted.';
            } catch {
                deleteBtn.disabled = false;
                window.alert('Could not delete these notes. Please try again.');
            }
        });
    }

    loadingEl.hidden = true;
    pageEl.hidden = false;
}

main();
