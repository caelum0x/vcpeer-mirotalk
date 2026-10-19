'use strict';

// npx mocha tests/test-fileTypeBlocklist.js

require('should');
const { isBlockedFileType } = require('../app/src/transfers/fileTypeBlocklist');

describe('test-fileTypeBlocklist', () => {
    it('blocks common executable extensions', () => {
        ['virus.exe', 'INSTALLER.MSI', 'script.ps1', 'macro.vbs', 'app.jar', 'run.sh'].forEach((name) => {
            isBlockedFileType(name).should.be.true();
        });
    });

    it('allows ordinary document/media/archive types', () => {
        ['report.pdf', 'photo.jpg', 'archive.zip', 'notes.txt', 'video.mp4', 'data.csv'].forEach((name) => {
            isBlockedFileType(name).should.be.false();
        });
    });

    it('is case-insensitive', () => {
        isBlockedFileType('Virus.EXE').should.be.true();
    });

    it('handles filenames with no extension', () => {
        isBlockedFileType('README').should.be.false();
    });

    it('handles filenames with multiple dots (checks the last extension)', () => {
        isBlockedFileType('archive.tar.gz').should.be.false();
        isBlockedFileType('installer.tar.exe').should.be.true();
    });

    it('returns false for non-string input', () => {
        isBlockedFileType(null).should.be.false();
        isBlockedFileType(undefined).should.be.false();
    });
});
