The `node_modules` fixture directories contain synthetic resolver inputs, not
installed application dependencies. Restored from codesandbox/sandpack-bundler
commit a323f46fd38442bb2dbc76fecd262e1435aca5bd, under its Apache-2.0 license:
https://github.com/codesandbox/sandpack-bundler/tree/a323f46fd38442bb2dbc76fecd262e1435aca5bd/src/resolver/fixture

Keep these files in source control. Running a package manager in this directory
would replace the synthetic packages and invalidate the resolver tests.
