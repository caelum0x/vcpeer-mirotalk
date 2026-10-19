'use strict';

// npx mocha tests/test-clipCleanupJob.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClipStore } = require('../app/src/clips/clipStore');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');
const { cleanupOnce } = require('../app/src/clips/cleanupJob');

describe('test-clipCleanupJob', () => {
    let dataDir;
    let store;
    let storage;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-clip-cleanup-'));
        // Metadata and blob storage must be separate directories — see the
        // comment in app/src/clips/index.js.
        store = new ClipStore({ dataDir: path.join(dataDir, 'meta') });
        storage = new LocalDiskStorage({ baseDir: path.join(dataDir, 'blobs') });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('leaves a non-expired clip alone', async () => {
        const record = store.create({ status: 'ready', expiresAt: Date.now() + 100000 });
        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([]);
        (store.get(record.id) === null).should.be.false();
    });

    it('removes an expired clip and its storage blob', async () => {
        const record = store.create({ status: 'ready', expiresAt: Date.now() - 1000 });
        await storage.putPart(record.id, 1, Buffer.from('data'));

        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([record.id]);
        (store.get(record.id) === null).should.be.true();
        (await storage.exists(record.id)).should.be.false();
    });

    it('skips already-deleted records', async () => {
        const record = store.create({ status: 'deleted', expiresAt: Date.now() - 1000 });
        const removed = await cleanupOnce({ store, storage, now: Date.now });
        removed.should.deepEqual([]);
        (store.get(record.id) === null).should.be.false(); // cleanupJob doesn't touch already-deleted records
    });

    it('continues past a storage deletion error for one clip and still removes others', async () => {
        const broken = store.create({ status: 'ready', expiresAt: Date.now() - 1000 });
        const ok = store.create({ status: 'ready', expiresAt: Date.now() - 1000 });
        const errors = [];
        const failingStorage = {
            deleteAll: async (key) => {
                if (key === broken.id) throw new Error('disk error');
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
