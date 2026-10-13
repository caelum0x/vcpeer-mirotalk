'use strict';

// npx mocha tests/test-sendHash.js

require('should');

const path = require('path');
const crypto = require('crypto');

describe('test-sendHash', () => {
    let StreamingSha256;
    let createSHA256;

    before(async () => {
        ({ StreamingSha256 } = await import(path.join('..', 'public', 'js', 'send', 'hash.js')));
        ({ createSHA256 } = await import('hash-wasm'));
    });

    // Inject the local hash-wasm package instead of StreamingSha256's default
    // CDN import, so this test needs no network access.
    function localHasher() {
        return new StreamingSha256(createSHA256);
    }

    it('matches the known SHA-256("abc") test vector', async () => {
        const hasher = await localHasher().init();
        hasher.update(Buffer.from('abc'));
        hasher.digest().should.equal('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('matches the known SHA-256("") test vector', async () => {
        const hasher = await localHasher().init();
        hasher.digest().should.equal('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('produces the same digest incrementally (many small updates) as in one call', async () => {
        const data = crypto.randomBytes(500000); // 500 KB, deliberately not a multiple of any "nice" chunk size

        const incremental = await localHasher().init();
        const chunkSize = 16 * 1024;
        for (let offset = 0; offset < data.length; offset += chunkSize) {
            incremental.update(data.subarray(offset, Math.min(offset + chunkSize, data.length)));
        }

        const expected = crypto.createHash('sha256').update(data).digest('hex');
        incremental.digest().should.equal(expected);
    });

    it('accepts ArrayBuffer chunks, not just typed arrays', async () => {
        const bytes = new Uint8Array([97, 98, 99]); // "abc"
        const hasher = await localHasher().init();
        hasher.update(bytes.buffer);
        hasher.digest().should.equal('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('throws if update() is called before init()', () => {
        const hasher = localHasher();
        (() => hasher.update(Buffer.from('abc'))).should.throw();
    });

    it('throws if digest() is called before init()', () => {
        const hasher = localHasher();
        (() => hasher.digest()).should.throw();
    });

    it('two independent instances do not share state', async () => {
        const a = await localHasher().init();
        const b = await localHasher().init();
        a.update(Buffer.from('a'));
        b.update(Buffer.from('b'));
        a.digest().should.not.equal(b.digest());
    });
});
