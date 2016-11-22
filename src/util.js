'use strict';

let hash = null;

const R = require('ramda');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const jcrypt = require('jcrypt');
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

const env = process.env;
const stymieDir = `${env.STYMIE_FS || env.HOME}/.stymie_fs.d`;
const configFile = `${stymieDir}/c`;
const keyFile = `${stymieDir}/f`;
const reAnchors = /^\/|\/$/g;
const reBeginningSlash = /^\//;
const reSwapChars = /\//g;

const createDirEntries = (list, it) => {
    let l = list;

    for (let dir of it) {
        if (!l[dir]) {
            l[dir] = {};
        }

        l = l[dir];
    }

    return list;
};

const fileExists = path =>
    new Promise((resolve, reject) =>
        fs.stat(path, err => {
            if (err) {
                reject('No matching entry');
            } else {
                resolve(path);
            }
        })
    );

// Turns strings passed by the CLI into dot notation used by #walkObject for object lookups.
//
//      `/notes/fp/curry` -> `notes.fp.curry`
//
const getDotNotation = filename =>
    filename.replace(reAnchors, '').replace(reSwapChars, '.');

const getKeyList = () =>
    jcrypt.decryptFile(keyFile)
    .then(JSON.parse);

const hashFilename = file => {
    if (!file) {
        return;
    }

    return crypto.createHash(hash).update(
        stripBeginningSlash(file)
    ).digest('hex');
};

// Note: "directories" are objects in the keyfile.
const isDir = f => f && f !== true;

const isEmpty = f => isDir(f) && !Object.keys(f).length;

// Note: "files" are object properties with a value of true.
const isFile = f => f === true;

const makeArrayOfDirs = key =>
    key.replace(reAnchors, '').split('/');

const removeFile = file =>
    new Promise((resolve, reject) =>
        which('shred', err => {
            let isNotFound = err && err.message && ~err.message.toLowerCase().indexOf('not found');
            let rm;

            if (isNotFound) {
                util.logInfo('Your OS doesn\`t have the `shred` utility installed, falling back to `rm`...');
                rm = cp.spawn('rm', [file]);
            } else {
                rm = cp.spawn('shred', ['--zero', '--remove', file]);
            }

            rm.on('close', code => {
                if (code !== 0) {
                    reject(`Something terrible happened! Error code: ${code}`);
                } else {
                    resolve('File removed successfully');
                }
            });
        })
    );

const setFP = gpgOptions => {
    // Curry.
    util.encrypt = jcrypt.encrypt(gpgOptions);
    util.encryptToFile = jcrypt.encryptToFile(gpgOptions);

    util.encryptAndWriteConfigFile = R.compose(
        R.composeP(writeConfigFile, util.encrypt),
        stringifyKeyFile
    );

    util.encryptAndWriteKeyFile = R.compose(
        R.composeP(writeKeyFile, util.encrypt),
        stringifyKeyFile
    );
};

const setGPGOptions = options => {
    hash = options.hash;

    const gpgOptions = [
        '--hidden-recipient', options.recipient
    ];

    if (options.armor) {
        gpgOptions.push('--armor');
    }

    if (options.sign) {
        gpgOptions.push('--sign');
    }

    setFP(gpgOptions);
};

const stringifyKeyFile = list =>
    JSON.stringify(list, null, 4);

const stripAnchorSlashes = filename =>
    filename.replace(reAnchors, '');

const stripBeginningSlash = filename =>
    filename.replace(reBeginningSlash, '');

// Returns object, property and value (if found).
const walkObject = R.curry((str, o) => {
    const idx = str.indexOf('.');

    if (!~idx) {
        const notFound = (!o || !o[str]);

        return [
            notFound ?
                null :
                o,
            str,
            notFound ?
                null :
                o[str]
        ];
    }

    // If fn is called with foo object and 'bar.baz.quux', recurse, i.e.:
    //
    //      const foo = {
    //          bar: {
    //              baz: {
    //                  quux: true
    //              },
    //              derp: {
    //                  herp: 5
    //              }
    //          }
    //      };
    //
    //  Example:
    //
    //      walkObject('bar.baz.quux', foo);
    //      // returns [{ quux: true }, 'quux', true]
    //
    //      Stack...
    //      fn(o['baz'], 'quux');
    //      fn(o['bar'], 'baz.quux');
    //      fn(o['foo'], 'bar.baz.quux');
    //
    //  Example:
    //
    //      walkObject('bar.derp', foo);
    //      // returns [{ baz: ..., derp: ... }, 'derp', { herp: 5 }]
    //
    //      Stack...
    //      fn(o['bar'], 'derp');
    //      fn(o['foo'], 'bar.derp');
    //
    return walkObject(str.slice(idx + 1), o[str.slice(0, idx)]);
});

const writeDirsToKeyList = R.curry((key, list) => createDirEntries(list, makeArrayOfDirs(key)));

const writeFile = R.curry((dest, enciphered) =>
    new Promise((resolve, reject) =>
        fs.writeFile(dest, enciphered, defaultWriteOptions, err => {
            if (err) {
                reject(err);
            } else {
                resolve(dest);
            }
        })
    ));

const writeConfigFile = writeFile(configFile);
const writeKeyFile = writeFile(keyFile);

const writeKeyToList = R.curry((key, list) => {
    if (~key.indexOf('/')) {
        const dirname = path.dirname(key);
        writeDirsToKeyList(dirname, list);

        // Now write the file into the last object.
        makeArrayOfDirs(dirname).reduce(
            (acc, curr) => (acc = acc[curr], acc), list
        )[path.basename(key)] = true;
    } else {
        list[key] = true;
    }

    return list;
});

const util = {
    log: logger.log,
    logError: logger.error,
    logInfo: logger.info,
    logRaw: logger.raw,
    logSuccess: logger.success,
    logWarn: logger.warn,

    // Will be defined in #setGPGOptions.
    encrypt: null,
    encryptToFile: null,
    encryptAndWriteConfigFile: null,
    encryptAndWriteKeyFile: null,

    fileExists,
    getDotNotation,
    getKeyList,
    hashFilename,
    isDir,
    isEmpty,
    isFile,
    removeFile,
    setGPGOptions,
    stringifyKeyFile,
    stripAnchorSlashes,
    stripBeginningSlash,
    walkObject,
    writeDirsToKeyList,
    writeConfigFile,
    writeFile,
    writeKeyFile,
    writeKeyToList
};

module.exports = util;

