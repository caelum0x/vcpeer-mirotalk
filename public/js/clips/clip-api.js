'use strict';

/**
 * Thin fetch wrapper for VCPeer's async "Record & share" clips REST API
 * (app/src/clips/clipRoutes.js, mounted at /api/v1/clips).
 */

const BASE = '/api/v1/clips';

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

/** @returns {Promise<{chunkBytes:number,maxClipBytes:number,defaultExpiryDays:number}>} */
export function getClipConfig() {
    return fetch(`${BASE}/config`).then(asJson);
}

/**
 * @param {{ title: string, mimeType: string, sizeBytes: number }} payload
 * @returns {Promise<{id:string, manageToken:string, chunkBytes:number, totalChunks:number}>}
 */
export function createClip(payload) {
    return fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(asJson);
}

/** @param {string} clipId @param {number} partNumber @param {ArrayBuffer} buffer */
export function uploadClipChunk(clipId, partNumber, buffer) {
    return fetch(`${BASE}/${clipId}/chunks/${partNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
    }).then(asJson);
}

/** @param {string} clipId @returns {Promise<{uploadedParts:number[], totalChunks:number}>} */
export function getClipStatus(clipId) {
    return fetch(`${BASE}/${clipId}/status`).then(asJson);
}

/** @param {string} clipId @returns {Promise<{id:string,status:string,shareUrl:string,manageToken:string}>} */
export function finalizeClip(clipId) {
    return fetch(`${BASE}/${clipId}/finalize`, { method: 'POST' }).then(asJson);
}

/** @param {string} clipId public metadata for the watch page */
export function getClipMeta(clipId) {
    return fetch(`${BASE}/${clipId}`).then(asJson);
}

/** @param {string} clipId @returns {Promise<{viewCount:number}>} */
export function registerClipView(clipId) {
    return fetch(`${BASE}/${clipId}/view`, { method: 'POST' }).then(asJson);
}

/** @param {string} clipId */
export function clipVideoUrl(clipId) {
    return `${BASE}/${clipId}/video`;
}

export function watchUrl(clipId) {
    return `${window.location.origin}/watch/${clipId}`;
}
