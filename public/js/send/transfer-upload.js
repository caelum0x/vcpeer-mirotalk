'use strict';

import { uploadChunk, getFileStatus } from './transfer-api.js';

const MAX_RETRIES_PER_CHUNK = 5;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads one File in fixed-size chunks, resuming from whatever parts the
 * server already has (so a flaky connection — or a page reload — can pick up
 * where it left off instead of re-uploading the whole file).
 *
 * @param {object} options
 * @param {string} options.transferId
 * @param {string} options.fileId
 * @param {File} options.file
 * @param {number} options.chunkBytes
 * @param {(sentBytes: number, totalBytes: number) => void} [options.onProgress]
 * @param {() => boolean} [options.isCancelled]
 * @returns {Promise<void>}
 */
export async function uploadFileChunked({
    transferId,
    fileId,
    file,
    chunkBytes,
    onProgress,
    isCancelled = () => false,
}) {
    const totalChunks = Math.ceil(file.size / chunkBytes);
    const status = await getFileStatus(transferId, fileId).catch(() => ({ uploadedParts: [] }));
    const alreadyUploaded = new Set(status.uploadedParts || []);

    let sentBytes = alreadyUploaded.size * chunkBytes;
    if (alreadyUploaded.has(totalChunks)) {
        // last chunk may be smaller than chunkBytes — correct the estimate
        sentBytes = Math.min(sentBytes, file.size);
    }
    onProgress?.(Math.min(sentBytes, file.size), file.size);

    for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
        if (isCancelled()) throw new Error('cancelled');
        if (alreadyUploaded.has(partNumber)) continue;

        const start = (partNumber - 1) * chunkBytes;
        const end = Math.min(start + chunkBytes, file.size);
        const blob = file.slice(start, end);
        // eslint-disable-next-line no-await-in-loop -- chunks must be sequenced for accurate progress/backpressure
        const buffer = await blob.arrayBuffer();

        let lastErr;
        let uploaded = false;
        for (let attempt = 0; attempt < MAX_RETRIES_PER_CHUNK && !uploaded; attempt++) {
            try {
                // eslint-disable-next-line no-await-in-loop -- retry loop is inherently sequential
                await uploadChunk(transferId, fileId, partNumber, buffer);
                uploaded = true;
            } catch (err) {
                lastErr = err;
                // eslint-disable-next-line no-await-in-loop -- deliberate backoff between retries
                await sleep(Math.min(500 * 2 ** attempt, 8000));
            }
        }
        if (!uploaded) throw lastErr || new Error(`Chunk ${partNumber}/${totalChunks} failed after retries`);

        sentBytes = Math.min(sentBytes + (end - start), file.size);
        onProgress?.(sentBytes, file.size);
    }
}

/**
 * Uploads multiple files sequentially (one at a time — keeps memory and
 * concurrent-request count bounded, generous enough for a single sender on a
 * home connection), aggregating a single total-bytes progress callback.
 *
 * @param {object} options
 * @param {string} options.transferId
 * @param {Array<{ fileId: string, file: File }>} options.files
 * @param {number} options.chunkBytes
 * @param {(sentBytes: number, totalBytes: number) => void} [options.onTotalProgress]
 * @param {(fileId: string, sentBytes: number, totalBytes: number) => void} [options.onFileProgress]
 * @param {() => boolean} [options.isCancelled]
 */
export async function uploadAllChunked({
    transferId,
    files,
    chunkBytes,
    onTotalProgress,
    onFileProgress,
    isCancelled,
}) {
    const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
    const sentByFile = new Map(files.map((f) => [f.fileId, 0]));

    const reportTotal = () => {
        const sent = Array.from(sentByFile.values()).reduce((a, b) => a + b, 0);
        onTotalProgress?.(sent, totalBytes);
    };

    for (const { fileId, file } of files) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design, see docstring
        await uploadFileChunked({
            transferId,
            fileId,
            file,
            chunkBytes,
            isCancelled,
            onProgress: (sent, total) => {
                sentByFile.set(fileId, sent);
                onFileProgress?.(fileId, sent, total);
                reportTotal();
            },
        });
    }
}
