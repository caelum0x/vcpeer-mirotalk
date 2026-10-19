'use strict';

// npx mocha tests/test-transferValidators.js

require('should');
const {
    isValidEmail,
    isValidExpiryDays,
    parseMaxDownloads,
    isValidDelivery,
    sanitizeRecipients,
    clampMessage,
} = require('../app/src/transfers/validators');

describe('test-transferValidators', () => {
    describe('isValidEmail', () => {
        it('accepts well-formed emails', () => {
            isValidEmail('me@example.com').should.be.true();
        });
        it('rejects malformed emails', () => {
            isValidEmail('not-an-email').should.be.false();
            isValidEmail('').should.be.false();
            isValidEmail(null).should.be.false();
        });
    });

    describe('isValidExpiryDays', () => {
        it('accepts an allowed value', () => {
            isValidExpiryDays(7, [1, 3, 7]).should.be.true();
            isValidExpiryDays('3', [1, 3, 7]).should.be.true();
        });
        it('rejects a disallowed value', () => {
            isValidExpiryDays(2, [1, 3, 7]).should.be.false();
        });
    });

    describe('parseMaxDownloads', () => {
        it('treats null/empty as "no limit"', () => {
            parseMaxDownloads(null).should.deepEqual({ valid: true, value: null });
            parseMaxDownloads('').should.deepEqual({ valid: true, value: null });
        });
        it('accepts a positive integer', () => {
            parseMaxDownloads('5').should.deepEqual({ valid: true, value: 5 });
        });
        it('rejects zero, negative, non-integer, or absurdly large values', () => {
            parseMaxDownloads(0).valid.should.be.false();
            parseMaxDownloads(-1).valid.should.be.false();
            parseMaxDownloads(1.5).valid.should.be.false();
            parseMaxDownloads(999999999).valid.should.be.false();
        });
    });

    describe('isValidDelivery', () => {
        it('accepts link/email only', () => {
            isValidDelivery('link').should.be.true();
            isValidDelivery('email').should.be.true();
            isValidDelivery('p2p').should.be.false();
        });
    });

    describe('sanitizeRecipients', () => {
        it('dedupes, trims, and lowercases', () => {
            const result = sanitizeRecipients([' A@Example.com ', 'a@example.com', 'b@example.com']);
            result.valid.should.be.true();
            result.recipients.should.deepEqual(['a@example.com', 'b@example.com']);
        });
        it('rejects an empty list', () => {
            sanitizeRecipients([]).valid.should.be.false();
        });
        it('rejects more than 10 recipients', () => {
            const many = Array.from({ length: 11 }, (_, i) => `user${i}@example.com`);
            sanitizeRecipients(many).valid.should.be.false();
        });
        it('rejects an invalid email in the list', () => {
            sanitizeRecipients(['good@example.com', 'bad']).valid.should.be.false();
        });
    });

    describe('clampMessage', () => {
        it('truncates to the max length', () => {
            clampMessage('a'.repeat(3000)).length.should.equal(2000);
        });
        it('returns empty string for non-string input', () => {
            clampMessage(null).should.equal('');
        });
    });
});
