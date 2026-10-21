'use strict';

const Logs = require('../logs');
const { CoworkerStore } = require('./coworkerStore');
const { createCoworkerRoutes } = require('./coworkerRoutes');

const log = new Logs('Coworker');

const DEFAULT_COWORKER_CONFIG = {
    enabled: false,
    name: 'VCPeer Coworker',
    systemPrompt: 'You are VCPeer Coworker, an always-on assistant built into VCPeer.',
    baseUrl: 'https://ai-relay.subasiarhan3.workers.dev/v1/chat/completions',
    apiKey: '',
    model: 'vcpeer-coworker',
    maxTokens: 800,
    temperature: 0.4,
    dataDir: null,
    maxThreads: 20000,
    maxMessagesPerThread: 60,
    slack: { enabled: false, signingSecret: '', botToken: '' },
};

/**
 * Wires up VCPeer Coworker: the shared relay client, the persisted
 * conversation store, and the `/api/v1/coworker*` router (async text
 * follow-up + Slack bridge). Call once at server startup (app/src/server.js)
 * — mirrors app/src/transfers/index.js and app/src/clips/index.js.
 *
 * @param {object} rawConfig `config.coworker` (see config.template.js); may
 *   be undefined for a deployed config.js predating this feature (same
 *   stale-config guard used by initTransfers/initClips).
 * @returns {{
 *   router: import('express').Router,
 *   store: CoworkerStore,
 *   config: object,
 *   appendRoomExchange: (roomId: string, userMessage: string, assistantReply: string) => void,
 * }}
 */
function initCoworker(rawConfig) {
    if (!rawConfig) {
        log.warn(
            'config.coworker is missing (stale config.js predating VCPeer Coworker) — falling back to disabled defaults.'
        );
    }

    const config = {
        ...DEFAULT_COWORKER_CONFIG,
        ...(rawConfig || {}),
        slack: { ...DEFAULT_COWORKER_CONFIG.slack, ...(rawConfig?.slack || {}) },
    };

    if (!config.dataDir) {
        config.dataDir = require('path').join(__dirname, '..', '..', 'data', 'coworker');
    }

    const store = new CoworkerStore({
        dataDir: config.dataDir,
        maxThreads: config.maxThreads,
        maxMessagesPerThread: config.maxMessagesPerThread,
    });

    const router = createCoworkerRoutes({ config, store, log });

    /**
     * Persists a call-side exchange (from the in-call "VCPeer Coworker"
     * assistant, app/src/server.js's `getChatGPT` socket handler) into the
     * same thread store used by the async `/coworker` page, keyed by room,
     * so a user can continue the conversation after the call ends by
     * opening `/coworker?thread=room:<roomId>`.
     */
    function appendRoomExchange(roomId, userMessage, assistantReply) {
        if (!roomId || !userMessage || !assistantReply) return;
        try {
            store.appendMessages(`room:${roomId}`, [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: assistantReply },
            ]);
        } catch (error) {
            log.error('Failed to persist room exchange into Coworker store', error.message);
        }
    }

    if (config.enabled) {
        log.info('VCPeer Coworker enabled', { baseUrl: config.baseUrl, slackEnabled: config.slack.enabled });
    } else {
        log.info('VCPeer Coworker disabled (set COWORKER_ENABLED=true to turn it on)');
    }

    return { router, store, config, appendRoomExchange };
}

module.exports = { initCoworker };
