'use strict';

const axios = require('axios');
const Logger = require('../logs');
const log = new Logger('CoworkerClient');

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Calls VCPeer Coworker's configured OpenAI-compatible chat-completions
 * endpoint (by default VCPeer's own free ai-relay-worker — see
 * config.template.js `coworker` block) and returns the assistant's reply.
 *
 * Kept deliberately separate from the pre-existing `openai` SDK client used
 * by the in-call ChatGPT assistant (app/src/server.js) because the async
 * text and Slack surfaces run outside of a socket/room lifecycle and only
 * need a single request/response call, not a stateful SDK client.
 *
 * @param {object} opts
 * @param {object} opts.config `config.coworker` (see config.template.js)
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} opts.history prior turns, oldest first
 * @param {string} opts.userMessage the new user message to answer
 * @returns {Promise<{ok: true, reply: string}|{ok: false, error: string}>}
 */
async function getCoworkerReply({ config, history, userMessage }) {
    if (!config || !config.enabled) {
        return { ok: false, error: 'VCPeer Coworker is not enabled.' };
    }
    if (!config.baseUrl) {
        return { ok: false, error: 'VCPeer Coworker has no relay configured (coworker.baseUrl).' };
    }

    const messages = [
        { role: 'system', content: config.systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
    ];

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

            const response = await axios.post(
                config.baseUrl,
                {
                    model: config.model || 'vcpeer-coworker',
                    messages,
                    max_tokens: config.maxTokens || 800,
                    temperature: config.temperature ?? 0.4,
                },
                { headers, timeout: REQUEST_TIMEOUT_MS }
            );

            const reply = response.data?.choices?.[0]?.message?.content?.trim();
            if (!reply) {
                lastError = new Error('Relay returned no message content');
                continue;
            }
            return { ok: true, reply };
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const isTransient = !status || (status >= 500 && status < 600) || status === 429;
            log.warn(`Coworker relay call failed (attempt ${attempt}/${MAX_RETRIES})`, {
                status,
                message: error.message,
            });
            if (!isTransient || attempt === MAX_RETRIES) break;
            await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
    }

    log.error('Coworker relay call failed', lastError?.message || lastError);
    return { ok: false, error: 'VCPeer Coworker is temporarily unavailable, please try again shortly.' };
}

module.exports = { getCoworkerReply };
