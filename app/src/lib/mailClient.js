'use strict';

const axios = require('axios');
const Logs = require('../logs');
const config = require('../config');

const log = new Logs('MailClient');

/**
 * Thin client for Scribase Mail's Resend-compatible transactional email API,
 * used only by VCPeer Send's "Send by email" delivery mode (recipient
 * notifications, sender-email verification codes, first-download alerts).
 *
 * Configured via MAIL_API_URL / MAIL_API_KEY / MAIL_FROM (see
 * config.template.js's `mail` section). If unconfigured, sends fail soft —
 * same pattern as app/src/sendCode.js's requestSendCode: the feature that
 * needed the email (e.g. "send by email") surfaces a clear error to the
 * *sender*, but no email silently vanishes.
 *
 * @param {object} message
 * @param {string[]} message.to
 * @param {string} message.subject
 * @param {string} message.html
 * @param {string} [message.text]
 * @param {string} [message.replyTo]
 * @param {import('axios').AxiosInstance} [httpClient] injectable for tests
 * @returns {Promise<{ sent: boolean, id?: string, reason?: string }>}
 */
async function sendMail({ to, subject, html, text, replyTo }, httpClient = axios) {
    if (!config.mail.apiUrl || !config.mail.apiKey) {
        log.warn('mail not configured (MAIL_API_URL/MAIL_API_KEY unset) — skipping send', { subject });
        return { sent: false, reason: 'mail_not_configured' };
    }
    try {
        const response = await httpClient.post(
            `${config.mail.apiUrl.replace(/\/$/, '')}/emails`,
            {
                from: config.mail.from,
                to,
                subject,
                html,
                text,
                ...(replyTo ? { reply_to: replyTo } : {}),
            },
            {
                headers: {
                    Authorization: `Bearer ${config.mail.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            }
        );
        return { sent: true, id: response.data?.id };
    } catch (err) {
        log.error('mail send failed', err.message);
        return { sent: false, reason: 'send_failed' };
    }
}

module.exports = { sendMail };
