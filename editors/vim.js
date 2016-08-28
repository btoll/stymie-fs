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
    '-c', ':set foldmethod=indent',

    // Don't display the first line of text (the username) in the folded text.
    '-c', ":set foldtext=''",

    '-c', ':set viminfo='
];

