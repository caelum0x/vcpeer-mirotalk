'use strict';

// npx mocha tests/test-sendRoomToken.js

require('should');

const path = require('path');

describe('test-sendRoomToken', () => {
    let roomToken;

    before(async () => {
        roomToken = await import(path.join('..', 'public', 'js', 'send', 'room-token.js'));
    });

    // Deterministic stand-in for crypto.getRandomValues, for repeatable tests.
    function fakeRandomBytes(fillValue) {
        return (length) => new Uint8Array(length).fill(fillValue);
    }

    describe('generateRoomToken', () => {
        it('is prefixed with "send-" followed by 32 hex characters', () => {
            const token = roomToken.generateRoomToken(fakeRandomBytes(0xab));
            token.should.match(/^send-[0-9a-f]{32}$/);
            token.should.equal(`send-${'ab'.repeat(16)}`);
        });

        it('uses real randomness by default (two calls differ)', () => {
            const a = roomToken.generateRoomToken();
            const b = roomToken.generateRoomToken();
            a.should.not.equal(b);
        });
    });

    describe('isValidRoomToken', () => {
        it('accepts a well-formed token', () => {
            roomToken.isValidRoomToken(`send-${'0'.repeat(32)}`).should.be.true();
        });

        it('rejects tokens with the wrong prefix, length, or character set', () => {
            roomToken.isValidRoomToken(`call-${'0'.repeat(32)}`).should.be.false();
            roomToken.isValidRoomToken('send-tooshort').should.be.false();
            roomToken.isValidRoomToken(`send-${'g'.repeat(32)}`).should.be.false();
            roomToken.isValidRoomToken(`send-${'0'.repeat(33)}`).should.be.false();
        });

        it('rejects non-string input', () => {
            roomToken.isValidRoomToken(null).should.be.false();
            roomToken.isValidRoomToken(undefined).should.be.false();
            roomToken.isValidRoomToken(12345).should.be.false();
        });
    });

    describe('buildShareUrl', () => {
        it('builds a /send?r=<token> URL against the given origin', () => {
            const token = `send-${'1'.repeat(32)}`;
            const url = roomToken.buildShareUrl('https://vcpeer.com', token);
            url.should.equal(`https://vcpeer.com/send?r=${token}`);
        });

        it('rejects an invalid token', () => {
            (() => roomToken.buildShareUrl('https://vcpeer.com', 'not-a-token')).should.throw();
        });
    });
});
