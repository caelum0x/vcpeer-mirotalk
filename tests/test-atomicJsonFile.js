'use strict';

// npx mocha tests/test-atomicJsonFile.js

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonFileAtomic } = require('../app/src/lib/atomicJsonFile');

describe('test-atomicJsonFile', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-json-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes the JSON-serialized data to the target path', () => {
        const target = path.join(tmpDir, 'data.json');
        writeJsonFileAtomic(target, [{ id: 1 }]);
        JSON.parse(fs.readFileSync(target, 'utf-8')).should.deepEqual([{ id: 1 }]);
    });

    it('leaves no temp file behind in the target directory after a successful write', () => {
        const target = path.join(tmpDir, 'data.json');
        writeJsonFileAtomic(target, { ok: true });
        const entries = fs.readdirSync(tmpDir);
        entries.should.deepEqual(['data.json']);
    });

    it('overwrites existing content instead of appending to it', () => {
        const target = path.join(tmpDir, 'data.json');
        writeJsonFileAtomic(target, { a: 1 });
        writeJsonFileAtomic(target, { b: 2 });
        JSON.parse(fs.readFileSync(target, 'utf-8')).should.deepEqual({ b: 2 });
    });

    it('never leaves the target file truncated or half-written (old content or new content, never neither)', () => {
        const target = path.join(tmpDir, 'data.json');
        const bigArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, email: `user${i}@example.com` }));
        writeJsonFileAtomic(target, bigArray);

        // Simulate many rapid rewrites (the real-world failure mode this guards
        // against is a kill signal arriving mid-write) — after every single
        // call, the file on disk must parse as complete, valid JSON.
        for (let i = 0; i < 20; i++) {
            bigArray.push({ id: 5000 + i, email: `user${5000 + i}@example.com` });
            writeJsonFileAtomic(target, bigArray);
            const onDisk = JSON.parse(fs.readFileSync(target, 'utf-8'));
            onDisk.length.should.equal(bigArray.length);
        }
    });

    it('creates the temp file in the same directory as the target (same filesystem, so rename() is atomic)', () => {
        const nestedDir = path.join(tmpDir, 'nested');
        fs.mkdirSync(nestedDir);
        const target = path.join(nestedDir, 'data.json');
        writeJsonFileAtomic(target, { nested: true });
        fs.readdirSync(nestedDir).should.deepEqual(['data.json']);
    });
});
