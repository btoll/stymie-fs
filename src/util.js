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
const reBeginningSlash = /^\//;
const reRemoveAnchors = /^\/|\/$/g;
const reRemoveSlashes = /\//g;

const strip = R.curry((re, replacement, str) =>
    str.replace(re, replacement));

const replaceWithPeriods = strip(reRemoveSlashes, '.');
const stripAnchorSlashes = strip(reRemoveAnchors, '');
const stripBeginningSlash = strip(reBeginningSlash, '');

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
const getDotNotation = R.compose(
    replaceWithPeriods,
    stripAnchorSlashes
);

const getFileInfo = (list, key) => {
    const extname = path.extname(key);

    // Only use the extname (and treat the key as a path) if there are `/`s and the extname exists!
    const [k, ext] = ~key.indexOf('/') && extname ?
        // Only use the dirname to walk the object. This allows for using dotNotation to tokenize
        // the object hierarchy and at the same time getting files like `binary.js`.
        [path.dirname(key), extname] :
        [key, null];

    let [obj, prop, hash] = walkObject(getDotNotation(k), list);

    if (ext) {
        // For example:
        //      prop = 'binary_search'
        //      path.basename(key) = 'binary.js'
        //
        //          dirObj['binary_search']['binary.js']
        //
        hash = obj[prop][path.basename(key)];
    }

    return [obj, prop, hash];
};

const getKeyList = () =>
    jcrypt.decryptFile(keyFile)
    .then(JSON.parse);

const getStymieDir = () =>
    stymieDir;

const hashFilename = file => {
    if (!file) {
        return;
    }

    return crypto.createHash(hash).update(
        stripBeginningSlash(file)
    ).digest('hex');
};

// Note: "directories" are objects in the keyfile.
const isDir = f =>
    f && (typeof f === 'object');

const isEmpty = f =>
    isDir(f) && !Object.keys(f).length;

// Note: "files" are object properties with a hashed value of its filename.
const isFile = f =>
    !isDir(f);

const makeArrayOfDirs = R.compose(
    R.split('/'),
    stripAnchorSlashes
);

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

const renameFile = (oldFilename, newFilename) =>
    new Promise((resolve, reject) =>
        fs.rename(oldFilename, newFilename, err => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        })
    );

const setFP = gpgOptions => {
    // Curry.
    util.encrypt = jcrypt.encrypt(gpgOptions);
    util.encryptToFile = jcrypt.encryptToFile(gpgOptions);

    util.encryptConfigDataToFile = R.compose(
        jcrypt.encryptDataToFile(gpgOptions, configFile),
        stringify
    );

    util.encryptKeyDataToFile = R.compose(
        jcrypt.encryptDataToFile(gpgOptions, keyFile),
        stringify
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

const stringify = data =>
    JSON.stringify(data, null, 4);

// Returns object, property and value (if found).
const walkObject = R.curry((str, obj) => {
    const idx = str.indexOf('.');

    if (!~idx || !obj) {
        const notFound = (!obj || !obj[str]);

        return [
            notFound ?
                null :
                obj,
            str,
            notFound ?
                null :
                obj[str]
        ];
    }

    // If fn is called with foo object and 'bar.baz.quux', recurse, i.e.:
    //
    //      const foo = {
    //          bar: {
    //              baz: {
    //                  quux: {hash}
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
    //      // returns [{ quux: {hash} }, 'quux', {hash}]
    //
    //      Stack...
    //      fn(obj['baz'], 'quux');
    //      fn(obj['bar'], 'baz.quux');
    //      fn(obj['foo'], 'bar.baz.quux');
    //
    //  Example:
    //
    //      walkObject('bar.derp', foo);
    //      // returns [{ baz: ..., derp: ... }, 'derp', { herp: 5 }]
    //
    //      Stack...
    //      fn(obj['bar'], 'derp');
    //      fn(obj['foo'], 'bar.derp');
    //
    return walkObject(str.slice(idx + 1), obj[str.slice(0, idx)]);
});

const writeDirsToKeyList = R.curry((key, list) =>
    createDirEntries(list, makeArrayOfDirs(key)));

// const setFileType = dest => {
//     const extname = path.extname(dest);

//     if (extname === '' || extname === '.txt') {
//        return '/* vim: set filetype=txt : */';
//     }
// };

const writeFile = R.curry((dest, enciphered) =>
    new Promise((resolve, reject) =>
//         fs.writeFile(dest, setFileType(dest) || enciphered, defaultWriteOptions, err => {
        fs.writeFile(dest, enciphered, defaultWriteOptions, err => {
            if (err) {
                reject(err);
            } else {
                resolve(dest);
            }
        })
    ));

const writeKeyToList = R.curry((key, list) => {
    if (~key.indexOf('/')) {
        const dirname = path.dirname(key);
        writeDirsToKeyList(dirname, list);

        // Now write the file into the last object.
        makeArrayOfDirs(dirname).reduce(
            (acc, curr) => (acc = acc[curr], acc), list
        )[path.basename(key)] = hashFilename(key);
    } else {
        list[key] = hashFilename(key);
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
    encryptConfigDataToFile: null,
    encryptKeyDataToFile: null,

    fileExists,
    getDotNotation,
    getFileInfo,
    getKeyList,
    getStymieDir,
    hashFilename,
    isDir,
    isEmpty,
    isFile,
    removeFile,
    renameFile,
    setGPGOptions,
    stringify,
    stripAnchorSlashes,
    stripBeginningSlash,
    walkObject,
    writeDirsToKeyList,
    writeFile,
    writeKeyToList
};

module.exports = util;

