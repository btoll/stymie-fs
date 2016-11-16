# stymie-fs

## Features

- Create encrypted files as well as key entries.
- Since everything is stored in `.stymie_d/`, it's easy to port between systems.
- GPG end-to-end encryption allows `stymie-fs` to be safely versioned.

## Security Features

- Uses GPG/PGP public-key cryptography to encrypt everything (even configs).
- Uses OS-level permissions-based access control so only the user can view and list any files created by the user.
- Cryptographically hashes the key name as the filename when creating encrypted files.
- Uses the [shred] utility to overwrite any removed file in-place (including a final pass of zeroes to hide the shredding) before unlinking. Will default to `rm` when `shred` isn't installed.
- When using Vim to edit any files (the default), does not leave any swap or backup files during or after editing.
- Optionally, asks to set `$HISTIGNORE` so `stymie-fs` commands aren't stored in history.

[1] As an alternative to setting `$HISTIGNORE`, most shells by default allow for any command preceded by a `[[SPACE]]` to be ignored by history. Check the value of `$HISTCONTROL` for support.

Only Linux and OS X are supported at this time. There are no plans to support Windows.

## Installation

`npm install git+https://github.com/btoll/stymie-fs -g`

## Suggestions

- Use `gpg-agent` to save typing.
- Set `$EDITOR` environment variable to preferred editor. Place editor configs in the `editors/` directory. See the [example for Vim](editors/vim.js).

## Examples

- Add an encrypted file with the key name `secrets`:
```
stymie-fs add secrets
```

- Delete the file with the key name `secrets`:
```
stymie-fs rm secrets
```

## Usage

    Command | Description
    ------- | --------
    add | Adds a new file or directory
    edit | Edits a file
    get | Retrieves a file
    has | Checks if the file exists
    import | Imports a file
    list | List all files (TODO)
    mv | Renames a file
    rm | Deletes a file
    rmDir | Deletes a directory (only if empty)

### Other commands and options

    Command | Description
    ------- | --------
    init | Installs the file directory and config file

    Option | Description
    ------- | --------
    -h, --help | Display help.

## License

[MIT](LICENSE)

## Author

Benjamin Toll

[shred]: https://en.wikipedia.org/wiki/Shred_(Unix)

