'use strict';

// npx mocha tests/test-transferStore.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TransferStore } = require('../app/src/transfers/transferStore');

describe('test-transferStore', () => {
    let dataDir;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-transferstore-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates a record with generated id, createdAt, downloadCount=0, status=uploading', () => {
        const store = new TransferStore({ dataDir });
        const record = store.create({ delivery: 'link' });
        record.id.should.be.a.String();
        record.downloadCount.should.equal(0);
        record.status.should.equal('uploading');
        record.delivery.should.equal('link');
    });

    it('get() returns the created record', () => {
        const store = new TransferStore({ dataDir });
        const record = store.create({ delivery: 'link' });
        store.get(record.id).should.deepEqual(record);
    });

    it('get() returns null for an unknown id', () => {
        const store = new TransferStore({ dataDir });
        (store.get('nope') === null).should.be.true();
    });

    it('update() applies an immutable patch and persists it', () => {
        const store = new TransferStore({ dataDir });
        const record = store.create({ delivery: 'link', downloadCount: 0 });
        const updated = store.update(record.id, (r) => ({ ...r, downloadCount: r.downloadCount + 1 }));
        updated.downloadCount.should.equal(1);
        store.get(record.id).downloadCount.should.equal(1);
        record.downloadCount.should.equal(0); // original object untouched
    });

    it('update() on an unknown id returns null', () => {
        const store = new TransferStore({ dataDir });
        (store.update('nope', (r) => r) === null).should.be.true();
    });

    it('remove() deletes the record', () => {
        const store = new TransferStore({ dataDir });
        const record = store.create({ delivery: 'link' });
        store.remove(record.id);
        (store.get(record.id) === null).should.be.true();
    });

    it('all() lists every record', () => {
        const store = new TransferStore({ dataDir });
        store.create({ delivery: 'link' });
        store.create({ delivery: 'email' });
        store.all().length.should.equal(2);
    });

    it('findByManageToken() locates a record by its manage token', () => {
        const store = new TransferStore({ dataDir });
        const record = store.create({ delivery: 'link', manageToken: 'abc123' });
        store.findByManageToken('abc123').id.should.equal(record.id);
        (store.findByManageToken('unknown') === null).should.be.true();
    });

    it('survives a reload: a fresh TransferStore over the same dataDir sees prior records', () => {
        const store1 = new TransferStore({ dataDir });
        const record = store1.create({ delivery: 'link', totalBytes: 123 });

        const store2 = new TransferStore({ dataDir });
        const reloaded = store2.get(record.id);
        reloaded.should.not.be.null();
        reloaded.totalBytes.should.equal(123);
    });
});
