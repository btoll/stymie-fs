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
const treeFile = `${stymieDir}/f`;
const logError = util.logError;
const logInfo = util.log;
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

        const defaultFileOptions = util.getDefaultFileOptions();
        const gpgArgs = util.getGPGArgs();
        const hashedFilename = util.hashFilename(newKey);

        const writeKeyFile = util.writeFile(defaultFileOptions, `${filedir}/${hashedFilename}`);
        const writeTreeFile = util.writeFile(defaultFileOptions, treeFile);

        const stringifyTreeFile = data => JSON.stringify(data, null, 4);
        const writeDirsToTreeFile = util.writeDirsToTreeFile(newKey);
        const writeKeyToTreeFile = util.writeKeyToTreeFile(newKey);
        const encryptData = jcrypt.encrypt(gpgArgs);

        const foo = fn =>
            R.composeP(
                R.composeP(
                    writeTreeFile,
                    // Now that the new file has been added we need to record it in the "treefile"
                    // in order to do lookups.
                    R.compose(encryptData, stringifyTreeFile, fn, JSON.parse),
                    jcrypt.decryptFile
                )
            );

        // Creating an already-existing dir doesn't throw, but maybe clean this up.
        if (/\/$/.test(newKey)) {
            foo(writeDirsToTreeFile)(treeFile)
            .then(logSuccess);
        } else {
            // This seems counter-intuitive because the resolve and reject operations
            // are reversed, but this is b/c the success case is when the file does not
            // exist (and thus will throw an exception).
            util.fileExists(`${filedir}/${hashedFilename}`)
            .then(() => logError('File already exists'))
            .catch(() =>
                encryptData(newKey)
                .then(writeKeyFile)
                .then(() => foo(writeKeyToTreeFile)(treeFile))
                .then(() => logSuccess('File created successfully'))
                .catch(logError)
            );
        }
    },

    get: key => {
        const keyPath = `${filedir}/${util.hashFilename(key)}`;

        util.fileExists(keyPath).then(() =>
            jcrypt.decryptToFile(keyPath)
            .then(() => {
                openEditor(keyPath, () =>
                    // Re-encrypt once done.
                    jcrypt.encryptToFile(keyPath, null, util.getGPGArgs(), util.getDefaultFileOptions())
                    .then(() => logInfo('Re-encrypting and closing the file'))
                    .catch(logError)
                );
            })
            .catch(logError)
        )
        .catch(logError);
    },

    has: key => {
        if (!key) {
            logError('Must supply a file name');
            return;
        }

        util.fileExists(`${filedir}/${util.hashFilename(key)}`)
        .then(() => logSuccess('File exists'))
        .catch(logError);
    },

//    import: (src, dest) => {
    import: src => {
        if (!src) {
            logError('Must supply a file name');
            return;
        }

        Promise.all([
            jcrypt.encryptToFile(src, `${filedir}/${util.hashFilename(src)}`, util.getGPGArgs(), util.getDefaultFileOptions()),
            (() =>
                jcrypt.decryptFile(treeFile)
                .then(data => util.writeKeyToTreeFile(src, JSON.parse(data)))
                .then(list => jcrypt.encrypt(util.getGPGArgs(), JSON.stringify(list, null, 4)))
                .then(util.writeFile(util.getDefaultFileOptions(), treeFile))
            )()
        ])
        .then(logSuccess)
        .catch(logError);
    },

    list: start =>
        jcrypt.decryptFile(treeFile)
        .then(data => {
            let base = null;
            let list = JSON.parse(data);

            if (!start) {
                base = list;
            } else {
                const [obj, prop] = util.walkObject(
                    list,
                    start.replace(/^\/|\/$/g, '').replace(/\//g, '.')
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
        const rename = (list, src, dest, oldFilename) => {
            const newFilename = `${filedir}/${util.hashFilename(dest)}`;
            const [obj, prop] = util.walkObject(list, src.replace(/\//, '.'));

            return new Promise((resolve, reject) =>
                fs.rename(oldFilename, newFilename, err => {
                    if (err) {
                        return 'Error!';
                    } else {
                        // Update the keyfile.
                        delete obj[prop];
                        obj[dest] = true;

                        return jcrypt.encrypt(util.getGPGArgs(), JSON.stringify(list, null, 4))
                        .then(util.writeFile(util.getDefaultFileOptions(), treeFile))
                        .then(() => resolve(`Successfully moved ${src} to ${dest}`))
                        .catch(reject);
                    }
                })
            );
        };

        return (src, dest) => {
            if (!src || !dest) {
                logError('Must supply both a src name and a dest name');
                return ;
            }

            const oldFilename = `${filedir}/${util.hashFilename(src)}`;

            util.fileExists(oldFilename)
            .then(() =>
                jcrypt.decryptFile(treeFile)
                .then(data => rename(JSON.parse(data), src, dest, oldFilename))
                .catch(logError)
            )
            .then(logSuccess)
            .catch(logError);
        };
    })(),

    rm: (() => {
        const removeKey = key =>
            new Promise((resolve, reject) =>
                jcrypt.decryptFile(treeFile)
                .then(data => {
                    const list = JSON.parse(data);
                    const [obj, prop] = util.walkObject(list, key.replace(/\//, '.'));

                    delete obj[prop];

                    jcrypt.encrypt(util.getGPGArgs(), JSON.stringify(list, null, 4))
                    .then(util.writeFile(util.getDefaultFileOptions(), treeFile));
                })
                .then(() => resolve('Key removed successfully'))
                .catch(reject)
            );

        return key => {
            const hashedFilename = util.hashFilename(key);
            const path = `${filedir}/${hashedFilename}`;

            util.fileExists(path)
            .then(() =>
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
                        Promise.all([util.removeFile(path), removeKey(key)])
                        .then(returnValues => {
                            logSuccess(returnValues[0]);
                        })
                        .catch(logError);
                    } else {
                        logInfo('No removal');
                    }
                })
            )
            .catch(logError);
        };
    })(),

    rmDir: dir => {
        if (!dir) {
            logError('Must supply a directory name');
            return;
        }

        jcrypt.decryptFile(treeFile)
        .then(data => {
            let list = JSON.parse(data);

            const [obj, prop] = util.walkObject(
                list,
                dir.replace(/^\/|\/$/g, '').replace(/\//g, '.')
            );

            if (!obj[prop]) {
                return 'No such thing';
            } else {
                if (!Object.keys(obj[prop]).length) {
                    delete obj[prop];

                    return jcrypt.encrypt(util.getGPGArgs(), JSON.stringify(list, null, 4))
                    .then(util.writeFile(util.getDefaultFileOptions(), treeFile))
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

