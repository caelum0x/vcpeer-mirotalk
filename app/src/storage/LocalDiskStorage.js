'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * Local-disk implementation of the VCPeer Send storage interface (see
 * StorageInterface.js for the full contract). Used by default
 * (SEND_LINK_STORAGE_DRIVER=local) — the Oracle box has no object storage, so
 * blobs are chunked straight to disk, one file per part.
 *
 * Layout under `baseDir`: `<key>/<partNumber padded>`, e.g.
 * `data/transfers/<transferId>/<fileId>/00000001`.
 */
class LocalDiskStorage {
    /** @param {{ baseDir: string }} options */
    constructor({ baseDir }) {
        if (!baseDir) throw new Error('LocalDiskStorage requires a baseDir');
        this.baseDir = baseDir;
    }

    _dir(key) {
        return path.join(this.baseDir, key);
    }

    _partPath(key, partNumber) {
        return path.join(this._dir(key), String(partNumber).padStart(8, '0'));
    }

    /**
     * @param {string} key
     * @param {number} partNumber 1-based
     * @param {Buffer} buffer ciphertext for this part
     * @returns {Promise<{ size: number }>}
     */
    async putPart(key, partNumber, buffer) {
        await fsp.mkdir(this._dir(key), { recursive: true });
        await fsp.writeFile(this._partPath(key, partNumber), buffer);
        return { size: buffer.length };
    }

    /**
     * @param {string} key
     * @returns {Promise<Array<{ partNumber: number, size: number }>>}
     */
    async listParts(key) {
        let entries;
        try {
            entries = await fsp.readdir(this._dir(key));
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
        const parts = [];
        for (const entry of entries) {
            // eslint-disable-next-line no-await-in-loop -- small directories, clarity over micro-parallelism
            const stat = await fsp.stat(path.join(this._dir(key), entry));
            parts.push({ partNumber: Number(entry), size: stat.size });
        }
        return parts.sort((a, b) => a.partNumber - b.partNumber);
    }

    /**
     * @param {string} key
     * @param {number} partNumber
     * @returns {Promise<fs.ReadStream>}
     */
    // eslint-disable-next-line require-await
    async getPartStream(key, partNumber) {
        return fs.createReadStream(this._partPath(key, partNumber));
    }

    /** @param {string} key */
    async deleteAll(key) {
        await fsp.rm(this._dir(key), { recursive: true, force: true });
    }

    /** @param {string} key @returns {Promise<number>} */
    async totalSize(key) {
        const parts = await this.listParts(key);
        return parts.reduce((sum, p) => sum + p.size, 0);
    }

    /** @param {string} key @returns {Promise<boolean>} */
    async exists(key) {
        return (await this.listParts(key)).length > 0;
    }

    /** Remove an entire transfer's directory tree (every file's every part). @param {string} transferId */
    async deleteTransferDir(transferId) {
        await fsp.rm(path.join(this.baseDir, transferId), { recursive: true, force: true });
    }
}

module.exports = LocalDiskStorage;
