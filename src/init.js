'use strict';

const cp = require('child_process');
const fs = require('fs');
const util = require('./util');

const logError = util.logError;
const logSuccess = util.logSuccess;

module.exports = () =>
    require('inquirer').prompt([{
        type: 'input',
        name: 'installDir',
        message: 'Enter directory to install .stymie_fs.d:',
        default: '~'
    }, {
        type: 'input',
        name: 'envFile',
        message: 'We need to export a $STYMIE_FS environment variable.\nName of shell startup file to which the new env var should be written:',
        default: '.bashrc',
        when: answers => answers.installDir !== '~'
    }, {
        type: 'input',
        name: 'recipient',
        message: 'Enter the email address or key ID of your public key:',
        validate: input => {
            let res = true;

            if (!input) {
                logError('Cannot be blank');
                res = false;
            }

            return res;
        }
    }, {
        type: 'list',
        name: 'armor',
        message: 'Select how GPG/PGP will encrypt the files:',
        choices: [
            {name: 'Binary', value: false},
            {name: 'Armored ASCII Text', value: true}
        ],
        default: false
    }, {
        type: 'list',
        name: 'sign',
        message: 'Should GPG/PGP also sign the files? (Recommended):',
        choices: [
            {name: 'Yes', value: true},
            {name: 'No', value: false}
        ],
        default: true
    }, {
        type: 'input',
        name: 'hash',
        message: 'What hashing algorithm should be used for the filenames?',
        default: 'sha256WithRSAEncryption'
    }, {
        type: 'list',
        name: 'histignore',
        message: 'Should "stymie-fs *" be prepended to the value of $HISTIGNORE?',
        choices: [
            {name: 'Yes', value: true},
            {name: 'No', value: false}
        ],
        default: true
    }, {
        type: 'input',
        name: 'histignoreFile',
        message: 'We need to write the new $HISTIGNORE value.\nName of shell startup file to which it should be written:',
        default: '.bashrc',
        when: answers => answers.histignore
    }], answers => {
        const home = process.env.HOME;
        let installDir = answers.installDir;
        let stymieDir;

        const gpgOptions = {
            armor: !!answers.armor,
            hash: answers.hash,
            recipient: answers.recipient,
            sign: !!answers.sign
        };

        util.setGPGOptions(gpgOptions);

        if (installDir === '~') {
            installDir = home;
        }

        stymieDir = `${installDir}/.stymie_fs.d`;

        function mkDir(dir) {
            return new Promise((resolve, reject) =>
                fs.mkdir(dir, 0o700, err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(dir);
                    }
                })
            );
        }

        mkDir(stymieDir)
        .then(dir => {
            logSuccess(`Created project directory ${dir}`);

            return mkDir(`${stymieDir}/s`);
        })
        .then(dir => {
            logSuccess(`Created encrypted entries directory ${dir}`);

            // Create config file.
            return util.encrypt(JSON.stringify(gpgOptions, null, 4))
            .then(util.writeFile(`${stymieDir}/c`))
            .catch(logError);
        })
        .then(file => {
            logSuccess(`Created encrypted config file ${file}`);

            // Create entry list file.
            // TODO: DRY!
            return util.encrypt(JSON.stringify({}, null, 4))
            .then(util.writeFile(`${stymieDir}/f`))
            .catch(logError);
        })
        .then(file => {
            logSuccess(`Created encrypted entries list file ${file}`);

            if (answers.histignore) {
                const histignoreFile = `${home}/${answers.histignoreFile}`;

                return new Promise((resolve, reject) =>
                    fs.appendFile(histignoreFile, 'export HISTIGNORE="stymie-fs *:$HISTIGNORE"\n', 'utf8', (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve('Updated $HISTIGNORE');
                        }
                    })
                );
            }
        })
        .then(data => {
            // Note that `data` is undefined if not updating $HISTIGNORE.
            if (data) {
                logSuccess(data);

                // TODO
                // Immediately source the startup file.
                // require('child_process').spawn('source', [histignoreFile]);
            }
        })
        .catch(err => {
            logError(err);
            util.logWarn('Cleaning up, install aborted...');

            // TODO: Shred?
            const rm = cp.spawn('rm', ['-r', '-f', stymieDir]);

            rm.on('close', code => {
                if (code !== 0) {
                    logError('Something terrible happened, the project directory could not be removed!');
                } else {
                    util.logInfo('The project directory has been removed');
                }
            });
        });
    });

