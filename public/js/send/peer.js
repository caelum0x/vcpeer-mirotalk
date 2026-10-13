'use strict';

import { DATA_CHANNEL_LABEL } from './constants.js';

/**
 * One RTCPeerConnection + its single data channel, wired to a SignalingClient.
 *
 * Mirrors the offer/answer/ICE-queueing flow already used by the in-call file
 * sharing in public/js/client.js (handleAddPeer / handleRtcOffer /
 * handleSessionDescription / handleIceCandidate / flushIceCandidates), trimmed
 * down to data-channel-only (no media tracks).
 */
export class PeerSession {
    /**
     * @param {object} options
     * @param {string} options.peerId remote socket.id
     * @param {RTCIceServer[]} options.iceServers
     * @param {boolean} options.shouldCreateOffer true if we initiate (per the server's addPeer event)
     * @param {import('./signaling.js').SignalingClient} options.signaling
     * @param {(event: { channel: RTCDataChannel }) => void} [options.onDataChannel]
     * @param {(state: RTCPeerConnectionState) => void} [options.onConnectionStateChange]
     * @param {(RTCPeerConnection: typeof RTCPeerConnection)} [options.RTCPeerConnectionImpl] injectable for tests
     */
    constructor({
        peerId,
        iceServers,
        shouldCreateOffer,
        signaling,
        onDataChannel,
        onConnectionStateChange,
        RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
    }) {
        if (!RTCPeerConnectionImpl) throw new Error('RTCPeerConnection is not available in this environment');

        this.peerId = peerId;
        this.signaling = signaling;
        this.dataChannel = null;
        this._pendingIce = [];

        this.pc = new RTCPeerConnectionImpl({ iceServers });

        this.pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            const { candidate, sdpMLineIndex } = event.candidate;
            this.signaling.sendIceCandidate(peerId, { candidate, sdpMLineIndex });
        };

        this.pc.onconnectionstatechange = () => {
            onConnectionStateChange?.(this.pc.connectionState);
        };

        this.pc.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.dataChannel.binaryType = 'arraybuffer';
            onDataChannel?.({ channel: this.dataChannel });
        };

        this.pc.onnegotiationneeded = async () => {
            try {
                const offer = await this.pc.createOffer();
                await this.pc.setLocalDescription(offer);
                this.signaling.sendSessionDescription(peerId, offer);
            } catch (err) {
                console.error('[VCPeer Send] failed to create/send offer', err);
            }
        };

        if (shouldCreateOffer) {
            this.dataChannel = this.pc.createDataChannel(DATA_CHANNEL_LABEL);
            this.dataChannel.binaryType = 'arraybuffer';
            onDataChannel?.({ channel: this.dataChannel });
        }
    }

    /**
     * @param {RTCSessionDescriptionInit} sessionDescription
     */
    async handleRemoteSessionDescription(sessionDescription) {
        await this.pc.setRemoteDescription(sessionDescription);
        await this._flushPendingIce();

        if (sessionDescription.type === 'offer') {
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.signaling.sendSessionDescription(this.peerId, answer);
        }
    }

    /**
     * @param {RTCIceCandidateInit} iceCandidate
     */
    async handleRemoteIceCandidate(iceCandidate) {
        if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
            this._pendingIce.push(iceCandidate);
            return;
        }
        try {
            await this.pc.addIceCandidate(iceCandidate);
        } catch (err) {
            console.error('[VCPeer Send] addIceCandidate failed', err);
        }
    }

    async _flushPendingIce() {
        const queued = this._pendingIce;
        this._pendingIce = [];
        for (const candidate of queued) {
            try {
                // eslint-disable-next-line no-await-in-loop -- candidates must be added in order
                await this.pc.addIceCandidate(candidate);
            } catch (err) {
                console.error('[VCPeer Send] addIceCandidate (queued) failed', err);
            }
        }
    }

    close() {
        try {
            this.dataChannel?.close();
        } catch {
            // no-op
        }
        try {
            this.pc.close();
        } catch {
            // no-op
        }
    }
}
