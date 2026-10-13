'use strict';

// npx mocha tests/test-emailVerification.js

require('should');
const { EmailVerificationStore } = require('../app/src/transfers/emailVerification');

describe('test-emailVerification', () => {
    it('mints a 6-digit code and verifies it correctly', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        const code = store.createCode('t1', 'me@example.com');
        code.should.match(/^\d{6}$/);
        store.verify('t1', 'me@example.com', code).valid.should.be.true();
    });

    it('is a one-time code: verifying twice fails the second time', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        const code = store.createCode('t1', 'me@example.com');
        store.verify('t1', 'me@example.com', code).valid.should.be.true();
        store.verify('t1', 'me@example.com', code).valid.should.be.false();
    });

    it('rejects a mismatched code', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        store.createCode('t1', 'me@example.com');
        const result = store.verify('t1', 'me@example.com', '000000');
        result.valid.should.be.false();
        result.reason.should.equal('mismatch');
    });

    it('is scoped per transfer id: a code minted for one transfer does not verify another', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        const code = store.createCode('t1', 'me@example.com');
        store.verify('t2', 'me@example.com', code).valid.should.be.false();
    });

    it('expires after the TTL', () => {
        let now = 1_000_000;
        const store = new EmailVerificationStore({ ttlMs: 1000, now: () => now });
        const code = store.createCode('t1', 'me@example.com');
        now += 2000;
        const result = store.verify('t1', 'me@example.com', code);
        result.valid.should.be.false();
        result.reason.should.equal('expired');
    });

    it('locks out after 5 wrong attempts', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        store.createCode('t1', 'me@example.com');
        for (let i = 0; i < 5; i++) store.verify('t1', 'me@example.com', '000000');
        const result = store.verify('t1', 'me@example.com', '000000');
        result.reason.should.equal('too_many_attempts');
    });

    it('re-minting replaces the previous code', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        const first = store.createCode('t1', 'me@example.com');
        const second = store.createCode('t1', 'me@example.com');
        store.verify('t1', 'me@example.com', first).valid.should.be.false();
        store.verify('t1', 'me@example.com', second).valid.should.be.true();
    });

    it('normalizes email case/whitespace for lookups', () => {
        const store = new EmailVerificationStore({ ttlMs: 60000 });
        const code = store.createCode('t1', '  Me@Example.com  ');
        store.verify('t1', 'me@example.com', code).valid.should.be.true();
    });
});
