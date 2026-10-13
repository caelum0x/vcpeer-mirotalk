'use strict';

/**
 * Thin wrapper around the socket.io client, reusing VCPeer's existing
 * signaling events as-is (see app/src/server.js):
 *   - 'join'          → join a room (channel). No video/audio capabilities are
 *                       advertised; we only use this to get a seat in the room.
 *   - 'addPeer'       → server tells us about each other peer in the room and
 *                       who should create the WebRTC offer (mesh signaling,
 *                       same mechanism the video-call client uses).
 *   - 'removePeer'    → a peer left (used to detect "the other side closed the
 *                       tab" / room expiry).
 *   - 'relaySDP' / 'sessionDescription' → offer/answer exchange.
 *   - 'relayICE' / 'iceCandidate'       → ICE candidate exchange.
 *
 * No new server-side signaling events are introduced for the WebRTC handshake
 * itself — only a small REST pair for the optional 6-digit code (see
 * app/src/sendCode.js), which this module does not touch.
 */
export class SignalingClient {
    /**
     * @param {object} [options]
     * @param {() => object} [options.ioFactory] returns a connected socket.io Socket.
     *   Defaults to the global `io()` from /socket.io/socket.io.js.
     */
    constructor({ ioFactory = defaultIoFactory } = {}) {
        this._ioFactory = ioFactory;
        this._socket = null;
        this._handlers = {
            addPeer: [],
            removePeer: [],
            sessionDescription: [],
            iceCandidate: [],
            unauthorized: [],
        };
    }

    connect() {
        if (this._socket) return this._socket;
        const socket = this._ioFactory();
        socket.on('addPeer', (config) => this._emit('addPeer', config));
        socket.on('removePeer', (config) => this._emit('removePeer', config));
        socket.on('sessionDescription', (config) => this._emit('sessionDescription', config));
        socket.on('iceCandidate', (config) => this._emit('iceCandidate', config));
        socket.on('unauthorized', (config) => this._emit('unauthorized', config));
        this._socket = socket;
        return socket;
    }

    /**
     * @param {'addPeer'|'removePeer'|'sessionDescription'|'iceCandidate'|'unauthorized'} event
     * @param {(config: object) => void} handler
     */
    on(event, handler) {
        if (!this._handlers[event]) throw new RangeError(`unknown signaling event: ${event}`);
        this._handlers[event].push(handler);
    }

    _emit(event, config) {
        for (const handler of this._handlers[event]) handler(config);
    }

    /**
     * @param {string} channel room token (see room-token.js)
     * @param {string} peerName display name, purely cosmetic for this feature
     */
    join(channel, peerName) {
        this.connect().emit('join', {
            channel,
            channel_password: '',
            peer_uuid: cryptoRandomUuid(),
            peer_name: peerName,
            peer_avatar: '',
            peer_video: false,
            peer_audio: false,
            peer_video_status: false,
            peer_audio_status: false,
            peer_screen_status: false,
            peer_hand_status: false,
            peer_rec_status: false,
            peer_privacy_status: false,
            peer_info: {},
        });
    }

    /**
     * @param {string} peerId
     * @param {RTCSessionDescriptionInit} sessionDescription
     */
    sendSessionDescription(peerId, sessionDescription) {
        this.connect().emit('relaySDP', { peer_id: peerId, session_description: sessionDescription });
    }

    /**
     * @param {string} peerId
     * @param {RTCIceCandidateInit} iceCandidate
     */
    sendIceCandidate(peerId, iceCandidate) {
        this.connect().emit('relayICE', { peer_id: peerId, ice_candidate: iceCandidate });
    }

    disconnect() {
        this._socket?.disconnect();
        this._socket = null;
    }
}

function defaultIoFactory() {
    if (typeof window === 'undefined' || typeof window.io !== 'function') {
        throw new Error('socket.io client (window.io) is not available — is /socket.io/socket.io.js loaded?');
    }
    return window.io({ transports: ['websocket'] });
}

function cryptoRandomUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Fallback for environments without randomUUID (not security sensitive — cosmetic peer id only).
    return `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
