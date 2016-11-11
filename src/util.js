'use strict';

const R = require('ramda');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const logger = require('logger');
const path = require('path');
const which = require('which');

const defaultWriteOptions = {
    defaultEncoding: 'utf8',
    encoding: 'utf8',
    fd: null,
    flags: 'w',
    mode: 0o0600
};

let gpgOptions = {};

const util = {
    log: logger.log,
    logError: logger.error,
    logInfo: logger.logInfo,
    logRaw: logger.raw,
    logSuccess: logger.success,
    logWarn: logger.warn,

    fileExists: path =>
        new Promise((resolve, reject) =>
            fs.stat(path, err => {
                if (err) {
                    reject('No matching entry');
                } else {
                    resolve(path);
                }
            })
        ),

    getGPGArgs: () => {
        let arr = ['-r', gpgOptions.recipient];

        if (gpgOptions.armor) {
            arr.push('--armor');
        }

        if (gpgOptions.sign) {
            arr.push('--sign');
        }

        return arr;
    },

    getDefaultFileOptions: () => {
        return {
            flags: 'w',
            defaultEncoding: 'utf8',
            fd: null,
            mode: 0o0600
        };
    },

    hashFilename: file => {
        if (!file) {
            return;
        }

        return crypto.createHash(gpgOptions.hash).update(file).digest('hex');
    },

    makeListOfDirs: dirname => dirname.replace(/^\/|\/$/g, '').split('/'),

    removeFile: file =>
        new Promise((resolve, reject) =>
            which('shred', err => {
                let isNotFound = err && err.message && ~err.message.toLowerCase().indexOf('not found');
                let rm;

                if (isNotFound) {
                    util.log('Your OS doesn\`t have the `shred` utility installed, falling back to `rm`...');
                    rm = cp.spawn('rm', [file]);
                } else {
                    rm = cp.spawn('shred', ['--zero', '--remove', file]);
                }

                rm.on('close', code => {
                    if (code !== 0) {
                        reject('Something terrible happened!');
                    } else {
                        resolve('File removed successfully');
                    }
                });
            })
        ),

    setGPGOptions: data => gpgOptions = JSON.parse(data),

    stripBeginningSlash: filename => filename.replace(/^\//, ''),

    walkObject: (o, str) => {
        const idx = str.indexOf('.');

        if (!~idx) {
            return !o ? [null, str] : [o, str];
        }

        // If fn is called with foo object and 'bar.baz.quux', recurse, i.e.:
        //
        //      const foo = {
        //          bar: {
        //              baz: {
        //                  quux: true
        //              }
        //          }
        //      };
        //
        //      walkObject(foo, 'bar.baz.quux');
        //      // returns [{ quux: true }, 'quux']
        //
        //      Stack...
        //      fn(o['baz'], 'quux');
        //      fn(o['bar'], 'baz.quux');
        //      fn(o['foo'], 'bar.baz.quux');
        //
        return util.walkObject(o[str.slice(0, idx)], str.slice(idx + 1));
    },

    writeDirs: (list, it) => {
        let l = list;

        for (let dir of it) {
            if (!l[dir]) {
                l[dir] = {};
            }

            l = l[dir];
        }

        return list;
    },

    writeDirsToTreeFile: R.curry((dirname, list) => util.writeDirs(list, util.makeListOfDirs(dirname))),

    // TODO: (writeOptions = defaultWriteOptions, dest, data)
    writeFile: R.curry((writeOptions, dest, enciphered) =>
        new Promise((resolve, reject) =>
            fs.writeFile(dest, enciphered, writeOptions || defaultWriteOptions, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve(dest);
                }
            })
        )),

    writeKeyToTreeFile: R.curry((key, list) => {
        const dirname = path.dirname(key);
//        const hashedFilename = util.hashFilename(path.basename(key));

        if (dirname !== '.') {
            util.writeDirsToTreeFile(dirname, list);

            // Now write the file into the last object.
            util.makeListOfDirs(dirname).reduce(
                (acc, curr) => (acc = acc[curr], acc), list
//            )[hashedFilename] = path.basename(key);
            )[path.basename(key)] = true;
        } else {
//            list[hashedFilename] = path.basename(key);
            list[path.basename(key)] = true;
        }

        return list;
    })
};

module.exports = util;

