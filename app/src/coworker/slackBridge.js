'use strict';

const crypto = require('crypto');
const axios = require('axios');

const Logger = require('../logs');
const log = new Logger('CoworkerSlack');

const MAX_SIGNATURE_AGE_SECONDS = 300; // reject replayed requests older than 5 minutes

/**
 * Verifies a Slack request signature per Slack's signing-secret scheme
 * (https://api.slack.com/authentication/verifying-requests-from-slack).
 * Needs the exact raw request body bytes — see server.js's `express.json()`
 * `verify` callback, which stashes them on `req.rawBody` for this purpose.
 *
 * @param {object} opts
 * @param {string} opts.signingSecret
 * @param {string|undefined} opts.timestamp `x-slack-request-timestamp` header
 * @param {string|undefined} opts.signature `x-slack-signature` header
 * @param {Buffer|undefined} opts.rawBody exact bytes of the request body
 * @returns {boolean}
 */
function verifySlackSignature({ signingSecret, timestamp, signature, rawBody }) {
    if (!signingSecret || !timestamp || !signature || !rawBody) return false;

    const now = Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SIGNATURE_AGE_SECONDS) return false;

    const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
    const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;

    const expectedBuf = Buffer.from(expected, 'utf8');
    const signatureBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Posts a message back into a Slack channel/thread using the bot token's
 * `chat.postMessage` Web API call.
 *
 * @param {object} opts
 * @param {string} opts.botToken `xoxb-...` bot user OAuth token
 * @param {string} opts.channel Slack channel ID
 * @param {string} opts.text
 * @param {string} [opts.threadTs] reply in-thread when set
 */
async function postMessageToSlack({ botToken, channel, text, threadTs }) {
    try {
        const response = await axios.post(
            'https://slack.com/api/chat.postMessage',
            { channel, text, thread_ts: threadTs },
            {
                headers: {
                    Authorization: `Bearer ${botToken}`,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                timeout: 10000,
            }
        );
        if (!response.data?.ok) {
            log.error('Slack chat.postMessage rejected', response.data?.error);
            return false;
        }
        return true;
    } catch (error) {
        log.error('Slack chat.postMessage failed', error.message);
        return false;
    }
}

/**
 * A stable thread key derived from a Slack event — a DM channel keys purely
 * on the channel, a threaded channel message keys on its root `thread_ts`.
 * @param {object} event Slack event payload
 * @returns {string}
 */
function threadIdForSlackEvent(event) {
    const root = event.thread_ts || event.ts;
    return `slack:${event.channel}:${root}`;
}

/**
 * True for an event VCPeer Coworker should answer: someone @-mentioned it,
 * or sent it a direct message — and it's never a message the bot itself
 * sent (Slack would otherwise echo-loop the bot's own replies back to it).
 * @param {object} event
 */
function isAddressedToCoworker(event) {
    if (!event || event.bot_id || event.subtype === 'bot_message') return false;
    if (event.type === 'app_mention') return true;
    return event.type === 'message' && event.channel_type === 'im';
}

module.exports = {
    verifySlackSignature,
    postMessageToSlack,
    threadIdForSlackEvent,
    isAddressedToCoworker,
};
