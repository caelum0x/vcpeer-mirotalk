'use strict';

/**
 * Deletes expired (or owner-deleted) VCPeer clips: the single video blob
 * first, then the metadata record. Exported as a pure async function
 * (`cleanupOnce`) so tests can call it directly with a fake clock/store/
 * storage instead of waiting on a real interval timer.
 *
 * Simpler than transfers/cleanupJob.js: a clip has exactly one file (key is
 * just the clip id, no per-file fileId) and no download-count cap to check —
 * only `expiresAt`.
 */

/**
 * @param {object} options
 * @param {import('./clipStore').ClipStore} options.store
 * @param {import('../storage/StorageInterface')} options.storage duck-typed storage backend
 * @param {() => number} [options.now]
 * @param {(msg: string, err?: unknown) => void} [options.onError]
 * @returns {Promise<string[]>} ids of clips removed
 */
async function cleanupOnce({ store, storage, now = Date.now, onError = () => {} }) {
    const removedIds = [];
    for (const record of store.all()) {
        if (record.status === 'deleted') continue;
        const expired = typeof record.expiresAt === 'number' && record.expiresAt <= now();
        if (!expired) continue;

        try {
            // eslint-disable-next-line no-await-in-loop -- bounded by clip count, same pattern as transfers/cleanupJob.js
            await storage.deleteAll(record.id);
        } catch (err) {
            onError(`cleanup: failed to delete storage for clip ${record.id}`, err);
        }
        store.remove(record.id);
        removedIds.push(record.id);
    }
    return removedIds;
}

/**
 * @param {object} options same as cleanupOnce, plus:
 * @param {number} options.intervalMs
 * @returns {NodeJS.Timeout}
 */
function startCleanupJob({ store, storage, intervalMs, now, onError }) {
    const timer = setInterval(() => {
        cleanupOnce({ store, storage, now, onError }).catch((err) => onError('clip cleanup job failed', err));
    }, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { cleanupOnce, startCleanupJob };
