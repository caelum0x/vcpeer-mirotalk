'use strict';

/**
 * Daily, rolling-UTC-day usage tracker for VCPeer Send's "Send a link" mode.
 *
 * Two instances are used in transferRoutes.js:
 *   - a bytes quota keyed by client IP (SEND_LINK_DAILY_IP_QUOTA_BYTES)
 *   - a transfer-count quota keyed by verified sender email (SEND_LINK_DAILY_EMAIL_LIMIT),
 *     to slow down spam abuse of the "Send by email" delivery mode
 *
 * Pure in-memory + injectable clock, so it's unit testable without real timers
 * or waiting a day for the window to roll over.
 */
class QuotaTracker {
    /**
     * @param {object} options
     * @param {number} options.limit max units (bytes, or count) per key per UTC day
     * @param {() => number} [options.now] clock, defaults to Date.now
     */
    constructor({ limit, now = Date.now }) {
        this.limit = limit;
        this._now = now;
        this._usage = new Map(); // `${dayKey}:${key}` -> units used
    }

    _dayKey(ts) {
        return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD, UTC
    }

    /**
     * @param {string} key e.g. an IP address or email
     * @returns {number} units already used today for this key
     */
    used(key) {
        return this._usage.get(`${this._dayKey(this._now())}:${key}`) || 0;
    }

    /**
     * @param {string} key
     * @param {number} units how much this request would add (e.g. bytes, or 1 for a count quota)
     * @returns {{ allowed: boolean, used: number, limit: number, remaining: number }}
     *   `used`/`remaining` reflect state *after* a successful (allowed) call;
     *   on a rejected call nothing is recorded, so a client that stops retrying
     *   doesn't lose quota headroom.
     */
    consume(key, units) {
        const now = this._now();
        const mapKey = `${this._dayKey(now)}:${key}`;
        const current = this._usage.get(mapKey) || 0;
        const next = current + units;
        if (next > this.limit) {
            return { allowed: false, used: current, limit: this.limit, remaining: Math.max(0, this.limit - current) };
        }
        this._usage.set(mapKey, next);
        return { allowed: true, used: next, limit: this.limit, remaining: Math.max(0, this.limit - next) };
    }

    /** Drops usage entries for days other than today — call occasionally to bound memory. */
    pruneOldDays() {
        const todayKey = this._dayKey(this._now());
        for (const mapKey of this._usage.keys()) {
            if (!mapKey.startsWith(`${todayKey}:`)) this._usage.delete(mapKey);
        }
    }

    reset() {
        this._usage.clear();
    }
}

module.exports = { QuotaTracker };
