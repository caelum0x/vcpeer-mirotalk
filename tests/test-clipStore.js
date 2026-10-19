'use strict';

// npx mocha tests/test-clipStore.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClipStore } = require('../app/src/clips/clipStore');

describe('test-clipStore', () => {
    let dataDir;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-clipstore-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates a record with generated id, createdAt, viewCount=0, status=uploading', () => {
        const store = new ClipStore({ dataDir });
        const record = store.create({ title: 'My clip' });
        record.id.should.be.a.String();
        record.viewCount.should.equal(0);
        record.status.should.equal('uploading');
        record.title.should.equal('My clip');
    });

    it('get() returns the created record', () => {
        const store = new ClipStore({ dataDir });
        const record = store.create({ title: 'My clip' });
        store.get(record.id).should.deepEqual(record);
    });

    it('get() returns null for an unknown id', () => {
        const store = new ClipStore({ dataDir });
        (store.get('nope') === null).should.be.true();
    });

    it('update() applies an immutable patch and persists it', () => {
        const store = new ClipStore({ dataDir });
        const record = store.create({ title: 'My clip' });
        const updated = store.update(record.id, (r) => ({ ...r, viewCount: r.viewCount + 1 }));
        updated.viewCount.should.equal(1);
        store.get(record.id).viewCount.should.equal(1);
        record.viewCount.should.equal(0); // original object untouched
    });

    it('update() on an unknown id returns null', () => {
        const store = new ClipStore({ dataDir });
        (store.update('nope', (r) => r) === null).should.be.true();
    });

    it('remove() deletes the record', () => {
        const store = new ClipStore({ dataDir });
        const record = store.create({ title: 'My clip' });
        store.remove(record.id);
        (store.get(record.id) === null).should.be.true();
    });

    it('all() lists every record', () => {
        const store = new ClipStore({ dataDir });
        store.create({ title: 'One' });
        store.create({ title: 'Two' });
        store.all().length.should.equal(2);
    });

    it('findByManageToken() locates a record by its manage token', () => {
        const store = new ClipStore({ dataDir });
        const record = store.create({ title: 'My clip', manageToken: 'abc123' });
        store.findByManageToken('abc123').id.should.equal(record.id);
        (store.findByManageToken('unknown') === null).should.be.true();
    });

    it('survives a reload: a fresh ClipStore over the same dataDir sees prior records', () => {
        const store1 = new ClipStore({ dataDir });
        const record = store1.create({ title: 'My clip', size: 123 });

        const store2 = new ClipStore({ dataDir });
        const reloaded = store2.get(record.id);
        reloaded.should.not.be.null();
        reloaded.size.should.equal(123);
    });
});
