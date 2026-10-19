'use strict';

import { getClipConfig, createClip, finalizeClip, watchUrl } from './clip-api.js';
import { uploadClipChunked } from './clip-upload.js';

/**
 * End-to-end "turn this recorded Blob into a shareable /watch/:id link"
 * flow: fetch server limits, create the clip record, upload it in chunks,
 * finalize, return the share URL. Called from public/js/client.js right
 * after an in-room recording stops (see shareRecordingAsClip there) —
 * entirely separate from the local-download path, which is unaffected.
 *
 * @param {object} options
 * @param {Blob} options.blob the finished recording
 * @param {string} options.title
 * @param {(sentBytes: number, totalBytes: number) => void} [options.onProgress]
 * @returns {Promise<{ shareUrl: string, manageToken: string }>}
 */
export async function shareRecordingAsClip({ blob, title, onProgress }) {
    const { chunkBytes, maxClipBytes } = await getClipConfig();
    if (blob.size > maxClipBytes) {
        throw new Error(`Recording is ${(blob.size / (1024 * 1024)).toFixed(0)} MiB, over the shareable-link cap.`);
    }

    const created = await createClip({ title, mimeType: blob.type || 'video/webm', sizeBytes: blob.size });

    await uploadClipChunked({
        clipId: created.id,
        blob,
        chunkBytes: created.chunkBytes || chunkBytes,
        onProgress,
    });

    const result = await finalizeClip(created.id);
    return { shareUrl: result.shareUrl || watchUrl(created.id), manageToken: created.manageToken };
}
