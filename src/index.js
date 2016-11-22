// TODO: Allow a user to add/edit in one step.

'use strict';

const R = require('ramda');
const cp = require('child_process');
const fs = require('fs');
const inquirer = require('inquirer');
const jcrypt = require('jcrypt');
const path = require('path');
const util = require('./util');

const env = process.env;
const stymieDir = `${env.STYMIE_FS || env.HOME}/.stymie_fs.d`;
const filedir = `${stymieDir}/s`;
const keyFile = `${stymieDir}/f`;
const logError = util.logError;
const logInfo = util.logInfo;
const logSuccess = util.logSuccess;

function openEditor(file, callback) {
    const editor = env.EDITOR || 'vim';
    const editorArgs = require(`${path.dirname(__filename)}/../editors/${editor}`);

    // The editor modules will only contain the CLI args so we need to push on the filename.
    editorArgs.push(file);

    cp.spawn(editor, editorArgs, {
        stdio: 'inherit'
    }).on('exit', callback);
}

const file = {
    add: key => {
        if (!key) {
            logError('Must supply a file name');
            return;
        }

        const newKey = util.stripBeginningSlash(key);
        const hashedFilename = util.hashFilename(newKey);
        const writeKeyToFS = util.writeFile(`${filedir}/${hashedFilename}`);
        const writeNewKeyToList = util.writeKeyToList(newKey);
        const writeNewKeyDirs = util.writeDirsToKeyList(newKey);

        const writeDirsToKeyList = R.composeP(
            R.compose(util.encryptAndWriteKeyFile, writeNewKeyDirs),
            util.getKeyList
        );

        // Steps:
        //      1. Encrypt the new key name and write it to the filesystem.
        //      2. Open the key list and return the parsed JSON.
        //      3. Write the new keys to the key list, encrypt it and write it to the keyfile.
        const writeKeyToList = R.composeP(
            R.compose(util.encryptAndWriteKeyFile, writeNewKeyToList),
            util.getKeyList,
            R.composeP(writeKeyToFS, util.encrypt)
        );

        // Creating an already-existing dir doesn't throw, but maybe clean this up.
        if (/\/$/.test(newKey)) {
            writeDirsToKeyList()
            .then(() => logSuccess('Operation successful'));
        } else {
            // This seems counter-intuitive because the resolve and reject operations are reversed, but this is b/c
            // the success case is when the file does not exist (and thus will throw an exception).
            util.fileExists(`${filedir}/${hashedFilename}`)
            .then(() => logError('File already exists'))
            .catch(() =>
                writeKeyToList(newKey)
                .then(() => logSuccess('File created successfully'))
                .catch(logError)
            );
        }
    },

    get: key => {
        const keyPath = `${filedir}/${util.hashFilename(key)}`;

        util.fileExists(keyPath).then(() =>
            jcrypt.decryptToFile(keyPath, null)
            .then(() =>
                openEditor(keyPath, () =>
                    // Re-encrypt once done.
                    util.encryptToFile(keyPath, null)
                    .then(() => logInfo('Re-encrypting and closing the file'))
                    .catch(logError)
                )
            )
            .catch(logError)
        )
        .catch(logError);
    },

    has: key => {
        if (!key) {
            logError('Must supply a file name');
            return;
        }

        util.getKeyList()
        .then(list => {
            const [obj] = util.walkObject(list, util.getDotNotation(key));

            if (obj) {
                logInfo('File exists');
            } else {
                logInfo('Nothing to do!');
            }
        })
        .catch(logError);
    },

    // TODO
//    import: (src, dest) => {
    import: src => {
        if (!src) {
            logError('Must supply a file name');
            return;
        }

        Promise.all([
            util.encryptToFile(src, `${filedir}/${util.hashFilename(src)}`),
            (() =>
                util.getKeyList()
                .then(util.writeKeyToList(src))
                .then(util.encryptAndWriteKeyFile())
            )()
        ])
        .then(logSuccess)
        .catch(logError);
    },

    list: start =>
        util.getKeyList()
        .then(list => {
            let base = null;

            if (!start) {
                base = list;
            } else {
                const [obj, prop] = util.walkObject(
                    list,
                    util.getDotNotation(start)
                );

                base = obj[prop];
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

                logInfo(
                    entries.length ?
                        `Installed files: \n${entries.join('\n')}` :
                        'No files'
                );
            } else {
                logError('There was a TypeError attempting to parse the tree object. Bad object lookup?');
            }
        })
        .catch(logError),

    mv: (() => {
        const rename = R.curry((src, dest, oldFilename, list) => {
            const strippedSrc = util.stripAnchorSlashes(src);
            const strippedDest = util.stripAnchorSlashes(dest);

            const [srcOwner, srcProp, srcObj] = util.walkObject(list, strippedSrc.replace(/\//g, '.'));
            const [destOwner, destProp, destObj] = util.walkObject(list, strippedDest.replace(/\//g, '.'));
            const isDir = util.isDir(destObj);

            let newFilename;

//            console.log('srcOwner', srcOwner);
//            console.log('srcProp', srcProp);
//            console.log('srcObj', srcObj);
//
//            console.log('destOwner', destOwner);
//            console.log('destProp', destProp);
//            console.log('destObj', destObj);

            if (isDir) {
                const tmpName = `${strippedDest}/${srcProp}`;
                newFilename = `${filedir}/${util.hashFilename(tmpName)}`;

            } else if (!~dest.slice(1).indexOf('/')) {
                // If no slash (/) occurs in the string or if the only presence of a slash is the first char then GO.
                newFilename = `${filedir}/${util.hashFilename(destProp)}`;
            } else {
                return 'Nothing to do!';
            }

            return new Promise((resolve, reject) =>
                fs.rename(oldFilename, newFilename, err => {
                    if (err) {
                        return 'Error!';
                    } else {
                        // Update the keyfile.
                        delete srcOwner[srcProp];

                        if (isDir) {
                            destObj[srcProp] = true;
                        } else {
                            list[destProp] = true;
                        }

                        return util.encryptAndWriteKeyFile(list)
                        .then(() => resolve(`Successfully moved ${src} to ${dest}`))
                        .catch(reject);
                    }
                })
            );
        });

        return (src, dest) => {
            if (!src || !dest) {
                logError('Must supply both a src name and a dest name');
                return ;
            }

            const oldFilename = `${filedir}/${util.hashFilename(src)}`;
            util.fileExists(oldFilename)
            .then(() =>
                util.getKeyList()
                .then(rename(src, dest, oldFilename))
                .catch(logError)
            )
            .then(logInfo)
            .catch(logError);
        };
    })(),

    rm: key =>
        util.getKeyList()
        .then(list => {
            const [obj, prop] = util.walkObject(list, util.getDotNotation(key));

            if (obj) {
                const f = obj[prop];

                if (util.isFile(f) || util.isEmpty(f)) {
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

                            util.encryptAndWriteKeyFile(list)
                            .then(() => {
                                logSuccess('Key removed successfully');

                                const hashedFilename = util.hashFilename(key);

                                if (util.isFile(f)) {
                                    util.removeFile(`${filedir}/${hashedFilename}`);
                                }
                            })
                            .catch(logError);
                        } else {
                            logInfo('No removal');
                        }
                    });
                } else {
                    util.logWarn(`No removal, \`${key}\` is a (non-empty) directory`);
                }
            } else {
                logInfo('Nothing to do!');
            }
        })
        .catch(logError),

    rmDir: dir => {
        if (!dir) {
            logError('Must supply a directory name');
            return;
        }

        util.getKeyList()
        .then(list => {
            const [obj, prop] = util.walkObject(
                list,
                dir.replace(/^\/|\/$/g, '').replace(/\//g, '.')
            );

            if (!obj || !obj[prop]) {
                return 'No such thing';
            } else {
                if (!Object.keys(obj[prop]).length) {
                    delete obj[prop];

                    return util.encryptAndWriteKeyFile(list)
                    .then(() => 'Key removed successfully')
                    .catch(logError);
                } else {
                    return `Directory ${prop} is not empty`;
                }
            }
        })
        .then(logInfo)
        .catch(logError);
    }
};

module.exports = file;

