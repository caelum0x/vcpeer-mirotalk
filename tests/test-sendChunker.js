'use strict';

// npx mocha tests/test-sendChunker.js

require('should');

const path = require('path');

describe('test-sendChunker', () => {
    let chunker;

    before(async () => {
        chunker = await import(path.join('..', 'public', 'js', 'send', 'chunker.js'));
    });

    describe('countChunks', () => {
        it('returns 0 for an empty file', () => {
            chunker.countChunks(0).should.equal(0);
        });

        it('rounds up to cover the final partial chunk', () => {
            chunker.countChunks(16 * 1024 + 1, 16 * 1024).should.equal(2);
        });

        it('divides evenly when the size is an exact multiple of chunkSize', () => {
            chunker.countChunks(16 * 1024 * 4, 16 * 1024).should.equal(4);
        });

        it('rejects negative or non-finite sizes', () => {
            (() => chunker.countChunks(-1)).should.throw();
            (() => chunker.countChunks(NaN)).should.throw();
        });

        it('rejects a non-positive chunk size', () => {
            (() => chunker.countChunks(100, 0)).should.throw();
            (() => chunker.countChunks(100, -5)).should.throw();
        });
    });

    describe('iterateChunks', () => {
        it('yields the exact bytes of the source blob, in order, at the requested chunk size', async () => {
            const bytes = new Uint8Array(100);
            for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
            const blob = new Blob([bytes]);

            const collected = [];
            for await (const chunk of chunker.iterateChunks(blob, 30)) {
                collected.push(new Uint8Array(chunk));
            }

            collected.length.should.equal(4); // 30, 30, 30, 10
            collected.map((c) => c.length).should.deepEqual([30, 30, 30, 10]);

            const rebuilt = new Uint8Array(100);
            let offset = 0;
            for (const c of collected) {
                rebuilt.set(c, offset);
                offset += c.length;
            }
            Buffer.from(rebuilt).equals(Buffer.from(bytes)).should.be.true();
        });

        it('yields nothing for an empty blob', async () => {
            const blob = new Blob([]);
            const collected = [];
            for await (const chunk of chunker.iterateChunks(blob)) collected.push(chunk);
            collected.length.should.equal(0);
        });

        it('yields a single chunk when the blob is smaller than chunkSize', async () => {
            const blob = new Blob([new Uint8Array(10)]);
            const collected = [];
            for await (const chunk of chunker.iterateChunks(blob, 1024)) collected.push(chunk);
            collected.length.should.equal(1);
            collected[0].byteLength.should.equal(10);
        });

        it('rejects a non-blob input', async () => {
            let threw = false;
            try {
                // eslint-disable-next-line no-unused-vars
                for await (const _ of chunker.iterateChunks({ not: 'a blob' })) {
                    // no-op
                }
            } catch {
                threw = true;
            }
            threw.should.be.true();
        });
    });
});
