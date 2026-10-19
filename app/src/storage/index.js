'use strict';

const LocalDiskStorage = require('./LocalDiskStorage');
const R2Storage = require('./R2Storage');
const { assertImplementsStorageInterface } = require('./StorageInterface');

/**
 * Builds the storage backend selected by config.transfers.storageDriver
 * (SEND_LINK_STORAGE_DRIVER env var: 'local' default, or 'r2').
 * @param {object} transfersConfig config.transfers from app/src/config.js
 * @returns {import('./LocalDiskStorage')|import('./R2Storage')}
 */
function createStorage(transfersConfig) {
    let storage;
    if (transfersConfig.storageDriver === 'r2') {
        storage = new R2Storage(transfersConfig.r2);
    } else {
        storage = new LocalDiskStorage({ baseDir: transfersConfig.dataDir });
    }
    assertImplementsStorageInterface(storage);
    return storage;
}

module.exports = { createStorage, LocalDiskStorage, R2Storage };
