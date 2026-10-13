'use strict';

import { StreamingSha256 } from './hash.js';
import { FileWriter, requestStorage } from './file-writer.js';
import { CONTROL_MESSAGE_TYPES } from './constants.js';

/**
 * Drives the receiver side of a transfer over an already-open RTCDataChannel.
 *
 * Lifecycle:
 *   1. receives the manifest, surfaces it via onManifest() so the UI can show
 *      file names/sizes and a single "Save" button
 *   2. UI calls accept() from inside that button's click handler (user gesture
 *      required for the File System Access API pickers) — this requests
 *      storage and tells the sender we're ready
 *   3. binary chunks arrive and are written to disk (or buffered for the Blob
 *      fallback) until file-end, whose sha256 is compared against what we
 *      actually received
 *   4. "done" control message → onDone()
 */
export class ReceiveSession {
    /**
     * @param {object} options
     * @param {RTCDataChannel} options.channel
     * @param {(manifest: { files: Array<{id:string,name:string,size:number,mime:string}> }) => void} [options.onManifest]
     * @param {(info: { fileId: string, receivedBytes: number, totalBytes: number }) => void} [options.onProgress]
     * @param {(info: { fileId: string, verified: boolean|null, blob: Blob|null }) => void} [options.onFileComplete]
     * @param {() => void} [options.onDone]
     * @param {(reason: string) => void} [options.onAbort]
     * @param {() => StreamingSha256} [options.createHasher]
     * @param {typeof requestStorage} [options.requestStorageImpl] injectable for tests
     */
    constructor({
        channel,
        onManifest = () => {},
        onProgress = () => {},
        onFileComplete = () => {},
        onDone = () => {},
        onAbort = () => {},
        createHasher = () => new StreamingSha256(),
        requestStorageImpl = requestStorage,
    }) {
        this.channel = channel;
        this.onManifest = onManifest;
        this.onProgress = onProgress;
        this.onFileComplete = onFileComplete;
        this.onDone = onDone;
        this.onAbort = onAbort;
        this.createHasher = createHasher;
        this._requestStorage = requestStorageImpl;

        this.manifest = null;
        this._storage = null;
        /** @type {Map<string, { meta: object, writer: FileWriter, hasher: StreamingSha256|null }>} */
        this._files = new Map();
        this._currentFileId = null;

        this.channel.addEventListener('message', (event) => this._handleMessage(event));
    }

    _handleMessage(event) {
        if (typeof event.data === 'string') {
            this._handleControlMessage(JSON.parse(event.data));
            return;
        }
        this._handleChunk(event.data);
    }

    _handleControlMessage(msg) {
        switch (msg.type) {
            case CONTROL_MESSAGE_TYPES.MANIFEST:
                this.manifest = msg;
                this.onManifest(msg);
                break;
            case CONTROL_MESSAGE_TYPES.FILE_START:
                this._currentFileId = msg.id;
                break;
            case CONTROL_MESSAGE_TYPES.FILE_END:
                this._finishCurrentFile(msg.sha256);
                break;
            case CONTROL_MESSAGE_TYPES.DONE:
                this.onDone();
                break;
            case CONTROL_MESSAGE_TYPES.ABORT:
                this.onAbort(msg.reason || 'The sender cancelled the transfer');
                break;
            default:
            // ignore unknown control messages for forward compatibility
        }
    }

    async _handleChunk(data) {
        const entry = this._files.get(this._currentFileId);
        if (!entry) return; // chunk arrived before file-start/accept — drop defensively
        const buf = data instanceof ArrayBuffer ? data : data.buffer;
        await entry.writer.push(buf);
        entry.hasher?.update(buf);
        this.onProgress({
            fileId: this._currentFileId,
            receivedBytes: entry.writer.received,
            totalBytes: entry.meta.size,
        });
    }

    async _finishCurrentFile(expectedSha256) {
        const fileId = this._currentFileId;
        const entry = this._files.get(fileId);
        if (!entry) return;

        const blob = await entry.writer.finalize();
        let verified = null;
        if (expectedSha256 && entry.hasher) {
            verified = entry.hasher.digest() === expectedSha256;
        }
        this.onFileComplete({ fileId, verified, blob, name: entry.meta.name });
        this._currentFileId = null;
    }

    /**
     * Call from the "Save" button's click handler. Requests storage (prompting
     * the user once, if the File System Access API is available) and tells the
     * sender to start streaming.
     * @param {boolean} [computeHash]
     */
    async accept(computeHash = true) {
        if (!this.manifest) throw new Error('accept() called before a manifest was received');

        this._storage = await this._requestStorage(this.manifest);

        for (const meta of this.manifest.files) {
            const writer = new FileWriter({ file: meta, ...this._storage });
            // eslint-disable-next-line no-await-in-loop -- pickers/handles must open in order
            await writer.open();
            const hasher = computeHash ? this.createHasher() : null;
            if (hasher) await hasher.init();
            this._files.set(meta.id, { meta, writer, hasher });
        }

        this.channel.send(JSON.stringify({ type: CONTROL_MESSAGE_TYPES.RECEIVER_READY }));
    }
}
