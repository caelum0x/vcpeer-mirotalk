'use strict';

// npx mocha tests/test-peerConnectionStatus.js
//
// handlePeersConnectionStatus used to only console.log the RTCPeerConnection's
// connectionState - a dropped/failed P2P path (e.g. symmetric NAT or a strict
// firewall with no TURN relay configured) left the remote tile silently frozen
// with no user feedback and no attempt to recover. These tests exercise the
// fixed behaviour in isolation (per this repo's vm-sandbox test convention,
// see test-swalNotifications.js) without needing a real browser or network.

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const read = (file) => fs.readFileSync(path.join(__dirname, '../', file), 'utf8');
const client = read('public/js/client.js');
const start = client.indexOf('async function handlePeersConnectionStatus(');
const end = client.indexOf('async function handleOnIceCandidate(', start);

describe('RTCPeerConnection connection-status recovery', () => {
    let clock;
    let context;
    let userLog;
    let peerConnections;
    let allPeers;
    let peerReconnectTimers;
    let peerConnectionTroubled;
    let peerConnection;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
        userLog = sinon.spy();

        peerConnection = {
            connectionState: 'connected',
            restartIce: sinon.spy(),
        };
        peerConnections = { p1: peerConnection };
        allPeers = { p1: { peer_name: 'Alex' } };
        peerReconnectTimers = {};
        peerConnectionTroubled = {};

        context = vm.createContext({
            console,
            setTimeout,
            clearTimeout,
            userLog,
            peerConnections,
            allPeers,
            peerReconnectTimers,
            peerConnectionTroubled,
        });
        vm.runInContext(client.slice(start, end), context);
    });

    afterEach(() => {
        clock.restore();
    });

    function changeState(state) {
        peerConnection.connectionState = state;
        peerConnection.onconnectionstatechange({ currentTarget: peerConnection });
    }

    it('does not warn immediately on a disconnected state (grace period)', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('disconnected');
        assert.equal(userLog.called, false);
        assert.equal(peerConnection.restartIce.called, false);
    });

    it('recovers silently if disconnected resolves itself before the grace period elapses', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('disconnected');
        peerConnection.connectionState = 'connected';
        clock.tick(3000);
        assert.equal(userLog.called, false, 'no warning or reconnect toast for a transient blip');
    });

    it('warns and restarts ICE if still disconnected after the grace period', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('disconnected');
        clock.tick(3000);
        assert.equal(userLog.calledOnce, true);
        assert.equal(userLog.firstCall.args[0], 'warning');
        assert.match(userLog.firstCall.args[1], /Alex/);
        assert.equal(peerConnection.restartIce.calledOnce, true);
    });

    it('warns and restarts ICE immediately on a failed state, no grace period', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('failed');
        assert.equal(userLog.calledOnce, true);
        assert.equal(userLog.firstCall.args[0], 'warning');
        assert.equal(peerConnection.restartIce.calledOnce, true);
    });

    it('tells the user when a troubled connection recovers', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('failed');
        userLog.resetHistory();
        changeState('connected');
        assert.equal(userLog.calledOnce, true);
        assert.equal(userLog.firstCall.args[0], 'success');
        assert.match(userLog.firstCall.args[1], /Reconnected with Alex/);
    });

    it('does not show a reconnected toast if the connection was never troubled', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('connected');
        assert.equal(userLog.called, false);
    });

    it('cancels the pending grace-period timer once the state leaves disconnected', async () => {
        await context.handlePeersConnectionStatus('p1');
        changeState('disconnected');
        changeState('failed');
        userLog.resetHistory();
        clock.tick(3000);
        // the disconnected-state timer must not fire a second, stale warning
        assert.equal(userLog.called, false);
    });

    it('falls back gracefully when the browser has no restartIce support', async () => {
        delete peerConnection.restartIce;
        await context.handlePeersConnectionStatus('p1');
        assert.doesNotThrow(() => changeState('failed'));
        assert.equal(userLog.calledOnce, true);
    });
});
