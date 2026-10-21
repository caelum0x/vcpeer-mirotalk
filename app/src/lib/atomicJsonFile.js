'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Atomically overwrites a JSON file: write to a uniquely-named temp file in
 * the same directory, then `rename()` over the real path.
 *
 * notify.js and launchboard.js each keep their entire dataset (every signup /
 * every listing) as one JSON array in a single shared file, rewritten on
 * every submission. A bare `fs.writeFileSync(path, ...)` on that file has no
 * atomicity guarantee: if the process is killed mid-write (OOM kill on the
 * production box's 956MB budget, SIGKILL, power loss), the file can be left
 * truncated or holding invalid JSON — which loses every record ever
 * collected, not just the one being written.
 *
 * `rename()` on the same filesystem is atomic, so a crash can only ever
 * leave either the old complete file or the new complete file, never a
 * partial one. This is the same pattern clipStore.js and transferStore.js
 * already use per-record; this module exists so notify.js/launchboard.js's
 * single-shared-array files get the identical guarantee instead of a weaker,
 * inconsistent one.
 *
 * @param {string} filePath
 * @param {unknown} data JSON-serializable value
 */
function writeJsonFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(
        dir,
        `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
}

module.exports = { writeJsonFileAtomic };
