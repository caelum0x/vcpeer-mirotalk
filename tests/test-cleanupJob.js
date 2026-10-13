'use strict';

// npx mocha tests/test-cleanupJob.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TransferStore } = require('../app/src/transfers/transferStore');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');
const { cleanupOnce } = require('../app/src/transfers/cleanupJob');

describe('test-cleanupJob', () => {
    let dataDir;
    let store;
    let storage;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-cleanup-'));
        store = new TransferStore({ dataDir });
        storage = new LocalDiskStorage({ baseDir: dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('leaves a non-expired, under-limit transfer alone', async () => {
        const record = store.create({
            status: 'ready',
            expiresAt: Date.now() + 100000,
            maxDownloads: null,
            downloadCount: 0,
            files: [{ fileId: 'f1' }],
        });
        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([]);
        (store.get(record.id) === null).should.be.false();
    });

    it('removes an expired transfer and its storage blobs', async () => {
        const record = store.create({
            status: 'ready',
            expiresAt: Date.now() - 1000,
            maxDownloads: null,
            downloadCount: 0,
            files: [{ fileId: 'f1' }],
        });
        await storage.putPart(`${record.id}/f1`, 1, Buffer.from('data'));

        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([record.id]);
        (store.get(record.id) === null).should.be.true();
        (await storage.exists(`${record.id}/f1`)).should.be.false();
    });

    it('removes a transfer that has reached its download limit', async () => {
        const record = store.create({
            status: 'ready',
            expiresAt: Date.now() + 100000,
            maxDownloads: 1,
            downloadCount: 1,
            files: [{ fileId: 'f1' }],
        });
        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([record.id]);
    });

    it('skips already-deleted records', async () => {
        const record = store.create({ status: 'deleted', expiresAt: Date.now() - 1000, files: [] });
        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([]);
        (store.get(record.id) === null).should.be.false(); // cleanupJob doesn't touch already-deleted records
    });

    it('continues past a storage deletion error for one transfer and still removes others', async () => {
        const broken = store.create({
            status: 'ready',
            expiresAt: Date.now() - 1000,
            files: [{ fileId: 'f1' }],
        });
        const ok = store.create({
            status: 'ready',
            expiresAt: Date.now() - 1000,
            files: [{ fileId: 'f1' }],
        });
        const errors = [];
        const failingStorage = {
            deleteAll: async (key) => {
                if (key.startsWith(broken.id)) throw new Error('disk error');
            },
        };
        const removed = await cleanupOnce({
            store,
            storage: failingStorage,
            now: Date.now,
            onError: (msg) => errors.push(msg),
        });
        removed.sort().should.deepEqual([broken.id, ok.id].sort());
        errors.length.should.equal(1);
    });
});
