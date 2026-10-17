<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Building omx-skins

Needs Node.js 20 or newer and npm for the validator and the test suite. The installed package needs no node:
it carries the schema and the directory skins are installed into.

```
npm ci
make test                          # the node suite: the example validates, each broken copy is refused, the CLI
make check                         # the licence lines, no private pointer in a tracked file, the example validates
make install PREFIX=/usr DESTDIR=…   # the schema, and the empty skins directory
```

Enable the commit message check once per clone: `git config core.hooksPath .githooks`. A commit message that
carries an AI-attribution line is refused; CI runs the same check over a pull request's commits.

## The validator

```
node bin/omx-skins.mjs validate <skin.json | skin package directory>...
```

Exit 0 every file is valid, 1 a file is not (each fault is named by file and path), 2 a usage or read error.

## Layout

```
schema/skin-package.schema.json   JSON Schema 2020-12 of a package's skin.json
lib/validate.mjs                  the validator
bin/omx-skins.mjs                 the CLI
examples/skins/                   a skin package that validates
test/                             the suite
tools/                            the checks `make check` runs, and the commit message check
packaging/ debian/                omx-skins (RPM), omx-skins (deb)
```
