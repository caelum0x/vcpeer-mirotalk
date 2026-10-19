'use strict';

/**
 * Thin fetch wrapper for VCPeer Send's "Send a link" REST API
 * (app/src/transfers/transferRoutes.js, mounted at /api/v1/transfers).
 */

const BASE = '/api/v1/transfers';

async function asJson(response) {
    let body = null;
    try {
        body = await response.json();
    } catch {
        // no JSON body (e.g. a plain 404/500) — fall through with body = null
    }
    if (!response.ok) {
        const message = body?.message || `Request failed (${response.status})`;
        const err = new Error(message);
        err.status = response.status;
        err.body = body;
        throw err;
    }
    return body;
}

/** @returns {Promise<{chunkBytes:number,maxTransferBytes:number,defaultExpiryDays:number,allowedExpiryDays:number[],previewMaxBytes:number,maxRecipients:number}>} */
export function getTransferConfig() {
    return fetch(`${BASE}/config`).then(asJson);
}

/**
 * @param {object} payload see transferRoutes.js POST / for shape
 * @returns {Promise<{id:string, manageToken:string, manageUrl:string, chunkBytes:number, files: Array<{fileId:string,name:string,totalChunks:number}>}>}
 */
export function createTransfer(payload) {
    return fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(asJson);
}

/**
 * @param {string} transferId @param {string} fileId @param {number} partNumber @param {ArrayBuffer} buffer
 */
export function uploadChunk(transferId, fileId, partNumber, buffer) {
    return fetch(`${BASE}/${transferId}/files/${fileId}/chunks/${partNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
    }).then(asJson);
}

/** @param {string} transferId @param {string} fileId @returns {Promise<{uploadedParts:number[], totalChunks:number}>} */
export function getFileStatus(transferId, fileId) {
    return fetch(`${BASE}/${transferId}/files/${fileId}/status`).then(asJson);
}

/** @param {string} transferId @returns {Promise<{id:string,status:string,shareUrl:string,manageUrl:string}>} */
export function finalizeTransfer(transferId) {
    return fetch(`${BASE}/${transferId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    }).then(asJson);
}

/** @param {string} transferId @param {string} email */
export function requestEmailVerification(transferId, email) {
    return fetch(`${BASE}/${transferId}/verify-email/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    }).then(asJson);
}

/** @param {string} transferId @param {string} email @param {string} code */
export function confirmEmailVerification(transferId, email, code) {
    return fetch(`${BASE}/${transferId}/verify-email/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
    }).then(asJson);
}

/** @param {string} transferId public metadata for the download page */
export function getTransferMeta(transferId) {
    return fetch(`${BASE}/${transferId}`).then(asJson);
}

/** @param {string} manageToken */
export function getManageMeta(manageToken) {
    return fetch(`${BASE}/manage/${manageToken}`).then(asJson);
}

/** @param {string} manageToken */
export function deleteTransfer(manageToken) {
    return fetch(`${BASE}/manage/${manageToken}`, { method: 'DELETE' }).then(asJson);
}

/** @param {string} transferId @param {string} [reason] */
export function reportTransfer(transferId, reason) {
    return fetch(`${BASE}/${transferId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || '' }),
    }).then(asJson);
}

export function downloadFileUrl(transferId, fileId) {
    return `${BASE}/${transferId}/files/${fileId}/download`;
}

export function previewFileUrl(transferId, fileId) {
    return `${BASE}/${transferId}/files/${fileId}/preview`;
}

export function zipUrl(transferId) {
    return `${BASE}/${transferId}/zip`;
}
