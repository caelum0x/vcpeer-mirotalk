'use strict';

/**
 * VCPeer Coworker — async text follow-up widget (public/views/coworker.html).
 *
 * Plain vanilla JS, no build step, matching every other VCPeer page (there is
 * no React/bundler in this app). Keeps the thread id in localStorage so a
 * returning visitor resumes the same conversation, and honours a `?thread=`
 * query param so a user can jump into a specific thread (e.g. `room:<id>` to
 * continue a conversation started during a live call — see
 * app/src/coworker/index.js `appendRoomExchange`).
 */
(function () {
    const STORAGE_KEY = 'vcpeer_coworker_thread_id';
    const API_BASE = '/api/v1/coworker';

    const logEl = document.getElementById('coworkerLog');
    const formEl = document.getElementById('coworkerForm');
    const inputEl = document.getElementById('coworkerInput');
    const statusEl = document.getElementById('coworkerStatus');

    if (!logEl || !formEl || !inputEl || !statusEl) return;

    function getRequestedThreadId() {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get('thread');
        if (fromQuery) return fromQuery;
        return window.localStorage.getItem(STORAGE_KEY) || '';
    }

    let threadId = getRequestedThreadId();

    function persistThreadId(id) {
        threadId = id;
        try {
            window.localStorage.setItem(STORAGE_KEY, id);
        } catch (_err) {
            // Storage can be unavailable (private browsing, quota); the
            // conversation still works, it just won't resume on reload.
        }
    }

    function setStatus(text, isError) {
        statusEl.textContent = text || '';
        statusEl.classList.toggle('error', Boolean(isError));
    }

    function renderHistory(history) {
        logEl.innerHTML = '';
        if (!history || history.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'coworker-empty';
            empty.textContent = 'Ask anything — about VCPeer, your work, or just to think something through.';
            logEl.appendChild(empty);
            return;
        }
        history.forEach((message) => {
            const row = document.createElement('div');
            row.className = `coworker-msg ${message.role === 'assistant' ? 'assistant' : 'user'}`;
            const roleLabel = document.createElement('span');
            roleLabel.className = 'coworker-role';
            roleLabel.textContent = message.role === 'assistant' ? 'VCPeer Coworker' : 'You';
            const body = document.createElement('span');
            body.textContent = message.content;
            row.appendChild(roleLabel);
            row.appendChild(body);
            logEl.appendChild(row);
        });
        logEl.scrollTop = logEl.scrollHeight;
    }

    async function loadThread(id) {
        if (!id) return;
        try {
            const response = await fetch(`${API_BASE}/thread/${encodeURIComponent(id)}`);
            if (!response.ok) return;
            const data = await response.json();
            renderHistory(data.history);
        } catch (_err) {
            // No history yet, or offline — the empty-state message already covers this.
        }
    }

    async function sendMessage(message) {
        setStatus('VCPeer Coworker is thinking...');
        formEl.querySelector('button[type="submit"]').disabled = true;

        try {
            const response = await fetch(`${API_BASE}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threadId, message }),
            });
            const data = await response.json();

            if (!response.ok) {
                setStatus(data.error || 'Something went wrong. Please try again.', true);
                return;
            }

            if (data.threadId) persistThreadId(data.threadId);
            renderHistory(data.history);
            setStatus('');
        } catch (_err) {
            setStatus('Network error — please try again.', true);
        } finally {
            formEl.querySelector('button[type="submit"]').disabled = false;
        }
    }

    formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = inputEl.value.trim();
        if (!message) return;
        inputEl.value = '';
        sendMessage(message);
    });

    inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            formEl.requestSubmit();
        }
    });

    loadThread(threadId);
})();
