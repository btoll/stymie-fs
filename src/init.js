'use strict';

const cp = require('child_process');
const fs = require('fs');
const jcrypt = require('jcrypt');
const util = require('./util');

const defaultFileOptions = util.getDefaultFileOptions();
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
        const armor = answers.armor;
        const recipient = answers.recipient;
        const sign = answers.sign;
        const gpgOptions = ['--encrypt', '-r', recipient];
        let installDir = answers.installDir;
        let stymieDir;

        if (armor) {
            gpgOptions.push('--armor');
        }

        if (sign) {
            gpgOptions.push('--sign');
        }

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
            return jcrypt.encrypt(gpgOptions, JSON.stringify({
                armor: armor,
                hash: answers.hash,
                recipient: recipient,
                sign: sign
            }, null, 4))
            .then(util.writeFile(util.getDefaultFileOptions(), `${stymieDir}/c`))
            .catch(logError);
        })
        .then(file => {
            logSuccess(`Created encrypted config file ${file}`);

            // Create entry list file.
            // TODO: DRY!
            return jcrypt.encrypt(gpgOptions, JSON.stringify({}, null, 4))
            .then(util.writeFile(defaultFileOptions, `${stymieDir}/f`))
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

