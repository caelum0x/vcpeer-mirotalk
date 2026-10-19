'use strict';

// npx mocha tests/test-clipRangeStream.js

require('should');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LocalDiskStorage = require('../app/src/storage/LocalDiskStorage');
const { generateTransferKey, encryptChunk } = require('../app/src/transfers/cryptoStream');
const { createRangeReadStream } = require('../app/src/clips/clipRangeStream');

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

describe('test-clipRangeStream', () => {
    let dataDir;
    let storage;
    let key;
    let keyBuf;
    let plaintext;
    const chunkBytes = 10;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcpeer-clip-range-'));
        storage = new LocalDiskStorage({ baseDir: dataDir });
        key = 'clip123';
        keyBuf = generateTransferKey();
        // 25 bytes of distinct content split into 3 chunks of chunkBytes=10 (10/10/5)
        plaintext = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXY'); // 25 bytes
        const parts = [plaintext.subarray(0, 10), plaintext.subarray(10, 20), plaintext.subarray(20, 25)];
        for (let i = 0; i < parts.length; i++) {
            const partNumber = i + 1;
            const ciphertext = encryptChunk(keyBuf, key, partNumber, parts[i]);
            // eslint-disable-next-line no-await-in-loop
            await storage.putPart(key, partNumber, ciphertext);
        }
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function getRange(start, end) {
        const parts = await storage.listParts(key);
        const stream = createRangeReadStream({ storage, key, fileId: key, keyBuf, chunkBytes, start, end, parts });
        return streamToBuffer(stream);
    }

    it('returns the full file when the range spans [0, size-1]', async () => {
        const result = await getRange(0, plaintext.length - 1);
        result.toString().should.equal(plaintext.toString());
    });

    it('returns a sub-range entirely inside the first chunk', async () => {
        const result = await getRange(2, 5);
        result.toString().should.equal(plaintext.subarray(2, 6).toString());
    });

    it('returns a sub-range spanning two chunks', async () => {
        const result = await getRange(8, 12);
        result.toString().should.equal(plaintext.subarray(8, 13).toString());
    });

    it('returns a sub-range spanning all three chunks', async () => {
        const result = await getRange(5, 22);
        result.toString().should.equal(plaintext.subarray(5, 23).toString());
    });

    it('returns the tail of the file (last chunk only, partial)', async () => {
        const result = await getRange(21, 24);
        result.toString().should.equal(plaintext.subarray(21, 25).toString());
    });

    it('returns a single byte', async () => {
        const result = await getRange(0, 0);
        result.toString().should.equal('A');
    });
});
