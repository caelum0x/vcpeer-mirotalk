'use strict';

/**
 * Executable file-type blocklist for VCPeer Send's "Send by email" delivery
 * mode only (per the brief — "Get a link" mode doesn't block any type, same
 * as WeTransfer). Extension-based; filenames are attacker-controlled input,
 * so this is a basic spam/malware-delivery speed bump, not a security
 * boundary — real protection is the sender-email verification code plus
 * normal mail-provider scanning on the recipient side.
 */
const BLOCKED_EXTENSIONS = new Set([
    '.exe',
    '.bat',
    '.cmd',
    '.com',
    '.scr',
    '.msi',
    '.msp',
    '.msc',
    '.vbs',
    '.vbe',
    '.ps1',
    '.ps1xml',
    '.psc1',
    '.jar',
    '.pif',
    '.cpl',
    '.dll',
    '.wsf',
    '.wsh',
    '.hta',
    '.lnk',
    '.scf',
    '.reg',
    '.sh',
    '.bash',
    '.command',
]);

/**
 * @param {string} filename
 * @returns {boolean} true if this filename's extension is blocked for email delivery
 */
function isBlockedFileType(filename) {
    if (typeof filename !== 'string') return false;
    const match = /\.[^.]+$/.exec(filename.trim().toLowerCase());
    if (!match) return false;
    return BLOCKED_EXTENSIONS.has(match[0]);
}

module.exports = { BLOCKED_EXTENSIONS, isBlockedFileType };
