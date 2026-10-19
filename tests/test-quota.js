'use strict';

// npx mocha tests/test-quota.js

require('should');
const { QuotaTracker } = require('../app/src/transfers/quota');

describe('test-quota', () => {
    it('allows consumption under the limit', () => {
        const q = new QuotaTracker({ limit: 100, now: () => 1_000_000 });
        const result = q.consume('1.2.3.4', 40);
        result.allowed.should.be.true();
        result.used.should.equal(40);
        result.remaining.should.equal(60);
    });

    it('rejects consumption that would exceed the limit, without recording partial usage', () => {
        const q = new QuotaTracker({ limit: 100, now: () => 1_000_000 });
        q.consume('1.2.3.4', 90);
        const result = q.consume('1.2.3.4', 20);
        result.allowed.should.be.false();
        q.used('1.2.3.4').should.equal(90); // rejected call did not add partial usage
    });

    it('tracks usage per key independently', () => {
        const q = new QuotaTracker({ limit: 100, now: () => 1_000_000 });
        q.consume('a', 50);
        q.consume('b', 10);
        q.used('a').should.equal(50);
        q.used('b').should.equal(10);
    });

    it('resets usage on a new UTC day', () => {
        let now = Date.parse('2026-10-14T23:00:00Z');
        const q = new QuotaTracker({ limit: 100, now: () => now });
        q.consume('a', 90);
        q.used('a').should.equal(90);

        now = Date.parse('2026-10-15T01:00:00Z'); // next UTC day
        q.used('a').should.equal(0);
        q.consume('a', 90).allowed.should.be.true();
    });

    it('pruneOldDays drops entries from days other than today', () => {
        let now = Date.parse('2026-10-14T12:00:00Z');
        const q = new QuotaTracker({ limit: 100, now: () => now });
        q.consume('a', 50);
        now = Date.parse('2026-10-15T12:00:00Z');
        q.consume('b', 10);
        q.pruneOldDays();
        q._usage.size.should.equal(1); // only today's ("b") entry remains
    });

    it('reset() clears all usage', () => {
        const q = new QuotaTracker({ limit: 100, now: () => 1_000_000 });
        q.consume('a', 50);
        q.reset();
        q.used('a').should.equal(0);
    });
});
