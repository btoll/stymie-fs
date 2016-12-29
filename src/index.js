// TODO: Allow a user to add/edit in one step.

'use strict';

const R = require('ramda');
const cp = require('child_process');
const inquirer = require('inquirer');
const jcrypt = require('jcrypt');
const path = require('path');
const util = require('./util');

const filedir = `${util.getStymieDir()}/s`;
const logInfo = util.logInfo;
const reIsDir = /\/$/;
const reIsRoot = /^(?:\/|\.)$/;
const reGetRootName = /^\/?(\w*)/;

const _export = f => {
    if (!f) {
        return Promise.reject('Must supply a file name');
    }
};

const _import = (src, dest) => {
    if (!src) {
        return Promise.reject('Must supply a file name');
    }

    util.fileExists(src)
    .then(util.getKeyList)
    .then(util.walkObject(util.getDotNotation(dest)))
    .then(walkedObject => {
        const [, , value] = walkedObject;

        if (value !== null) {
            const key = `${util.stripAnchorSlashes(dest)}/${path.basename(src)}`;

            return Promise.all([
                util.encryptToFile(`${filedir}/${util.hashFilename(key)}`, src),
                // TODO
                (() =>
                    util.getKeyList()
                    .then(util.writeKeyToList(key))
                    .then(util.encryptKeyDataToFile)
                )()
            ])
            .then(() => `Successfully imported ${src} into ${dest}`);
        } else {
            return `${dest} is not a valid path`;
        }
    })
    .then(logInfo);

};

const add = key => {
    if (!key) {
        return Promise.reject('Must supply a file name');
    }

    const newKey = util.stripBeginningSlash(key);
    const writeKeyToFS = util.writeFile(`${filedir}/${util.hashFilename(newKey)}`);
    const writeNewKeyToList = util.writeKeyToList(newKey);
    const writeNewKeyDirs = util.writeDirsToKeyList(newKey);

    const writeDirsToKeyList = R.composeP(
        R.compose(util.encryptKeyDataToFile, writeNewKeyDirs),
        util.getKeyList
    );

    // Steps:
    //      1. Encrypt the new key name and write it to the filesystem.
    //      2. Open the key list and return the parsed JSON.
    //      3. Write the new keys to the key list, encrypt it and write it to the keyfile.
    const writeKeyToList = R.composeP(
        R.compose(util.encryptKeyDataToFile, writeNewKeyToList),
        util.getKeyList,
        R.composeP(writeKeyToFS, util.encrypt)
    );

    // Creating an already-existing dir doesn't throw, but maybe clean this up.
    if (reIsDir.test(newKey)) {
        return writeDirsToKeyList();
    } else {
        // This seems counter-intuitive because the resolve and reject operations are reversed, but this is b/c
        // the success case is when the file does not exist (and thus will throw an exception).
        return util.getKeyList()
        .then(list => {
            const [obj] = util.walkObject(util.getDotNotation(key), list);

            if (!obj) {
                return writeKeyToList(newKey);
            } else {
                return Promise.reject('Nothing to do here!');
            }
        });
    }
};

const cat = key => {
    if (!util.isDir(key)) {
        return Promise.reject('Nothing to do here!');
    }

    return has(key)
    .then(([, filehash]) =>
        jcrypt.decryptFile(`${filedir}/${filehash}`)
    );
};

const get = key =>
    util.getKeyList()
    .then(list => {
        // Only get the extname (and treat the key as a path) if there are `/` delimiters!
        //
        // Only use the dirname to walk the object. This allows for using dotNotation to tokenize
        // the object hierarchy and at the same time getting files like `binary.js`.
        const [k, extname] = ~key.indexOf('/') ?
            [path.dirname(key), path.extname(key)] :
            [key, null];

        let [obj, prop, hash] = util.walkObject(util.getDotNotation(k), list);

        if (extname) {
            // For example:
            //      prop = 'binary_search'
            //      path.basename(key) = 'binary.js'
            //
            //          dirObj['binary_search']['binary.js']
            //
            hash = obj[prop][path.basename(key)];
        }

        if (!hash) {
            return Promise.reject('Nothing to do here!');
        } else {
            const keyPath = `${filedir}/${hash}`;

            return jcrypt.decryptToFile(null, keyPath)
            .then(() =>
                new Promise((resolve, reject) =>
                    openEditor(keyPath, () =>
                        // Re-encrypt once done.
                        util.encryptToFile(null, keyPath)
                        .then(resolve('Re-encrypting and closing the file'))
                        .catch(reject)
                    )
                )
            );
        }
    });

const getKeys = () =>
    util.getKeyList()
    .then(util.stringify);

const has = key => {
    if (!key) {
        return Promise.reject('Must supply a file name');
    }

    return util.getKeyList()
    .then(list => {
        const [, prop, value] = util.walkObject(util.getDotNotation(key), list);

        return !value ?
            Promise.reject('Nothing to do!') :
            [prop, value];
    });
};

