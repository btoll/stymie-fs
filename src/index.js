'use strict';

const R = require('ramda');
const cp = require('child_process');
const inquirer = require('inquirer');
const jcrypt = require('jcrypt');
const path = require('path');
const util = require('./util');
const which = require('which');

const env = process.env;
const stymieDir = `${env.STYMIE_FS || env.HOME}/.stymie_fs.d`;
const filedir = `${stymieDir}/s`;
const treeFile = `${stymieDir}/f`;
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

        const defaultFileOptions = util.getDefaultFileOptions();
        const gpgArgs = util.getGPGArgs();
        const hashedFilename = util.hashFilename(util.stripBeginningSlash(newKey));

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
        const keyPath = `${filedir}/${util.hashFilename(util.stripBeginningSlash(key))}`;

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
        util.fileExists(`${filedir}/${util.hashFilename(util.stripBeginningSlash(key))}`)
        .then(() => logSuccess('File exists'))
        .catch(logError);
    },

    list: start =>
        jcrypt.decryptFile(treeFile)
        .then(data => {
            let list = JSON.parse(data);

            const base = !start ?
                list :
                util.walkObject(
                    list,
                    start.replace(/^\/|\/$/g, '').replace(/\//g, '.')
                );

            if (base) {
                const entries = [];

                for (let entry of Object.keys(base)) {
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
            const hashedFilename = util.hashFilename(util.stripBeginningSlash(key));
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

