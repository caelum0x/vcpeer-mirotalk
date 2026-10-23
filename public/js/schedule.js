'use strict';

/**
 * /schedule — create-a-meeting form, and /schedule/:id — the resulting
 * shareable view page (join link, calendar invite, cancel). Same
 * dependency-free, client-rendered pattern as public/js/myRooms.js. Both
 * paths are served the same static page (app/src/server.js) and this script
 * decides which mode to render from the current URL.
 */

const createForm = document.getElementById('createForm');
const formStatus = document.getElementById('formStatus');
const submitBtn = document.getElementById('submitBtn');

const viewLoading = document.getElementById('viewLoading');
const viewError = document.getElementById('viewError');
const resultCard = document.getElementById('resultCard');

function getScheduleIdFromPath() {
    const match = /\/schedule\/([^/?#]+)/.exec(window.location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
}

function setFormStatus(text, kind) {
    formStatus.textContent = text || '';
    formStatus.className = 'status-message' + (kind ? ` status-${kind}` : '');
}

function formatWhen(startTime, durationMinutes) {
    const start = new Date(startTime);
    const end = new Date(startTime + durationMinutes * 60 * 1000);
    const dateFmt = { year: 'numeric', month: 'short', day: 'numeric' };
    const timeFmt = { hour: 'numeric', minute: '2-digit' };
    return (
        start.toLocaleDateString(undefined, dateFmt) +
        ' · ' +
        start.toLocaleTimeString(undefined, timeFmt) +
        ' – ' +
        end.toLocaleTimeString(undefined, timeFmt)
    );
}

function toGoogleCalUtc(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildGoogleCalUrl(schedule) {
    const start = toGoogleCalUtc(schedule.startTime);
    const end = toGoogleCalUtc(schedule.startTime + schedule.durationMinutes * 60 * 1000);
    const details = [schedule.description, `Join: ${schedule.roomUrl}`].filter(Boolean).join('\n\n');
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: schedule.title,
        dates: `${start}/${end}`,
        details,
        location: schedule.roomUrl,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Renders the result card for either a just-created schedule (which
 * includes id/url/manageUrl/icsUrl from the create response) or a fetched
 * one (schedule record + computed roomUrl). `manageToken` is only non-null
 * right after creation, or when present as a ?manageToken= query param on
 * an already-shared manage link — never otherwise, so Cancel is never
 * discoverable from the plain share link.
 */
function renderResult({ schedule, shareUrl, icsUrl, manageToken }) {
    document.getElementById('resultTitle').innerText = schedule.title;
    document.getElementById('resultWhen').innerText = formatWhen(schedule.startTime, schedule.durationMinutes);

    const organizerEl = document.getElementById('resultOrganizer');
    if (schedule.organizerName) {
        organizerEl.hidden = false;
        organizerEl.innerText = `Organized by ${schedule.organizerName}`;
    }

    const descriptionEl = document.getElementById('resultDescription');
    if (schedule.description) {
        descriptionEl.hidden = false;
        descriptionEl.innerText = schedule.description;
    }

    document.getElementById('joinBtn').href = schedule.roomUrl;
    document.getElementById('icsBtn').href = icsUrl;
    document.getElementById('googleCalBtn').href = buildGoogleCalUrl(schedule);

    const shareInput = document.getElementById('shareUrlInput');
    shareInput.value = shareUrl;
    document.getElementById('copyShareBtn').addEventListener('click', async (event) => {
        const label = event.currentTarget.querySelector('span');
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

    if (manageToken) {
        const cancelBtn = document.getElementById('cancelBtn');
        cancelBtn.hidden = false;
        cancelBtn.addEventListener('click', async () => {
            if (!window.confirm('Cancel this scheduled meeting? This cannot be undone.')) return;
            cancelBtn.disabled = true;
            try {
                await axios.delete(`/api/v1/schedule/manage/${encodeURIComponent(manageToken)}`);
                resultCard.hidden = true;
                viewError.hidden = false;
                viewError.innerText = 'This meeting has been cancelled.';
            } catch {
                cancelBtn.disabled = false;
                window.alert('Could not cancel this meeting. Please try again.');
            }
        });
    }

    resultCard.hidden = false;
}

async function handleCreate(event) {
    event.preventDefault();

    const startInput = document.getElementById('startInput');
    const startTime = startInput.value ? new Date(startInput.value).getTime() : NaN;
    if (!Number.isFinite(startTime)) {
        setFormStatus('Choose a valid date and time.', 'error');
        return;
    }

    const payload = {
        title: document.getElementById('titleInput').value.trim(),
        description: document.getElementById('descriptionInput').value.trim(),
        organizerName: document.getElementById('organizerInput').value.trim(),
        roomId: document.getElementById('roomIdInput').value.trim(),
        startTime,
        durationMinutes: parseInt(document.getElementById('durationInput').value, 10),
    };

    submitBtn.disabled = true;
    setFormStatus('Scheduling…', 'loading');

    try {
        const response = await axios.post('/api/v1/schedule', payload);
        const { url, manageUrl, roomUrl, icsUrl } = response.data;
        const manageToken = new URL(manageUrl).searchParams.get('manageToken');

        createForm.hidden = true;
        setFormStatus('');
        document.getElementById('pageTitle').innerText = 'Meeting scheduled';
        document.getElementById('pageSubtitle').innerText =
            'Save this page (or the link below) — it is the only way to manage this meeting.';

        renderResult({
            schedule: { ...payload, roomUrl },
            shareUrl: manageUrl,
            icsUrl,
            manageToken,
        });

        // Keep the browser's address bar in sync with the real resource
        // without a navigation (and without losing the manageToken from the
        // view, which only this page's creator should ever see).
        window.history.replaceState(null, '', `${url}?manageToken=${manageToken}`);
    } catch (err) {
        const message = (err.response && err.response.data && err.response.data.message) || 'Something went wrong.';
        setFormStatus(message, 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

async function loadExisting(id) {
    createForm.hidden = true;
    viewLoading.hidden = false;

    let schedule;
    try {
        const response = await axios.get(`/api/v1/schedule/${encodeURIComponent(id)}`);
        schedule = response.data;
    } catch {
        viewLoading.hidden = true;
        viewError.hidden = false;
        return;
    }

    document.title = `${schedule.title} — VCPeer`;
    document.getElementById('pageTitle').innerText = 'Scheduled meeting';
    document.getElementById('pageSubtitle').innerText = 'Share this link, or add it to your calendar.';

    const manageToken = new URLSearchParams(window.location.search).get('manageToken');
    const shareUrl = manageToken
        ? `${window.location.origin}/schedule/${id}?manageToken=${manageToken}`
        : `${window.location.origin}/schedule/${id}`;

    renderResult({
        schedule,
        shareUrl,
        icsUrl: `/api/v1/schedule/${id}/ics`,
        manageToken,
    });

    viewLoading.hidden = true;
}

const scheduleId = getScheduleIdFromPath();
if (scheduleId) {
    loadExisting(scheduleId);
} else {
    // Default the date/time picker to one hour from now, rounded to the
    // next 15 minutes, so a real organizer isn't stuck picking today's date
    // by hand before they can even get to the time.
    const startInput = document.getElementById('startInput');
    const defaultStart = new Date(Date.now() + 60 * 60 * 1000);
    defaultStart.setMinutes(Math.ceil(defaultStart.getMinutes() / 15) * 15, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    startInput.value = `${defaultStart.getFullYear()}-${pad(defaultStart.getMonth() + 1)}-${pad(defaultStart.getDate())}T${pad(defaultStart.getHours())}:${pad(defaultStart.getMinutes())}`;

    // Arrived from the in-call "Schedule a meeting" button
    // (public/js/client.js scheduleMeetingBtn) — prefill the same room name
    // so the invite points back at the room they were just in.
    const presetRoomId = new URLSearchParams(window.location.search).get('roomId');
    if (presetRoomId) {
        document.getElementById('roomIdInput').value = presetRoomId;
    }

    createForm.addEventListener('submit', handleCreate);
}
