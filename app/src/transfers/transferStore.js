'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Metadata store for VCPeer Send's "Send a link" transfers.
 *
 * One JSON file per transfer at `<dataDir>/<transferId>/meta.json`, loaded
 * into an in-memory cache on startup and rewritten atomically (write to a
 * temp file + rename) on every mutation. This is a small, low-traffic
 * feature on a single box — no database needed — but still needs to survive
 * a server restart, which a pure in-memory map would not.
 *
 * Never stores plaintext file bytes (those live in the storage backend,
 * see storage/StorageInterface.js) — this file holds the transfer's
 * server-managed encryption key (`encKeyB64`) alongside its own metadata,
 * which is what makes this "encryption at rest", not end-to-end: see
 * transfers/cryptoStream.js's header comment for the honest framing.
 */
class TransferStore {
    /** @param {{ dataDir: string }} options */
    constructor({ dataDir }) {
        this.dataDir = dataDir;
        this._cache = new Map(); // id -> record
        this._loadAll();
    }

    _metaPath(id) {
        return path.join(this.dataDir, id, 'meta.json');
    }

    _loadAll() {
        if (!fs.existsSync(this.dataDir)) return;
        let ids;
        try {
            ids = fs.readdirSync(this.dataDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of ids) {
            if (!entry.isDirectory()) continue;
            try {
                const raw = fs.readFileSync(this._metaPath(entry.name), 'utf8');
                this._cache.set(entry.name, JSON.parse(raw));
            } catch {
                // Missing/corrupt meta.json for this dir — skip it; cleanupJob will
                // eventually reconcile orphaned storage directories separately.
            }
        }
    }

    _persist(record) {
        const dir = path.join(this.dataDir, record.id);
        fs.mkdirSync(dir, { recursive: true });
        const tmpPath = this._metaPath(record.id) + `.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2));
        fs.renameSync(tmpPath, this._metaPath(record.id));
    }

    /**
     * @param {object} fields everything except id/createdAt/downloadCount, which this sets
     * @returns {object} the created record (with its id)
     */
    create(fields) {
        const id = crypto.randomBytes(12).toString('hex');
        const record = {
            id,
            createdAt: Date.now(),
            downloadCount: 0,
            downloadedFileIds: [],
            status: 'uploading',
            firstDownloadNotified: false,
            reports: 0,
            ...fields,
        };
        this._cache.set(id, record);
        this._persist(record);
        return record;
    }

    /** @param {string} id @returns {object|null} */
    get(id) {
        return this._cache.get(id) || null;
    }

    /**
     * @param {string} id
     * @param {(record: object) => object} patcher returns the new record (immutable update)
     * @returns {object|null} the updated record, or null if `id` doesn't exist
     */
    update(id, patcher) {
        const current = this._cache.get(id);
        if (!current) return null;
        const next = patcher({ ...current });
        this._cache.set(id, next);
        this._persist(next);
        return next;
    }

    /** @param {string} id */
    remove(id) {
        this._cache.delete(id);
        fsp.rm(path.join(this.dataDir, id), { recursive: true, force: true }).catch(() => {});
    }

    /** @returns {object[]} all transfer records (shallow copies) */
    all() {
        return Array.from(this._cache.values());
    }

    /** @param {string} manageToken @returns {object|null} */
    findByManageToken(manageToken) {
        for (const record of this._cache.values()) {
            if (record.manageToken === manageToken) return record;
        }
        return null;
    }
}

module.exports = { TransferStore };
