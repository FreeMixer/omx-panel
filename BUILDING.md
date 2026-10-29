<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Building omx-panel

Needs Node.js 18 or newer and npm. The tools that read the plugin vocabulary need it installed: omx-contract's
schema and contract directory (`omx-contract-data`), plugin-hostd's format tables (`plugin-hostd-contract`), the
descriptors of omx-plugins' plugins and the param-contract unit table, `param-units.json` (both `omx-plugins-contract`,
from 0.15.0). The contract directory is `$OMX_CONTRACT_PATH` (a `:`
list, the first that holds a package wins), else omx-contract's pkg-config variable `contractdir` where
`omx-contract-devel` installs `omx-contract.pc`, else `/usr/share/omx-contract/contract.d`; no pkg-config is needed.
`$PLUGIN_HOSTD_TABLES` (a directory holding `lv2.json`) and `$OMX_CONTRACT_SCHEMA` (an `omx-contract.schema.json`)
stand in for the installed ones. `omx-panel vocabulary [<package>/<name>]...` prints where each is read from. `tools/modgui-test.sh` also needs `sord_validate` (sord) and the LV2
specification bundles (lv2).

```
npm ci
make                               # dist/: tsc over src/ and the .mjs tools (allowJs), the data files beside them
make test                          # the node suite, over the built tree
make check                         # the licence lines, no private pointer in a tracked file, the example validates, look.json is fresh
make install PREFIX=/usr DESTDIR=…   # the built tree under share/omx-panel, the omx-panel command, the empty skins directory
```

Enable the commit message check once per clone: `git config core.hooksPath .githooks`. A commit message that
carries an attribution line is refused; CI runs the same check over a pull request's commits.

## The command

```
omx-panel validate <skin.json | skin package directory>...
omx-panel layout   --descriptor <file> [--panel <file>] [--ns <label-key namespace>] [--canonical | --pages]
omx-panel modgui   --descriptor <file> | --installed <package>/<name> [--panel <file>] --out <bundle.lv2> [--check]
omx-panel import   <bundle.lv2> --out <skins dir> [--plugin <uri>]
omx-panel complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run] [--verbose]
omx-panel look     [--check]
omx-panel vocabulary [<package>/<name>]...
```

`validate`: exit 0 every file is valid, 1 a file is not (each fault named by file and path), 2 a usage or read
error. `import`: one `MODGUI-IMPORT-JSON` line, exit 0 written, 3 refused, 2 usage. `vocabulary`: one `ok` or
`FAIL` line for each source read, exit 0 every source is read, 1 one is not installed. `complement`: one line per
bundle written, refused or skipped and a summary, exit 0 when the run finished whatever it refused, 1 when it could
not start, 2 usage.

## Layout

```
src/skin-package.ts               the skin package's facts: name, schema 1, override application, licences, refusals
tools/panel-description.mjs       the layout from a descriptor
tools/vocabulary.mjs              the readers of the installed vocabulary: meanings, unit tokens
tools/modgui-gen.mjs raster.mjs   the MOD GUI and its images
tools/look.mjs look/ look.json    the omx look's tokens and their resolved values
tools/modgui-test.sh modgui-terms.ttl  a written MOD GUI held to its descriptor
tools/modgui-import.mjs turtle-read.mjs  a MOD GUI bundle in, a skin package out
tools/group-infer.mjs             the port groups an LV2 plugin lacks, inferred
tools/lv2-complement.mjs          the replacing bundle that carries them to lilv (bin/omx-complement-sync runs it)
schema/                           the skin package schema, the panel's widget list
lib/validate.mjs bin/omx-panel.mjs  the validator and the command
examples/skins/                   a skin package that validates
test/                             the suite and its fixtures
packaging/ debian/                omx-panel (RPM), omx-panel (deb)
```
