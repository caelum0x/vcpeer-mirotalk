'use strict';

// npx mocha tests/test-cryptoStream.js

require('should');
const crypto = require('crypto');
const { generateTransferKey, encryptChunk, decryptChunk } = require('../app/src/transfers/cryptoStream');

describe('test-cryptoStream', () => {
    it('generates a 256-bit (32-byte) key', () => {
        generateTransferKey().length.should.equal(32);
    });

    it('round-trips a chunk: decrypt(encrypt(x)) === x, and the plaintext hash matches', () => {
        const key = generateTransferKey();
        const plaintext = crypto.randomBytes(64 * 1024);
        const expectedHash = crypto.createHash('sha256').update(plaintext).digest('hex');

        const ciphertext = encryptChunk(key, 'file-1', 1, plaintext);
        ciphertext.equals(plaintext).should.be.false(); // sanity: actually encrypted, not a no-op

        const decrypted = decryptChunk(key, 'file-1', 1, ciphertext);
        decrypted.equals(plaintext).should.be.true();
        crypto.createHash('sha256').update(decrypted).digest('hex').should.equal(expectedHash);
    });

    it('round-trips an empty chunk', () => {
        const key = generateTransferKey();
        const ciphertext = encryptChunk(key, 'file-1', 1, Buffer.alloc(0));
        decryptChunk(key, 'file-1', 1, ciphertext).length.should.equal(0);
    });

    it('produces different ciphertext for different part numbers (distinct IVs)', () => {
        const key = generateTransferKey();
        const plaintext = Buffer.from('same bytes every time');
        const c1 = encryptChunk(key, 'file-1', 1, plaintext);
        const c2 = encryptChunk(key, 'file-1', 2, plaintext);
        c1.equals(c2).should.be.false();
    });

    it('produces different ciphertext for different file ids with the same part number', () => {
        const key = generateTransferKey();
        const plaintext = Buffer.from('same bytes every time');
        const c1 = encryptChunk(key, 'file-1', 1, plaintext);
        const c2 = encryptChunk(key, 'file-2', 1, plaintext);
        c1.equals(c2).should.be.false();
    });

    it('rejects decryption with the wrong key (auth tag check fails)', () => {
        const key = generateTransferKey();
        const wrongKey = generateTransferKey();
        const ciphertext = encryptChunk(key, 'file-1', 1, Buffer.from('secret'));
        (() => decryptChunk(wrongKey, 'file-1', 1, ciphertext)).should.throw();
    });

    it('rejects tampered ciphertext', () => {
        const key = generateTransferKey();
        const ciphertext = encryptChunk(key, 'file-1', 1, Buffer.from('secret data'));
        const tampered = Buffer.from(ciphertext);
        tampered[0] ^= 0xff;
        (() => decryptChunk(key, 'file-1', 1, tampered)).should.throw();
    });

    it('rejects a wrong part number on decrypt (IV derivation mismatch)', () => {
        const key = generateTransferKey();
        const ciphertext = encryptChunk(key, 'file-1', 1, Buffer.from('secret data'));
        (() => decryptChunk(key, 'file-1', 2, ciphertext)).should.throw();
    });
});
