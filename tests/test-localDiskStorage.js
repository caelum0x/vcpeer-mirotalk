'use strict';

// npx mocha tests/test-localDiskStorage.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');

describe('test-localDiskStorage', () => {
    let baseDir;
    let storage;

    beforeEach(() => {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-storage-'));
        storage = new LocalDiskStorage({ baseDir });
    });

    afterEach(() => {
        fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('starts with no parts for an unknown key', async () => {
        (await storage.listParts('t1/f1')).should.deepEqual([]);
        (await storage.exists('t1/f1')).should.be.false();
        (await storage.totalSize('t1/f1')).should.equal(0);
    });

    it('writes and lists parts in ascending order regardless of write order', async () => {
        await storage.putPart('t1/f1', 2, Buffer.from('bbb'));
        await storage.putPart('t1/f1', 1, Buffer.from('aa'));
        const parts = await storage.listParts('t1/f1');
        parts.should.deepEqual([
            { partNumber: 1, size: 2 },
            { partNumber: 2, size: 3 },
        ]);
    });

    it('reads back exactly what was written for each part', async () => {
        await storage.putPart('t1/f1', 1, Buffer.from('hello'));
        const stream = await storage.getPartStream('t1/f1', 1);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        Buffer.concat(chunks).toString('utf8').should.equal('hello');
    });

    it('totalSize sums all parts', async () => {
        await storage.putPart('t1/f1', 1, Buffer.alloc(10));
        await storage.putPart('t1/f1', 2, Buffer.alloc(20));
        (await storage.totalSize('t1/f1')).should.equal(30);
    });

    it('exists is true once at least one part is written', async () => {
        await storage.putPart('t1/f1', 1, Buffer.from('x'));
        (await storage.exists('t1/f1')).should.be.true();
    });

    it('deleteAll removes every part for the key, leaving others untouched', async () => {
        await storage.putPart('t1/f1', 1, Buffer.from('x'));
        await storage.putPart('t1/f2', 1, Buffer.from('y'));
        await storage.deleteAll('t1/f1');
        (await storage.exists('t1/f1')).should.be.false();
        (await storage.exists('t1/f2')).should.be.true();
    });

    it('deleteAll on a non-existent key does not throw', async () => {
        await storage.deleteAll('nope/nope');
    });

    it('isolates keys from different transfers/files', async () => {
        await storage.putPart('t1/f1', 1, Buffer.from('a'));
        await storage.putPart('t2/f1', 1, Buffer.from('bb'));
        (await storage.totalSize('t1/f1')).should.equal(1);
        (await storage.totalSize('t2/f1')).should.equal(2);
    });
});
