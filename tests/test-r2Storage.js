'use strict';

// npx mocha tests/test-r2Storage.js
//
// No live R2 bucket in this environment, so only constructor validation and
// endpoint/path derivation (pure, no network) are covered here. See
// plans/vcpeer.md for the manual verification checklist to run once R2
// credentials are configured in production.

require('should');
const R2Storage = require('../app/src/storage/R2Storage');

describe('test-r2Storage', () => {
    it('throws if accessKeyId is missing', () => {
        (() => new R2Storage({ secretAccessKey: 's', bucket: 'b', accountId: 'a' })).should.throw();
    });

    it('throws if secretAccessKey is missing', () => {
        (() => new R2Storage({ accessKeyId: 'k', bucket: 'b', accountId: 'a' })).should.throw();
    });

    it('throws if bucket is missing', () => {
        (() => new R2Storage({ accessKeyId: 'k', secretAccessKey: 's', accountId: 'a' })).should.throw();
    });

    it('throws if neither accountId nor endpoint is given', () => {
        (() => new R2Storage({ accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' })).should.throw();
    });

    it('derives the default R2 endpoint from accountId', () => {
        const storage = new R2Storage({ accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', accountId: 'acct123' });
        storage.endpoint.should.equal('https://acct123.r2.cloudflarestorage.com');
        storage.host.should.equal('acct123.r2.cloudflarestorage.com');
    });

    it('accepts an explicit endpoint override without an accountId', () => {
        const storage = new R2Storage({
            accessKeyId: 'k',
            secretAccessKey: 's',
            bucket: 'b',
            endpoint: 'https://s3.example.com',
        });
        storage.host.should.equal('s3.example.com');
    });

    it('builds the expected per-part object key', () => {
        const storage = new R2Storage({ accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', accountId: 'a' });
        storage._partObjectKey('transfer1/file1', 3).should.equal('transfer1/file1/part-00000003');
    });

    it('defaults region to "auto" (R2 convention)', () => {
        const storage = new R2Storage({ accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', accountId: 'a' });
        storage.region.should.equal('auto');
    });
});
