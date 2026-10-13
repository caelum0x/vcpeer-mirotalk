'use strict';

// npx mocha tests/test-mailClient.js

require('should');
const config = require('../app/src/config');
const { sendMail } = require('../app/src/lib/mailClient');

describe('test-mailClient', () => {
    let originalMailConfig;

    beforeEach(() => {
        originalMailConfig = { ...config.mail };
    });

    afterEach(() => {
        Object.assign(config.mail, originalMailConfig);
    });

    it('fails soft when MAIL_API_URL/MAIL_API_KEY are unset', async () => {
        config.mail.apiUrl = '';
        config.mail.apiKey = '';
        const result = await sendMail({ to: ['a@example.com'], subject: 'hi', html: '<p>hi</p>' });
        result.sent.should.be.false();
        result.reason.should.equal('mail_not_configured');
    });

    it('posts to MAIL_API_URL/emails with a bearer token when configured', async () => {
        config.mail.apiUrl = 'https://mail.example.com';
        config.mail.apiKey = 'secret-key';
        config.mail.from = 'VCPeer <send@vcpeer.com>';

        let capturedUrl;
        let capturedBody;
        let capturedHeaders;
        const fakeAxios = {
            post: async (url, body, options) => {
                capturedUrl = url;
                capturedBody = body;
                capturedHeaders = options.headers;
                return { data: { id: 'email_123' } };
            },
        };

        const result = await sendMail({ to: ['a@example.com'], subject: 'hi', html: '<p>hi</p>' }, fakeAxios);
        result.sent.should.be.true();
        result.id.should.equal('email_123');
        capturedUrl.should.equal('https://mail.example.com/emails');
        capturedBody.to.should.deepEqual(['a@example.com']);
        capturedBody.from.should.equal('VCPeer <send@vcpeer.com>');
        capturedHeaders.Authorization.should.equal('Bearer secret-key');
    });

    it('fails soft (does not throw) when the mail API request itself fails', async () => {
        config.mail.apiUrl = 'https://mail.example.com';
        config.mail.apiKey = 'secret-key';
        const failingAxios = {
            post: async () => {
                throw new Error('network down');
            },
        };
        const result = await sendMail({ to: ['a@example.com'], subject: 'hi', html: '<p>hi</p>' }, failingAxios);
        result.sent.should.be.false();
        result.reason.should.equal('send_failed');
    });
});