const list = start =>
    util.getKeyList()
    .then(list => {
        let base = null;

        if (!start) {
            base = list;
        } else {
            [, , base] = util.walkObject(
                util.getDotNotation(start),
                list
            );
        }

        if (base) {
            const entries = [];

            // List in sorted order.
            for (let entry of Object.keys(base).sort()) {
                // Here all we're doing is adding a trailing '/' if the entry is a dir.
                entries.push(
                    (typeof base[entry] === 'object') ?
                        `${entry}/` :
                        entry
                );
            }

            return entries;
        } else {
            return Promise.reject('There was a TypeError attempting to parse the tree object. Bad object lookup?');
        }
    });

const mv = (src, dest) => {
    if (!src || !dest) {
        return Promise.reject('Must supply both a src name and a dest name');
    }

    const hashedFilename = util.hashFilename(src);
    const oldFilename = `${filedir}/${hashedFilename}`;

    return util.getKeyList()
    .then(list => {
        const [obj] = util.walkObject(util.getDotNotation(src), list);

        // TODO: Errors when filename is a number!
        if (!obj) {
            return Promise.reject('Nothing to do!');
        } else {
            const [srcObj, srcProp, srcValue] = util.walkObject(util.getDotNotation(src), list);
            const [, destProp, destValue] = util.walkObject(util.getDotNotation(dest), list);

            let hashedFilename;
            let newFilename;

            if (util.isDir(srcValue)) {
                return Promise.reject('Nothing to do here! (src can\t be a dir)');
            }

            if (util.isDir(destValue)) {
                hashedFilename = util.hashFilename(
                    `${util.stripAnchorSlashes(dest)}/${srcProp}`
                );

                destValue[srcProp] = hashedFilename;
            } else if (reIsRoot.test(path.dirname(dest))) {
                // Get the new name:
                //      /toasty => toasty
                //      toasty => toasty
                //      / => swap in srcProp
                let name = dest.replace(reGetRootName, '$1');

                if (!name) {
                    name = srcProp;
                }

                // Moving to root dir.
                hashedFilename = list[name] = util.hashFilename(name);
            } else {
                // Redefine the list object to be the destination "dir" object!
                const [, , container] = util.walkObject(util.getDotNotation(path.dirname(dest)), list);

                hashedFilename = util.hashFilename(
                    `${util.stripBeginningSlash(dest)}`
                );

                container[destProp] = hashedFilename;
    //         } else {
    //             return Promise.reject('Nothing to do here!');
            }

            newFilename = `${filedir}/${hashedFilename}`;

            // Update the keyfile.
            delete srcObj[srcProp];

            return util.renameFile(oldFilename, newFilename)
            .then(util.encryptKeyDataToFile(list))
            .then(() => `Successfully moved ${src} to ${dest}`);
        }
    });
};

const openEditor = (file, callback) => {
    const editor = process.env.EDITOR || 'vim';
    const editorArgs = require(`${path.dirname(__filename)}/../editors/${editor}`);

    // The editor modules will only contain the CLI args so we need to push on the filename.
    editorArgs.push(file);

    cp.spawn(editor, editorArgs, {
        stdio: 'inherit'
    }).on('exit', callback);
};

const rm = key =>
    util.getKeyList()
    .then(list => {
        const [obj, prop, value] = util.walkObject(util.getDotNotation(key), list);

        if (value) {
            if (util.isFile(value) || util.isEmpty(value)) {
                return new Promise((resolve, reject) => {
                    inquirer.prompt([{
                        type: 'list',
                        name: 'rm',
                        message: 'Are you sure?',
                        choices: [
                            {name: 'Yes', value: true},
                            {name: 'No', value: false}
                        ]
                    }], answers => {
                        if (answers.rm) {
                            delete obj[prop];

                            util.encryptKeyDataToFile(list)
                            .then(() => {
                                const hashedFilename = util.hashFilename(key);

                                if (util.isFile(value)) {
                                    util.removeFile(`${filedir}/${hashedFilename}`);
                                }

                                resolve('Key removed successfully');
                            })
                            .catch(reject);
                        } else {
                            resolve('No removal');
                        }
                    });
                });
            } else {
                return Promise.reject(`No removal, \`${key}\` is a non-empty directory`);
            }
        } else {
            return Promise.reject('Nothing to do here!');
        }
    });

const rmdir = dir => {
    if (!dir) {
        return Promise.reject('Must supply a directory name');
    }

    return util.getKeyList()
    .then(list => {
        const [obj, prop, value] = util.walkObject(
            dir.replace(/^\/|\/$/g, '').replace(/\//g, '.'),
            list
        );

        if (value === null) {
            return null;
        } else {
            if (!Object.keys(obj[prop]).length) {
                delete obj[prop];

                return util.encryptKeyDataToFile(list);
            } else {
                return Promise.reject(`Directory ${prop} is not empty`);
            }
        }
    });
};

module.exports = {
    _export,
    _import,
    add,
    cat,
    get,
    getKeys,
    has,
    ls: list,
    list,
    mv,
    rm,
    rmdir
};

