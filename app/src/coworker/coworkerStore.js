'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Logger = require('../logs');
const log = new Logger('CoworkerStore');

/**
 * VCPeer Coworker's conversation store.
 *
 * Same "no DB wired into this fork, persist to a JSON file" pattern as
 * launchboard.js / notify.js. Threads are keyed by an opaque threadId:
 *   - `room:<roomId>`   — the conversation continues from a live call
 *     (see app/src/coworker/index.js `getReplyForRoom`), so a user can keep
 *     talking to the coworker on the `/coworker` page after the call ends.
 *   - a random UUID      — a fresh, call-independent conversation started
 *     directly from `/coworker` or via the widget API.
 *   - `slack:<channel>:<thread_ts>` — a Slack thread (see slackBridge.js).
 *
 * All mutations are immutable: every write builds a brand-new object/array
 * and replaces the file wholesale, never mutating an object already handed
 * out to a caller.
 */
class CoworkerStore {
    /**
     * @param {object} opts
     * @param {string} opts.dataDir directory holding threads.json
     * @param {number} [opts.maxThreads] guardrail so storage can't grow unbounded
     * @param {number} [opts.maxMessagesPerThread] trims oldest messages beyond this
     */
    constructor({ dataDir, maxThreads = 20000, maxMessagesPerThread = 60 }) {
        this.dataDir = dataDir;
        this.dataFile = path.join(dataDir, 'threads.json');
        this.maxThreads = maxThreads;
        this.maxMessagesPerThread = maxMessagesPerThread;
    }

    ensureDataFile() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.dataFile)) {
            fs.writeFileSync(this.dataFile, JSON.stringify({}, null, 2));
        }
    }

    readAll() {
        this.ensureDataFile();
        try {
            const raw = fs.readFileSync(this.dataFile, 'utf-8');
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            log.error('Failed to read coworker thread store, treating as empty', error.message);
            return {};
        }
    }

    writeAll(threads) {
        fs.writeFileSync(this.dataFile, JSON.stringify(threads, null, 2));
    }

    /**
     * @param {string} threadId
     * @returns {{id: string, messages: Array<{role:string, content:string, ts:number}>, createdAt: number, updatedAt: number}}
     */
    getThread(threadId) {
        const threads = this.readAll();
        return (
            threads[threadId] || {
                id: threadId,
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }
        );
    }

    /**
     * Appends new messages to a thread and persists it. Returns the new
     * (trimmed) thread — never mutates the thread object passed in or read
     * from disk.
     *
     * @param {string} threadId
     * @param {Array<{role: 'user'|'assistant', content: string}>} newMessages
     * @returns {{id: string, messages: Array<object>, createdAt: number, updatedAt: number}}
     */
    appendMessages(threadId, newMessages) {
        const threads = this.readAll();
        const existing = threads[threadId];
        const now = Date.now();
        const stamped = newMessages.map((m) => ({ role: m.role, content: m.content, ts: now }));

        const merged = [...(existing?.messages || []), ...stamped];
        const trimmed = merged.length > this.maxMessagesPerThread ? merged.slice(-this.maxMessagesPerThread) : merged;

        const updatedThread = {
            id: threadId,
            messages: trimmed,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        const threadIds = Object.keys(threads);
        const isNewThread = !existing;
        let nextThreads = { ...threads, [threadId]: updatedThread };

        // Guardrail: if adding a brand-new thread would exceed the cap, evict
        // the oldest-updated thread first so storage never grows unbounded.
        if (isNewThread && threadIds.length >= this.maxThreads) {
            const oldestId = threadIds.sort((a, b) => (threads[a].updatedAt || 0) - (threads[b].updatedAt || 0))[0];
            const { [oldestId]: _removed, ...rest } = nextThreads;
            nextThreads = rest;
        }

        this.writeAll(nextThreads);
        return updatedThread;
    }

    createThreadId() {
        return crypto.randomUUID();
    }
}

module.exports = { CoworkerStore };
