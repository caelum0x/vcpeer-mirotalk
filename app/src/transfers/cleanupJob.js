'use strict';

/**
 * Deletes expired (or download-limit-exhausted, or owner-deleted) VCPeer Send
 * transfers: their storage blobs first, then their metadata record. Exported
 * as a pure async function (`cleanupOnce`) so tests can call it directly with
 * a fake clock/store/storage instead of waiting on a real interval timer.
 */

/**
 * @param {object} options
 * @param {import('./transferStore').TransferStore} options.store
 * @param {import('../storage/StorageInterface')} options.storage duck-typed storage backend
 * @param {() => number} [options.now]
 * @param {(msg: string, err?: unknown) => void} [options.onError]
 * @returns {Promise<string[]>} ids of transfers removed
 */
async function cleanupOnce({ store, storage, now = Date.now, onError = () => {} }) {
    const removedIds = [];
    for (const record of store.all()) {
        if (record.status === 'deleted') continue;
        const expired = typeof record.expiresAt === 'number' && record.expiresAt <= now();
        const overLimit = typeof record.maxDownloads === 'number' && record.downloadCount >= record.maxDownloads;
        if (!expired && !overLimit) continue;

        for (const file of record.files || []) {
            try {
                // eslint-disable-next-line no-await-in-loop -- bounded by file count per transfer
                await storage.deleteAll(`${record.id}/${file.fileId}`);
            } catch (err) {
                onError(`cleanup: failed to delete storage for ${record.id}/${file.fileId}`, err);
            }
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
        cleanupOnce({ store, storage, now, onError }).catch((err) => onError('cleanup job failed', err));
    }, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { cleanupOnce, startCleanupJob };
