'use strict';

// npx mocha tests/test-sendFormat.js

require('should');

const path = require('path');

describe('test-sendFormat', () => {
    let format;

    before(async () => {
        format = await import(path.join('..', 'public', 'js', 'send', 'format.js'));
    });

    describe('bytesToSize', () => {
        it('handles zero and negative input', () => {
            format.bytesToSize(0).should.equal('0 Bytes');
            format.bytesToSize(-5).should.equal('0 Bytes');
            format.bytesToSize(NaN).should.equal('0 Bytes');
        });

        it('formats bytes, KB, MB, GB with the right unit', () => {
            format.bytesToSize(512).should.equal('512 Bytes');
            format.bytesToSize(1024).should.equal('1.0 KB');
            format.bytesToSize(1536).should.equal('1.5 KB');
            format.bytesToSize(5 * 1024 * 1024).should.equal('5.0 MB');
            format.bytesToSize(2 * 1024 * 1024 * 1024).should.equal('2.0 GB');
        });
    });

    describe('formatSpeed', () => {
        it('renders 0 for non-positive input', () => {
            format.formatSpeed(0).should.equal('0 Bytes/s');
            format.formatSpeed(-1).should.equal('0 Bytes/s');
        });

        it('appends /s to the size', () => {
            format.formatSpeed(1024).should.equal('1.0 KB/s');
        });
    });

    describe('formatEta', () => {
        it('returns "--" when throughput is unknown', () => {
            format.formatEta(1000, 0).should.equal('--');
        });

        it('returns "0s" once there is nothing left to transfer', () => {
            format.formatEta(0, 1000).should.equal('0s');
        });

        it('formats seconds, minutes, and hours', () => {
            format.formatEta(5000, 1000).should.equal('5s');
            format.formatEta(130 * 1000, 1000).should.equal('2m 10s');
            format.formatEta(2 * 3600 * 1000, 1000).should.equal('2h 0m');
        });
    });

    describe('estimateThroughput', () => {
        it('returns 0 with fewer than two samples', () => {
            format.estimateThroughput([]).should.equal(0);
            format.estimateThroughput([{ bytes: 10, atMs: 0 }]).should.equal(0);
        });

        it('computes bytes/sec over the trailing window', () => {
            const samples = [
                { bytes: 0, atMs: 0 },
                { bytes: 1000, atMs: 1000 },
            ];
            format.estimateThroughput(samples, 3000).should.equal(1000);
        });

        it('prefers the oldest sample still inside the trailing window over older ones outside it', () => {
            const samples = [
                { bytes: 0, atMs: 0 },
                { bytes: 500, atMs: 1000 }, // outside a 1000ms window measured from atMs=3000 (cutoff=2000)
                { bytes: 1500, atMs: 2500 }, // inside the window — this should be used as the base
                { bytes: 3000, atMs: 3000 },
            ];
            // (3000-1500) bytes / (3000-2500) ms * 1000 = 3000 bytes/sec
            format.estimateThroughput(samples, 1000).should.equal(3000);
        });
    });

    describe('clampPercent', () => {
        it('clamps to [0, 100]', () => {
            format.clampPercent(-10).should.equal(0);
            format.clampPercent(150).should.equal(100);
        });

        it('rounds to one decimal place', () => {
            format.clampPercent(33.3333).should.equal(33.3);
        });

        it('returns 0 for non-finite input', () => {
            format.clampPercent(NaN).should.equal(0);
        });
    });
});
