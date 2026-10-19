'use strict';

import { getClipStatus, uploadClipChunk } from './clip-api.js';

const MAX_RETRIES_PER_CHUNK = 5;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads one recorded Blob in fixed-size chunks, resuming from whatever
 * parts the server already has. Adapted from
 * public/js/send/transfer-upload.js's uploadFileChunked, but for a clip
 * (always exactly one file, no fileId).
 *
 * @param {object} options
 * @param {string} options.clipId
 * @param {Blob} options.blob
 * @param {number} options.chunkBytes
 * @param {(sentBytes: number, totalBytes: number) => void} [options.onProgress]
 * @param {() => boolean} [options.isCancelled]
 * @returns {Promise<void>}
 */
export async function uploadClipChunked({ clipId, blob, chunkBytes, onProgress, isCancelled = () => false }) {
    const totalChunks = Math.ceil(blob.size / chunkBytes);
    const status = await getClipStatus(clipId).catch(() => ({ uploadedParts: [] }));
    const alreadyUploaded = new Set(status.uploadedParts || []);

    let sentBytes = alreadyUploaded.size * chunkBytes;
    if (alreadyUploaded.has(totalChunks)) {
        // last chunk may be smaller than chunkBytes — correct the estimate
        sentBytes = Math.min(sentBytes, blob.size);
    }
    onProgress?.(Math.min(sentBytes, blob.size), blob.size);

    for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
        if (isCancelled()) throw new Error('cancelled');
        if (alreadyUploaded.has(partNumber)) continue;

        const start = (partNumber - 1) * chunkBytes;
        const end = Math.min(start + chunkBytes, blob.size);
        const part = blob.slice(start, end);
        // eslint-disable-next-line no-await-in-loop -- chunks must be sequenced for accurate progress/backpressure
        const buffer = await part.arrayBuffer();

        let lastErr;
        let uploaded = false;
        for (let attempt = 0; attempt < MAX_RETRIES_PER_CHUNK && !uploaded; attempt++) {
            try {
                // eslint-disable-next-line no-await-in-loop -- retry loop is inherently sequential
                await uploadClipChunk(clipId, partNumber, buffer);
                uploaded = true;
            } catch (err) {
                lastErr = err;
                // eslint-disable-next-line no-await-in-loop -- deliberate backoff between retries
                await sleep(Math.min(500 * 2 ** attempt, 8000));
            }
        }
        if (!uploaded) throw lastErr || new Error(`Chunk ${partNumber}/${totalChunks} failed after retries`);

        sentBytes = Math.min(sentBytes + (end - start), blob.size);
        onProgress?.(sentBytes, blob.size);
    }
}
