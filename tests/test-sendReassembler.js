'use strict';

// npx mocha tests/test-sendReassembler.js

require('should');

const path = require('path');

describe('test-sendReassembler', () => {
    let ChunkReassembler;

    before(async () => {
        ({ ChunkReassembler } = await import(path.join('..', 'public', 'js', 'send', 'reassembler.js')));
    });

    it('rejects an invalid expectedSize', () => {
        (() => new ChunkReassembler(-1)).should.throw();
        (() => new ChunkReassembler(NaN)).should.throw();
    });

    it('tracks received bytes and completion across pushes', () => {
        const r = new ChunkReassembler(30);
        r.isComplete().should.be.false();
        r.progress.should.equal(0);

        r.push(new Uint8Array(10).buffer);
        r.received.should.equal(10);
        r.progress.should.be.approximately(1 / 3, 1e-9);
        r.isComplete().should.be.false();

        r.push(new Uint8Array(20).buffer);
        r.received.should.equal(30);
        r.isComplete().should.be.true();
        r.progress.should.equal(1);
    });

    it('accepts typed array views, not just raw ArrayBuffers', () => {
        const r = new ChunkReassembler(4);
        r.push(new Uint8Array([1, 2, 3, 4]));
        r.isComplete().should.be.true();
    });

    it('throws if pushed more bytes than expected', () => {
        const r = new ChunkReassembler(4);
        r.push(new Uint8Array(4).buffer);
        (() => r.push(new Uint8Array(1).buffer)).should.throw();
    });

    it('rejects a push() of something that is not binary data', () => {
        const r = new ChunkReassembler(4);
        (() => r.push('not binary')).should.throw();
    });

    it('reassembles the exact original bytes via toBlob()', async () => {
        const original = new Uint8Array(1000);
        for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256;

        const r = new ChunkReassembler(original.length);
        const chunkSize = 123;
        for (let offset = 0; offset < original.length; offset += chunkSize) {
            const slice = original.slice(offset, Math.min(offset + chunkSize, original.length));
            r.push(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
        }

        r.isComplete().should.be.true();
        const blob = r.toBlob('application/octet-stream');
        blob.size.should.equal(original.length);
        blob.type.should.equal('application/octet-stream');

        const rebuilt = new Uint8Array(await blob.arrayBuffer());
        Buffer.from(rebuilt).equals(Buffer.from(original)).should.be.true();
    });

    it('clear() drops held chunks', () => {
        const r = new ChunkReassembler(4);
        r.push(new Uint8Array(4).buffer);
        r.clear();
        r.chunks.length.should.equal(0);
    });
});
