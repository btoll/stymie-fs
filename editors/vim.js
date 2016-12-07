module.exports = [
    '-c', ':set nobackup',
    '-c', ':set nowritebackup',
    '-c', ':set noswapfile',
    '-c', ':set noundofile',

    // Erases all session information when the file is closed.
    '-c', ':set bufhidden=wipe',

    // Auto-closes folds when leaving them.
    // '-c', 'fcl=all',

    // Automatically folds indented lines when the file is opened.
    // This could add a layer of obfuscation if opening files around prying eyes.
    // '-c', ':set foldmethod=indent',

    // Don't display the first line of text in the folded text.
    '-c', ":set foldtext=''",

    '-c', ':set viminfo='
];

