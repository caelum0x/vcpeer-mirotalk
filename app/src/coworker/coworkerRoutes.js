'use strict';

const express = require('express');
const checkXSS = require('../xss');
const { coworkerMessageLimiter, coworkerSlackLimiter } = require('../middleware/rateLimiter');
const { getCoworkerReply } = require('./coworkerClient');
const {
    verifySlackSignature,
    postMessageToSlack,
    threadIdForSlackEvent,
    isAddressedToCoworker,
} = require('./slackBridge');

const MESSAGE_MAX_LENGTH = 4000;
const STRIP_MENTION_RE = /^\s*<@[A-Z0-9]+>\s*/i;

/**
 * Builds the `/api/v1/coworker*` router: the async text follow-up surface
 * (widget on the `/coworker` page) and the Slack Events API bridge. Both
 * surfaces answer through the same `getCoworkerReply` relay call and the
 * same `CoworkerStore` thread history, so a conversation reads as one
 * coworker regardless of which surface it's answered from.
 *
 * @param {object} deps
 * @param {object} deps.config `config.coworker` (see config.template.js)
 * @param {import('./coworkerStore').CoworkerStore} deps.store
 * @param {import('../logs')} deps.log
 * @returns {express.Router}
 */
function createCoworkerRoutes({ config, store, log }) {
    const router = express.Router();

    function publicMessage(message) {
        return { role: message.role, content: message.content, ts: message.ts };
    }

    // Async text follow-up: continue (or start) a conversation with VCPeer
    // Coworker outside of a call. See public/views/coworker.html.
    router.post('/message', coworkerMessageLimiter, async (req, res) => {
        if (!config.enabled) {
            return res.status(503).json({ error: 'VCPeer Coworker is not configured yet.' });
        }

        const body = checkXSS(req.body || {});
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const requestedThreadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';

        if (!message || message.length > MESSAGE_MAX_LENGTH) {
            return res.status(422).json({ error: `Message must be 1-${MESSAGE_MAX_LENGTH} characters.` });
        }

        const threadId =
            requestedThreadId && /^[a-zA-Z0-9:_-]{1,200}$/.test(requestedThreadId)
                ? requestedThreadId
                : store.createThreadId();

        const thread = store.getThread(threadId);
        const result = await getCoworkerReply({ config, history: thread.messages, userMessage: message });

        if (!result.ok) {
            return res.status(502).json({ threadId, error: result.error });
        }

        const updated = store.appendMessages(threadId, [
            { role: 'user', content: message },
            { role: 'assistant', content: result.reply },
        ]);

        res.json({ threadId, reply: result.reply, history: updated.messages.map(publicMessage) });
    });

    // Reload a thread's history (e.g. the widget was closed and reopened
    // with the threadId it kept in localStorage).
    router.get('/thread/:threadId', (req, res) => {
        const { threadId } = req.params;
        if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(threadId)) {
            return res.status(400).json({ error: 'Invalid threadId' });
        }
        const thread = store.getThread(threadId);
        res.json({ threadId, history: thread.messages.map(publicMessage) });
    });

    // Slack Events API — see config.template.js `coworker.slack` for setup.
    // Needs `req.rawBody` (see server.js's express.json `verify` callback)
    // to check Slack's HMAC request signature.
    router.post('/slack/events', coworkerSlackLimiter, async (req, res) => {
        const slackConfig = config.slack || {};
        const body = req.body || {};

        // Slack's one-time Events API subscription handshake. No signature
        // is required to be checked for this specific payload shape by
        // Slack's own docs, but we still verify it below like every other
        // event since the handshake request is itself signed.
        const isVerified = verifySlackSignature({
            signingSecret: slackConfig.signingSecret,
            timestamp: req.headers['x-slack-request-timestamp'],
            signature: req.headers['x-slack-signature'],
            rawBody: req.rawBody,
        });

        if (!slackConfig.enabled || !slackConfig.signingSecret || !slackConfig.botToken) {
            return res.status(503).json({ error: 'VCPeer Coworker Slack bridge is not configured.' });
        }
        if (!isVerified) {
            log.warn('Coworker Slack event rejected: invalid signature');
            return res.status(401).json({ error: 'Invalid Slack signature' });
        }

        if (body.type === 'url_verification') {
            return res.json({ challenge: body.challenge });
        }

        // Acknowledge immediately — Slack retries if it doesn't get a 200
        // within 3 seconds, and the relay call can take longer than that.
        res.status(200).end();

        if (body.type !== 'event_callback') return;
        const event = body.event;
        if (!isAddressedToCoworker(event)) return;

        try {
            const rawText = typeof event.text === 'string' ? event.text : '';
            const userMessage = rawText.replace(STRIP_MENTION_RE, '').trim();
            if (!userMessage) return;

            const threadId = threadIdForSlackEvent(event);
            const thread = store.getThread(threadId);
            const result = await getCoworkerReply({ config, history: thread.messages, userMessage });

            const replyText = result.ok ? result.reply : result.error;
            store.appendMessages(threadId, [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: replyText },
            ]);

            await postMessageToSlack({
                botToken: slackConfig.botToken,
                channel: event.channel,
                text: replyText,
                threadTs: event.thread_ts || event.ts,
            });
        } catch (error) {
            log.error('Coworker Slack event handling failed', error.message);
        }
    });

    return router;
}

module.exports = { createCoworkerRoutes };
