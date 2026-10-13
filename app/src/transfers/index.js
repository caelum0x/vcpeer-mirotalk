'use strict';

const Logs = require('../logs');
const { createStorage } = require('../storage');
const { TransferStore } = require('./transferStore');
const { QuotaTracker } = require('./quota');
const { EmailVerificationStore } = require('./emailVerification');
const { startCleanupJob } = require('./cleanupJob');
const { createTransferRoutes } = require('./transferRoutes');
const { sendMail } = require('../lib/mailClient');

const log = new Logs('TransferSend');

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
    const transfersConfig = config.transfers;
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
