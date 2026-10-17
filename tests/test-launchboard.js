'use strict';

// npx mocha tests/test-launchboard.js

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('test-launchboard', () => {
    let Launchboard;
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchboard-test-'));
        process.env.LAUNCHBOARD_DATA_DIR = tmpDir;
        delete require.cache[require.resolve('../app/src/launchboard')];
        Launchboard = require('../app/src/launchboard');
    });

    afterEach(() => {
        delete process.env.LAUNCHBOARD_DATA_DIR;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('seeds the data file with VCPeer and Menivor on first read', () => {
        const listings = Launchboard.listAll();
        listings.map((l) => l.name).should.containEql('VCPeer');
        listings.map((l) => l.name).should.containEql('Menivor');
    });

    it('creates a valid listing and it appears in listAll()', () => {
        const result = Launchboard.create({
            name: 'Acme Rockets',
            url: 'https://acme.example.com',
            pitch: 'We build rockets that actually launch on time.',
            category: 'saas',
        });
        result.should.have.property('listing');
        result.listing.name.should.equal('Acme Rockets');

        const names = Launchboard.listAll().map((l) => l.name);
        names.should.containEql('Acme Rockets');
    });

    it('rejects a name that is too short', () => {
        const result = Launchboard.create({
            name: 'A',
            url: 'https://acme.example.com',
            pitch: 'We build rockets that actually launch on time.',
            category: 'saas',
        });
        result.should.have.property('errors');
        result.errors.length.should.be.above(0);
    });

    it('rejects a non-http(s) URL', () => {
        const result = Launchboard.create({
            name: 'Acme Rockets',
            url: 'javascript:alert(1)',
            pitch: 'We build rockets that actually launch on time.',
            category: 'saas',
        });
        result.should.have.property('errors');
    });

    it('rejects a pitch that is too short', () => {
        const result = Launchboard.create({
            name: 'Acme Rockets',
            url: 'https://acme.example.com',
            pitch: 'short',
            category: 'saas',
        });
        result.should.have.property('errors');
    });

    it('falls back unknown categories to "other"', () => {
        const result = Launchboard.create({
            name: 'Acme Rockets',
            url: 'https://acme.example.com',
            pitch: 'We build rockets that actually launch on time.',
            category: 'not-a-real-category',
        });
        result.listing.category.should.equal('other');
    });

    it('a submission is never auto-featured, only featuredRequested', () => {
        const result = Launchboard.create({
            name: 'Acme Rockets',
            url: 'https://acme.example.com',
            pitch: 'We build rockets that actually launch on time.',
            category: 'saas',
            featuredRequested: true,
        });
        result.listing.featured.should.be.false();
        result.listing.featuredRequested.should.be.true();
    });

    it('listAll() puts featured listings first', () => {
        const listings = Launchboard.listAll();
        const firstFeaturedIndex = listings.findIndex((l) => l.featured);
        const firstUnfeaturedIndex = listings.findIndex((l) => !l.featured);
        if (firstFeaturedIndex !== -1 && firstUnfeaturedIndex !== -1) {
            firstFeaturedIndex.should.be.below(firstUnfeaturedIndex);
        }
    });

    it('isValidUrl rejects javascript: and data: URIs', () => {
        Launchboard.isValidUrl('javascript:alert(1)').should.be.false();
        Launchboard.isValidUrl('data:text/html,hi').should.be.false();
        Launchboard.isValidUrl('https://example.com').should.be.true();
    });

    it('isValidUrl rejects dotless/truncated hostnames (e.g. a cut-off URL)', () => {
        // Regression test: found live in production as a real submission
        // ("https://spa", meant to be "https://spawndroid.io") — the WHATWG
        // URL parser accepts it as well-formed, so this needs an explicit check.
        Launchboard.isValidUrl('https://spa').should.be.false();
        Launchboard.isValidUrl('https://localhost').should.be.false();
        Launchboard.isValidUrl('https://spawndroid.io').should.be.true();
    });

    it('create() rejects a submission with a dotless hostname', () => {
        const result = Launchboard.create({
            name: 'Truncated Co',
            url: 'https://spa',
            pitch: 'This URL looks truncated and should be rejected.',
            category: 'saas',
        });
        result.should.have.property('errors');
        result.errors.should.containEql('Enter a valid http:// or https:// URL.');
    });

    it('persists listings across a fresh require (survives a restart)', () => {
        Launchboard.create({
            name: 'Persisted Co',
            url: 'https://persisted.example.com',
            pitch: 'This listing must survive a process restart.',
            category: 'saas',
        });

        delete require.cache[require.resolve('../app/src/launchboard')];
        const reloaded = require('../app/src/launchboard');
        const names = reloaded.listAll().map((l) => l.name);
        names.should.containEql('Persisted Co');
    });
});
