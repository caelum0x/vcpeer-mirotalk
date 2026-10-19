'use strict';

const path = require('path');
const Logs = require('../logs');
const { createStorage } = require('../storage');
const { TransferStore } = require('./transferStore');
const { QuotaTracker } = require('./quota');
const { EmailVerificationStore } = require('./emailVerification');
const { startCleanupJob } = require('./cleanupJob');
const { createTransferRoutes } = require('./transferRoutes');
const { sendMail } = require('../lib/mailClient');

const log = new Logs('TransferSend');

// Mirrors the defaults in config.template.js. A deployed app/src/config.js is
// a one-time copy of the template made at install time (see install.sh) and
// is never re-synced on later deploys, so an existing production config.js
// predating this feature will have no `transfers` key at all. Without this
// fallback, `config.transfers.dataDir` etc. below would throw at server
// startup and take down the entire app, not just VCPeer Send — so default
// instead of crashing.
const DEFAULT_TRANSFERS_CONFIG = {
    storageDriver: 'local',
    dataDir: path.join(__dirname, '..', 'data', 'transfers'),
    chunkBytes: 8 * 1024 * 1024,
    maxTransferBytes: 2 * 1024 * 1024 * 1024,
    dailyIpQuotaBytes: 10 * 1024 * 1024 * 1024,
    dailyEmailSendLimit: 20,
    defaultExpiryDays: 7,
    allowedExpiryDays: [1, 3, 7],
    previewMaxBytes: 50 * 1024 * 1024,
    cleanupIntervalMs: 15 * 60 * 1000,
    emailVerifyCodeTtlMs: 10 * 60 * 1000,
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', endpoint: '', region: 'auto' },
};

/**
 * Wires up VCPeer Send's "Send a link" feature: storage backend, persisted
 * transfer metadata, quota trackers, email verification codes, the periodic
 * cleanup job, and the `/api/v1/transfers*` router — all from
 * `config.transfers` (see config.template.js). Call once at server startup
 * (app/src/server.js).
 *
 * @param {object} config the full app config (uses config.transfers)
 * @returns {{ router: import('express').Router, store: TransferStore, storage: object, stopCleanupJob: () => void }}
 */
function initTransfers(config) {
    if (!config.transfers) {
        log.warn(
            'config.transfers is missing (stale config.js predating VCPeer Send\'s "Send a link" feature) — falling back to defaults. Run app/src/config.template.js\'s new "transfers"/"mail" blocks into the deployed config.js to configure this properly.'
        );
    }
    const transfersConfig = { ...DEFAULT_TRANSFERS_CONFIG, ...(config.transfers || {}) };
    const storage = createStorage(transfersConfig);
    const store = new TransferStore({ dataDir: transfersConfig.dataDir });
    const ipQuota = new QuotaTracker({ limit: transfersConfig.dailyIpQuotaBytes });
    const emailQuota = new QuotaTracker({ limit: transfersConfig.dailyEmailSendLimit });
    const emailVerification = new EmailVerificationStore({ ttlMs: transfersConfig.emailVerifyCodeTtlMs });

    const cleanupTimer = startCleanupJob({
        store,
        storage,
        intervalMs: transfersConfig.cleanupIntervalMs,
        onError: (msg, err) => log.error(msg, err?.message || err),
    });

    const pruneTimer = setInterval(
        () => {
            ipQuota.pruneOldDays();
            emailQuota.pruneOldDays();
            emailVerification.prune();
        },
        30 * 60 * 1000
    );
    if (pruneTimer.unref) pruneTimer.unref();

    const router = createTransferRoutes({
        config: transfersConfig,
        store,
        storage,
        ipQuota,
        emailQuota,
        emailVerification,
        sendMail,
        log,
    });

    return {
        router,
        store,
        storage,
        stopCleanupJob: () => {
            clearInterval(cleanupTimer);
            clearInterval(pruneTimer);
        },
    };
}

module.exports = { initTransfers };
