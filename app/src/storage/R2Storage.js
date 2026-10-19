'use strict';

const https = require('https');
const aws4 = require('aws4');

/**
 * Cloudflare R2 (S3-compatible) implementation of the VCPeer Send storage
 * interface (see StorageInterface.js). Selected with SEND_LINK_STORAGE_DRIVER=r2.
 *
 * Each part is stored as its own plain object at key `<key>/part-<NNNNNNNN>`
 * (see StorageInterface.js for why parts are never concatenated server-side).
 * Talks to R2's S3-compatible API directly over HTTPS, signed with AWS
 * Signature V4 via the tiny `aws4` package — deliberately avoids pulling in
 * the full `@aws-sdk/client-s3` to keep the Oracle box's install light.
 *
 * Not covered by the unit suite (no live R2 bucket in this environment) —
 * see tests/test-r2Storage.js for the constructor-validation tests that *are*
 * run, and plans/vcpeer.md for manual verification steps once R2 credentials
 * are set in production.
 */
class R2Storage {
    /**
     * @param {object} options
     * @param {string} [options.accountId] Cloudflare account id (used to derive the default endpoint)
     * @param {string} options.accessKeyId R2 API token access key id
     * @param {string} options.secretAccessKey R2 API token secret
     * @param {string} options.bucket R2 bucket name
     * @param {string} [options.endpoint] override, e.g. for S3-compatible providers other than R2
     * @param {string} [options.region] defaults to 'auto' (R2's convention)
     */
    constructor({ accountId, accessKeyId, secretAccessKey, bucket, endpoint, region = 'auto' }) {
        if (!accessKeyId || !secretAccessKey || !bucket || !(accountId || endpoint)) {
            throw new Error(
                'R2Storage requires accessKeyId, secretAccessKey, bucket, and either accountId or endpoint ' +
                    '(set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET, or R2_ENDPOINT)'
            );
        }
        this.bucket = bucket;
        this.region = region;
        this.credentials = { accessKeyId, secretAccessKey };
        this.endpoint = endpoint || `https://${accountId}.r2.cloudflarestorage.com`;
        this.host = new URL(this.endpoint).host;
    }

    _partObjectKey(key, partNumber) {
        return `${key}/part-${String(partNumber).padStart(8, '0')}`;
    }

    _objectPath(objectKey) {
        return `/${this.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
    }

    /**
     * @param {{ method: string, objectKey?: string, bucketLevel?: boolean, query?: string, headers?: object, body?: Buffer }} args
     * @returns {Promise<import('http').IncomingMessage>} raw response (caller drains/streams it)
     */
    _request({ method, objectKey, bucketLevel = false, query, headers = {}, body }) {
        return new Promise((resolve, reject) => {
            const pathBase = bucketLevel ? `/${this.bucket}` : this._objectPath(objectKey);
            const fullPath = query ? `${pathBase}?${query}` : pathBase;
            const signed = aws4.sign(
                { host: this.host, method, path: fullPath, service: 's3', region: this.region, headers, body },
                this.credentials
            );
            const req = https.request({ ...signed, hostname: this.host }, resolve);
            req.on('error', reject);
            if (Buffer.isBuffer(body)) req.end(body);
            else req.end();
        });
    }

    async _requestBuffered(args) {
        const res = await this._request(args);
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 300 && res.statusCode !== 404) {
            throw new Error(
                `R2 ${args.method} ${args.objectKey || '(bucket)'} failed: HTTP ${res.statusCode} ${body.slice(0, 300)}`
            );
        }
        return { statusCode: res.statusCode, headers: res.headers, body };
    }

    /**
     * @param {string} key @param {number} partNumber @param {Buffer} buffer
     * @returns {Promise<{ size: number }>}
     */
    async putPart(key, partNumber, buffer) {
        await this._requestBuffered({
            method: 'PUT',
            objectKey: this._partObjectKey(key, partNumber),
            headers: { 'Content-Length': String(buffer.length) },
            body: buffer,
        });
        return { size: buffer.length };
    }

    /**
     * @param {string} key
     * @returns {Promise<Array<{ partNumber: number, size: number }>>}
     */
    async listParts(key) {
        const prefix = `${key}/part-`;
        const { body } = await this._requestBuffered({
            method: 'GET',
            bucketLevel: true,
            query: `list-type=2&prefix=${encodeURIComponent(prefix)}`,
        });
        const parts = [];
        const contentRe = /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
        let m = contentRe.exec(body);
        while (m) {
            const objectKey = m[1];
            const partNumMatch = /part-(\d+)$/.exec(objectKey);
            if (partNumMatch) parts.push({ partNumber: Number(partNumMatch[1]), size: Number(m[2]) });
            m = contentRe.exec(body);
        }
        return parts.sort((a, b) => a.partNumber - b.partNumber);
    }

    /**
     * @param {string} key @param {number} partNumber
     * @returns {Promise<import('http').IncomingMessage>}
     */
    async getPartStream(key, partNumber) {
        const res = await this._request({ method: 'GET', objectKey: this._partObjectKey(key, partNumber) });
        if (res.statusCode >= 300) {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            throw new Error(
                `R2 getPartStream failed: HTTP ${res.statusCode} ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`
            );
        }
        return res;
    }

    /** @param {string} key */
    async deleteAll(key) {
        const parts = await this.listParts(key);
        // R2/S3 don't support prefix delete directly; batch via DeleteObjects (POST ?delete)
        // would cut round-trips, but per-object DELETE keeps this implementation simple and
        // correct for the expected part counts (a 2 GiB transfer at an 8 MiB chunk size is
        // only ~256 parts). Revisit if cleanup-job latency becomes a problem in production.
        for (const part of parts) {
            // eslint-disable-next-line no-await-in-loop -- sequential deletes, simplicity over throughput
            await this._requestBuffered({ method: 'DELETE', objectKey: this._partObjectKey(key, part.partNumber) });
        }
    }

    /** @param {string} key @returns {Promise<number>} */
    async totalSize(key) {
        const parts = await this.listParts(key);
        return parts.reduce((sum, p) => sum + p.size, 0);
    }

    /** @param {string} key @returns {Promise<boolean>} */
    async exists(key) {
        return (await this.listParts(key)).length > 0;
    }
}

module.exports = R2Storage;
