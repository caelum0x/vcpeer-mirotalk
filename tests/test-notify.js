'use strict';

// npx mocha tests/test-notify.js

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('test-notify', () => {
    let Notify;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-test-'));
        process.env.NOTIFY_DATA_DIR = tmpDir;
        delete require.cache[require.resolve('../app/src/notify')];
        Notify = require('../app/src/notify');
    });

    afterEach(() => {
        delete process.env.NOTIFY_DATA_DIR;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('starts with zero signups', () => {
        Notify.count().should.equal(0);
    });

    it('subscribes a valid email and it is counted', () => {
        const result = Notify.subscribe({ email: 'founder@example.com' });
        result.ok.should.be.true();
        result.alreadySubscribed.should.be.false();
        Notify.count().should.equal(1);
    });

    it('normalizes email case and whitespace before storing', () => {
        Notify.subscribe({ email: '  Founder@Example.com  ' });
        Notify.count().should.equal(1);
    });

    it('rejects an invalid email', () => {
        const result = Notify.subscribe({ email: 'not-an-email' });
        result.ok.should.be.false();
        result.should.have.property('error');
        Notify.count().should.equal(0);
    });

    it('rejects a missing email', () => {
        const result = Notify.subscribe({});
        result.ok.should.be.false();
        Notify.count().should.equal(0);
    });

    it('a repeat signup is an idempotent no-op, not a duplicate', () => {
        Notify.subscribe({ email: 'founder@example.com' });
        const second = Notify.subscribe({ email: 'founder@example.com' });
        second.ok.should.be.true();
        second.alreadySubscribed.should.be.true();
        Notify.count().should.equal(1);
    });

    it('persists signups across a fresh require (survives a restart)', () => {
        Notify.subscribe({ email: 'persisted@example.com' });

        delete require.cache[require.resolve('../app/src/notify')];
        const reloaded = require('../app/src/notify');
        reloaded.count().should.equal(1);
    });

    it('isValidEmail rejects obviously malformed input', () => {
        Notify.isValidEmail('javascript:alert(1)').should.be.false();
        Notify.isValidEmail('').should.be.false();
        Notify.isValidEmail('a@b.com').should.be.true();
    });
});
