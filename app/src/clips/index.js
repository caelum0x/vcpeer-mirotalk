'use strict';

const path = require('path');
const Logs = require('../logs');
const { createStorage } = require('../storage');
const { ClipStore } = require('./clipStore');
const { QuotaTracker } = require('../transfers/quota');
const { startCleanupJob } = require('./cleanupJob');
const { createClipRoutes } = require('./clipRoutes');

const log = new Logs('ClipSend');

// Mirrors the defaults in config.template.js. A deployed app/src/config.js is
// a one-time copy of the template made at install time (see install.sh) and
// is never re-synced on later deploys, so an existing production config.js
// predating this feature will have no `clips` key at all. Without this
// fallback, `config.clips.dataDir` etc. below would throw at server startup
// and take down the entire app, not just async recordings — so default
// instead of crashing. Same pattern as transfers/index.js.
const DEFAULT_CLIPS_CONFIG = {
    storageDriver: 'local',
    dataDir: path.join(__dirname, '..', 'data', 'clips'),
    chunkBytes: 4 * 1024 * 1024, // 4 MiB — recordings are usually smaller than "Send a link" transfers
    maxClipBytes: 1 * 1024 * 1024 * 1024, // 1 GiB cap per recording
    dailyIpQuotaBytes: 5 * 1024 * 1024 * 1024, // 5 GiB/day/IP
    defaultExpiryDays: 30,
    cleanupIntervalMs: 15 * 60 * 1000,
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', endpoint: '', region: 'auto' },
};

/**
 * Wires up VCPeer's async "Record & share" feature (Loom-style: record once
 * — in a room, solo or with others — upload, get a shareable link, the
 * viewer watches it later with a view counter). Storage backend, persisted
 * clip metadata, an IP quota tracker, the periodic expiry cleanup job, and
 * the `/api/v1/clips*` router — all from `config.clips` (see
 * config.template.js). Call once at server startup (app/src/server.js).
 *
 * @param {object} config the full app config (uses config.clips)
 * @returns {{ router: import('express').Router, store: ClipStore, storage: object, stopCleanupJob: () => void }}
 */
function initClips(config) {
    if (!config.clips) {
        log.warn(
            'config.clips is missing (stale config.js predating VCPeer async recordings) — falling back to defaults. Run app/src/config.template.js\'s new "clips" block into the deployed config.js to configure this properly.'
        );
    }
    const clipsConfig = { ...DEFAULT_CLIPS_CONFIG, ...(config.clips || {}) };
    // Metadata (meta.json) and blob storage (chunk files) must live under
    // separate subdirectories, not both directly in clipsConfig.dataDir/<id>/:
    // LocalDiskStorage's local driver stores a clip's parts at
    // "<dataDir>/<id>/00000001" etc (storage key = plain clip id, see
    // clipRoutes.js — unlike transfers, there's no fileId to add a nesting
    // level), so a meta.json dropped in that same "<id>/" directory would get
    // misread back by listParts() as a bogus extra "part" on the next upload
    // status check or finalize.
    const store = new ClipStore({ dataDir: path.join(clipsConfig.dataDir, 'meta') });
    const storage = createStorage({ ...clipsConfig, dataDir: path.join(clipsConfig.dataDir, 'blobs') });
    const ipQuota = new QuotaTracker({ limit: clipsConfig.dailyIpQuotaBytes });

    const cleanupTimer = startCleanupJob({
        store,
        storage,
        intervalMs: clipsConfig.cleanupIntervalMs,
        onError: (msg, err) => log.error(msg, err?.message || err),
    });

    const pruneTimer = setInterval(() => ipQuota.pruneOldDays(), 30 * 60 * 1000);
    if (pruneTimer.unref) pruneTimer.unref();

    const router = createClipRoutes({ config: clipsConfig, store, storage, ipQuota, log });

    return {
        router,
        store,
        storage,
        stopCleanupJob: () => {
            clearInterval(cleanupTimer);
            clearInterval(pruneTimer);
        },
    };
}

module.exports = { initClips };
