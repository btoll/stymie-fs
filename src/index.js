'use strict';

const R = require('ramda');
const cp = require('child_process');
const inquirer = require('inquirer');
const jcrypt = require('jcrypt');
const mkdirp = require('mkdirp');
const path = require('path');
const util = require('./util');
const which = require('which');

const env = process.env;
const filedir = `${env.STYMIE || env.HOME}/.stymie.d/s`;
const treeFile = `${env.STYMIE || env.HOME}/.stymie.d/f`;
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

        const dirname = path.dirname(key);
        const basedir = dirname !== '.' ? `${filedir}/${dirname}` : filedir;
        const defaultFileOptions = util.getDefaultFileOptions();
        const gpgArgs = util.getGPGArgs();
        const hashedFilename = util.hashFilename(path.basename(key));
        const writeFile = util.writeFile(defaultFileOptions);
        const writeKeyFile = writeFile(`${basedir}/${hashedFilename}`);

        const stringifyTreeFile = data => JSON.stringify(data, null, 4);
        const writeDirsToTreeFile = util.writeDirsToTreeFile(key);
        const writeKeyToTreeFile = util.writeKeyToTreeFile(key);
        const writeTreeFile = writeFile(treeFile);
        const encryptData = jcrypt.encrypt(gpgArgs);

        // Now that the new file has been added we need to record it in the "treefile"
        // in order to do lookups.
        const writeDirsToTreeFilePipe = R.compose(encryptData, stringifyTreeFile, writeDirsToTreeFile, JSON.parse);
        const writeKeyToTreeFilePipe = R.compose(encryptData, stringifyTreeFile, writeKeyToTreeFile, JSON.parse);

        const decryptAndEncryptTreeFile = R.composeP(
            R.composeP(writeTreeFile, writeDirsToTreeFilePipe, jcrypt.decryptFile)
        );

        const decryptAndEncryptTreeFile2 = R.composeP(
            R.composeP(writeTreeFile, writeKeyToTreeFilePipe, jcrypt.decryptFile)
        );

        const createEncryptedFile = () =>
            encryptData(key)
            .then(writeKeyFile)
            .then(() => decryptAndEncryptTreeFile2(treeFile))
            .then(() => logSuccess('File created successfully'))
            .catch(logError);

        // Creating an already-existing dir doesn't throw, but maybe clean this up.
        if (/\/$/.test(key)) {
            mkdirp(`${filedir}/${key}`, err => {
                if (err) {
                    logError('Could not create directory');
                } else {
                    decryptAndEncryptTreeFile(treeFile);
                }
            });
        } else {
            // This seems counter-intuitive because the resolve and reject operations
            // are reversed, but this is b/c the success case is when the file does not
            // exist (and thus will throw an exception).
            util.fileExists(`${basedir}/${hashedFilename}`)
            .then(() => logError('File already exists'))
            .catch(() =>
                // If the dir already exists then it's safe to create the new file.
                util.fileExists(basedir)
                .then(createEncryptedFile)
                .catch(() => {
                    // Else, first create the new directory.
                    mkdirp(basedir, err => {
                        if (err) {
                            logError('Could not create directory');
                        } else {
                            createEncryptedFile();
                        }
                    });
                })
            );
        }
    },

    get: key => {
        const defaultFileOptions = util.getDefaultFileOptions();
        const basename = path.basename(key);
        const hashedFilename = util.hashFilename(basename);
        const pathToKey = `${filedir}/${path.dirname(key)}/${hashedFilename}`;

        util.fileExists(pathToKey).then(() =>
            jcrypt.decryptToFile(pathToKey)
            .then(() => {
                openEditor(pathToKey, () =>
                    // Re-encrypt once done.
                    jcrypt.encryptToFile(pathToKey, null, util.getGPGArgs(), defaultFileOptions)
                    .then(() => logInfo('Re-encrypting and closing the file'))
                    .catch(logError)
                );
            })
            .catch(logError)
        )
        .catch(logError);
    },

    has: key => {
        const basename = path.basename(key);
        const hashedFilename = util.hashFilename(basename);

        util.fileExists(`${filedir}/${path.dirname(key)}/${hashedFilename}`)
        .then(() => logSuccess('File exists'))
        .catch(logError);
    },

    list: (start) =>
        jcrypt.decryptFile(treeFile)
        .then(data => {
            let list = JSON.parse(data);

            if (!list) {
                logInfo('No files');
            } else {
                const replaced = start.replace(/^\/|\/$/g, '').replace(/\//g, '.');
                const base = !start ? list : util.walkObject(list, replaced);

                if (base) {
                    const entries = [];

                    for (let entry of Object.keys(base)) {
                        entries.push(
                            (typeof base[entry] === 'object') ?
                                `${entry}/` :
                                entry
                        );
                    }

                    logInfo(`Installed files: \n${entries.join('\n')}`);
                } else {
                    logError('There was a TypeError attempting to parse the tree object. Bad object lookup?');
                }
            }
        })
        .catch(logError),

    rm: (() => {
        function rm(file) {
            return new Promise((resolve, reject) =>
                which('shred', err => {
                    let rm;

                    if (err) {
                        logInfo('Your OS doesn\`t have the `shred` utility installed, falling back to `rm`...');
                        rm = cp.spawn('rm', [file]);
                    } else {
                        rm = cp.spawn('shred', ['--zero', '--remove', file]);
                    }

                    rm.on('close', code => {
                        if (code !== 0) {
                            reject('Something terrible happened!');
                        } else {
                            resolve('The file has been removed');
                        }
                    });
                })
            );
        }

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
                        rm(path)
                        .then(logSuccess)
                        .catch(logError);
                    } else {
                        logInfo('No removal');
                    }
                })
            )
            .catch(logError);
        };
    })()
};

module.exports = file;

