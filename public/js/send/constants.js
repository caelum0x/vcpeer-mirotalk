'use strict';

/**
 * VCPeer Send — shared constants.
 *
 * Chunk size follows the convention used by PairDrop/ShareDrop-style WebRTC file
 * transfer tools: 16 KiB keeps every RTCDataChannel message well under the
 * ~16-64 KiB per-message limits some SCTP implementations impose, while staying
 * large enough for good throughput.
 */
export const CHUNK_SIZE = 16 * 1024; // 16 KiB

// Backpressure thresholds for RTCDataChannel.bufferedAmount. When the buffered
// amount exceeds the high watermark we stop reading/sending and wait for the
// 'bufferedamountlow' event (fired once bufferedAmount drops back under
// bufferedAmountLowThreshold) before resuming. This keeps multi-GB transfers
// from buffering the whole file in memory.
export const BUFFERED_AMOUNT_HIGH_WATERMARK = 16 * CHUNK_SIZE * 32; // ~8 MiB
export const BUFFERED_AMOUNT_LOW_WATERMARK = 16 * CHUNK_SIZE * 8; // ~2 MiB

export const DATA_CHANNEL_LABEL = 'vcpeer_send_channel';

export const CONTROL_MESSAGE_TYPES = Object.freeze({
    MANIFEST: 'manifest',
    RECEIVER_READY: 'receiver-ready',
    FILE_START: 'file-start',
    FILE_END: 'file-end',
    DONE: 'done',
    ABORT: 'abort',
});

// Room/code lifetime. Mirrors the value used by the server's in-memory code map
// (app/src/sendCode.js) — kept here too so the UI can show an accurate "expires in".
export const SEND_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
