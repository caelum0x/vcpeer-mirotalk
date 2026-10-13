'use strict';

// npx mocha tests/test-sendCode.js

require('should');

const sinon = require('sinon');
const SendCode = require('../app/src/sendCode');

describe('test-sendCode', () => {
    afterEach(() => {
        SendCode.reset();
        sinon.restore();
    });

    it('mints a 6-digit numeric code for a channel', () => {
        const code = SendCode.createCode('send-abc');
        code.should.match(/^\d{6}$/);
    });

    it('resolves a minted code back to its channel', () => {
        const code = SendCode.createCode('send-abc');
        SendCode.resolveCode(code).should.equal('send-abc');
    });

    it('returns null for an unknown code', () => {
        (SendCode.resolveCode('999999') === null).should.be.true();
    });

    it('re-minting for the same channel invalidates the previous code', () => {
        const first = SendCode.createCode('send-abc');
        const second = SendCode.createCode('send-abc');
        first.should.not.equal(second);
        (SendCode.resolveCode(first) === null).should.be.true();
        SendCode.resolveCode(second).should.equal('send-abc');
    });

    it('expires a code after its TTL', () => {
        const clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
        const code = SendCode.createCode('send-abc', Date.now());
        SendCode.resolveCode(code, Date.now()).should.equal('send-abc');

        clock.tick(SendCode.TTL_MS + 1);
        (SendCode.resolveCode(code, Date.now()) === null).should.be.true();
    });

    it('release() retires the code for that channel', () => {
        const code = SendCode.createCode('send-abc');
        SendCode.release('send-abc');
        (SendCode.resolveCode(code) === null).should.be.true();
    });

    it('release() is a no-op for a channel with no code', () => {
        (() => SendCode.release('send-never-had-a-code')).should.not.throw();
    });

    it('never hands out the same code twice while both are still active', () => {
        const codes = new Set();
        for (let i = 0; i < 200; i++) {
            codes.add(SendCode.createCode(`send-room-${i}`));
        }
        codes.size.should.equal(200);
    });
});
