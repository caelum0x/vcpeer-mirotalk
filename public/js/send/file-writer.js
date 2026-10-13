'use strict';

import { ChunkReassembler } from './reassembler.js';

/**
 * Picks how received bytes get to disk:
 *   - File System Access API (`showSaveFilePicker` / `showDirectoryPicker`)
 *     when available → streamed straight to disk, constant memory regardless
 *     of file size.
 *   - Blob fallback otherwise → held in memory (as an array of ArrayBuffers,
 *     joined into a Blob only once complete) and handed to the browser via a
 *     plain `<a download>` click. This is the path every browser without the
 *     File System Access API (Firefox, Safari) takes, same limitation as
 *     every other browser-only transfer tool.
 *
 * `requestStorage()` is called once per transfer, from inside the user's
 * "Save" button click (a user gesture is required for showSaveFilePicker /
 * showDirectoryPicker). `openFileWriter(fileMeta)` is then called once per
 * file in the manifest.
 */

/** @returns {boolean} */
export function supportsFileSystemAccess() {
    return typeof globalThis.showDirectoryPicker === 'function' || typeof globalThis.showSaveFilePicker === 'function';
}

/**
 * @param {{ files: Array<{ id: string, name: string }> }} manifest
 * @returns {Promise<{ mode: 'directory'|'file'|'blob', directoryHandle?: FileSystemDirectoryHandle, fileHandle?: FileSystemFileHandle }>}
 */
export async function requestStorage(manifest) {
    if (typeof globalThis.showDirectoryPicker === 'function' && manifest.files.length > 1) {
        try {
            const directoryHandle = await globalThis.showDirectoryPicker({ mode: 'readwrite' });
            return { mode: 'directory', directoryHandle };
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            // Fall through to per-file / blob mode if the directory picker isn't usable.
        }
    }
    if (typeof globalThis.showSaveFilePicker === 'function' && manifest.files.length === 1) {
        try {
            const fileHandle = await globalThis.showSaveFilePicker({ suggestedName: manifest.files[0].name });
            return { mode: 'file', fileHandle };
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
        }
    }
    return { mode: 'blob' };
}

/**
 * A single file's writer: push() for each binary chunk, finalize() when the
 * sender's file-end control message arrives.
 */
export class FileWriter {
    /**
     * @param {object} options
     * @param {{ id: string, name: string, size: number, mime: string }} options.file
     * @param {'directory'|'file'|'blob'} options.mode
     * @param {FileSystemDirectoryHandle} [options.directoryHandle]
     * @param {FileSystemFileHandle} [options.fileHandle]
     */
    constructor({ file, mode, directoryHandle, fileHandle }) {
        this.file = file;
        this.mode = mode;
        this.directoryHandle = directoryHandle;
        this.fileHandle = fileHandle;
        this.reassembler = mode === 'blob' ? new ChunkReassembler(file.size) : null;
        this.received = 0;
        this._stream = null;
    }

    async open() {
        if (this.mode === 'directory') {
            const handle = await this.directoryHandle.getFileHandle(this.file.name, { create: true });
            this._stream = await handle.createWritable();
        } else if (this.mode === 'file') {
            this._stream = await this.fileHandle.createWritable();
        }
        // mode === 'blob' needs no stream — chunks accumulate in this.reassembler
    }

    /**
     * @param {ArrayBuffer} chunk
     */
    async push(chunk) {
        this.received += chunk.byteLength;
        if (this._stream) {
            await this._stream.write(chunk);
        } else {
            this.reassembler.push(chunk);
        }
    }

    isComplete() {
        return this.received === this.file.size;
    }

    /**
     * @returns {Promise<Blob|null>} the assembled Blob in 'blob' mode (for the
     *   download link / Save button), or null when written straight to disk.
     */
    async finalize() {
        if (this._stream) {
            await this._stream.close();
            return null;
        }
        return this.reassembler.toBlob(this.file.mime);
    }

    async abort() {
        try {
            await this._stream?.abort?.();
        } catch {
            // no-op
        }
        this.reassembler?.clear();
    }
}
