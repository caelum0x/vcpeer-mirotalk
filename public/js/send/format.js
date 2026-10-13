'use strict';

/**
 * Pure formatting helpers for the VCPeer Send progress UI.
 * No DOM access — kept pure so they're trivially unit testable.
 */

const UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * @param {number} bytes
 * @returns {string} e.g. "1.5 MB"
 */
export function bytesToSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 Bytes';
    if (bytes === 0) return '0 Bytes';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
    const value = bytes / Math.pow(1024, i);
    const decimals = i === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${UNITS[i]}`;
}

/**
 * @param {number} bytesPerSecond
 * @returns {string} e.g. "4.2 MB/s"
 */
export function formatSpeed(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 Bytes/s';
    return `${bytesToSize(bytesPerSecond)}/s`;
}

/**
 * @param {number} remainingBytes
 * @param {number} bytesPerSecond
 * @returns {string} e.g. "12s", "3m 4s", "--" when unknown
 */
export function formatEta(remainingBytes, bytesPerSecond) {
    if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return '0s';
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '--';

    const totalSeconds = Math.ceil(remainingBytes / bytesPerSecond);
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;

    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
}

/**
 * Rolling-average throughput estimator. Pure/stateless input→output: given the
 * ordered list of recent {bytes, atMs} samples (most recent last) and the
 * current time, returns bytes/sec over the trailing window.
 * @param {Array<{bytes: number, atMs: number}>} samples cumulative bytes transferred, sampled over time
 * @param {number} windowMs trailing window to average over
 * @returns {number} bytes per second, 0 if not enough data
 */
export function estimateThroughput(samples, windowMs = 3000) {
    if (!Array.isArray(samples) || samples.length < 2) return 0;
    const latest = samples[samples.length - 1];
    const cutoff = latest.atMs - windowMs;

    let base = samples[0];
    for (let i = samples.length - 2; i >= 0; i--) {
        if (samples[i].atMs < cutoff) break;
        base = samples[i];
    }

    const deltaMs = latest.atMs - base.atMs;
    const deltaBytes = latest.bytes - base.bytes;
    if (deltaMs <= 0 || deltaBytes <= 0) return 0;
    return (deltaBytes / deltaMs) * 1000;
}

/**
 * @param {number} percent 0..100
 * @returns {number} clamped and rounded to 1 decimal place
 */
export function clampPercent(percent) {
    if (!Number.isFinite(percent)) return 0;
    return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}
