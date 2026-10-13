'use strict';

import { iterateChunks } from './chunker.js';
import { StreamingSha256 } from './hash.js';
import { CONTROL_MESSAGE_TYPES, BUFFERED_AMOUNT_HIGH_WATERMARK, BUFFERED_AMOUNT_LOW_WATERMARK } from './constants.js';

/**
 * Drives the sender side of a transfer over an already-open RTCDataChannel:
 *   1. send a JSON manifest (file names/sizes/types)
 *   2. wait for the receiver's "ready" signal (it clicked Save)
 *   3. for each file: file-start control message, then raw binary chunks with
 *      backpressure, then a file-end control message carrying the SHA-256
 *   4. a final "done" control message
 *
 * Control messages are small JSON strings; chunks are raw ArrayBuffers — the
 * receiver tells the two apart with `typeof event.data === 'string'`.
 */
export class SendSession {
    /**
     * @param {object} options
     * @param {RTCDataChannel} options.channel open data channel, binaryType 'arraybuffer'
     * @param {File[]} options.files
     * @param {(progress: { fileId: string, sentBytes: number, totalBytes: number }) => void} [options.onProgress]
     * @param {(fileId: string) => void} [options.onFileSent]
     * @param {() => void} [options.onDone]
     * @param {(err: Error) => void} [options.onError]
     * @param {boolean} [options.computeHash] default true
     * @param {() => StreamingSha256} [options.createHasher] injectable for tests
     */
    constructor({
        channel,
        files,
        onProgress = () => {},
        onFileSent = () => {},
        onDone = () => {},
        onError = () => {},
        computeHash = true,
        createHasher = () => new StreamingSha256(),
    }) {
        this.channel = channel;
        this.files = files;
        this.onProgress = onProgress;
        this.onFileSent = onFileSent;
        this.onDone = onDone;
        this.onError = onError;
        this.computeHash = computeHash;
        this.createHasher = createHasher;
        this._aborted = false;
    }

    buildManifest() {
        return {
            type: CONTROL_MESSAGE_TYPES.MANIFEST,
            files: this.files.map((file, index) => ({
                id: String(index),
                name: file.name,
                size: file.size,
                mime: file.type || 'application/octet-stream',
            })),
        };
    }

    abort() {
        this._aborted = true;
        try {
            this.channel.send(JSON.stringify({ type: CONTROL_MESSAGE_TYPES.ABORT }));
        } catch {
            // channel may already be closed
        }
    }

    /** Sends the manifest and resolves once the receiver has acknowledged readiness. */
    waitForReceiverReady() {
        return new Promise((resolve) => {
            const onMessage = (event) => {
                if (typeof event.data !== 'string') return;
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (msg.type === CONTROL_MESSAGE_TYPES.RECEIVER_READY) {
                    this.channel.removeEventListener('message', onMessage);
                    resolve();
                }
            };
            this.channel.addEventListener('message', onMessage);
            this.channel.send(JSON.stringify(this.buildManifest()));
        });
    }

    /** Streams every file in order. Resolves when the "done" message has been sent. */
    async sendAll() {
        const manifest = this.buildManifest();
        for (let i = 0; i < this.files.length; i++) {
            if (this._aborted) return;
            const file = this.files[i];
            const fileId = manifest.files[i].id;
            await this._sendOneFile(file, fileId);
            this.onFileSent(fileId);
        }
        if (!this._aborted) {
            this.channel.send(JSON.stringify({ type: CONTROL_MESSAGE_TYPES.DONE }));
            this.onDone();
        }
    }

    async _sendOneFile(file, fileId) {
        this.channel.send(JSON.stringify({ type: CONTROL_MESSAGE_TYPES.FILE_START, id: fileId }));

        const hasher = this.computeHash ? this.createHasher() : null;
        if (hasher) await hasher.init();

        let sentBytes = 0;
        for await (const chunk of iterateChunks(file)) {
            if (this._aborted) return;
            await this._sendWithBackpressure(chunk);
            hasher?.update(chunk);
            sentBytes += chunk.byteLength;
            this.onProgress({ fileId, sentBytes, totalBytes: file.size });
        }

        this.channel.send(
            JSON.stringify({
                type: CONTROL_MESSAGE_TYPES.FILE_END,
                id: fileId,
                sha256: hasher ? hasher.digest() : null,
            })
        );
    }

    /** @param {ArrayBuffer} chunk */
    async _sendWithBackpressure(chunk) {
        if (this.channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_WATERMARK) {
            await this._waitForBufferedAmountLow();
        }
        this.channel.send(chunk);
    }

    _waitForBufferedAmountLow() {
        return new Promise((resolve) => {
            this.channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_WATERMARK;
            const onLow = () => {
                this.channel.removeEventListener('bufferedamountlow', onLow);
                resolve();
            };
            this.channel.addEventListener('bufferedamountlow', onLow);
        });
    }
}
