<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The skin package

A skin package is a directory named after the plugin it draws. The plugin id is the name. An id that holds a byte
outside `A-Z a-z 0-9 . _ -` (an LV2 URI) has each such byte written as `%XX`, and `.` and `..` alone are never a
name, so the name is always safe in a path. One function writes the name, `encodeSkinId` (`src/skin-package.ts`), and
`decodeSkinId` reads it back. This package creates `/usr/share/omx/skins` for packages to be installed into; which
directories a host reads, and in what order, is the host's.

```
<plugin id>/
  skin.json          the override file, required, even if it only names the licence
  view/              optional: a view of the skin's own
    index.mjs        an ES module, the entry
  i18n/<lang>.json   optional: label key to text, one file per language
  art/               optional: the images the override file names
  modgui/            optional: a MOD GUI, imported from a bundle or generated
```

## skin.json

One schema, declared twice in one place: `schema/skin-package.schema.json` (JSON Schema, what `omx-panel validate`
checks) and `parseSkinOverride` (`src/skin-package.ts`, what a reader applies). A test holds the two to the same
verdict on every broken copy of the example. A file holds:

| Field | Meaning |
|---|---|
| `schema` | `1`, the file's schema version; any other value refuses the file |
| `plugin` | the plugin id; a reader refuses a file whose id is not the directory's decoded name |
| `licence` | the SPDX expression of everything in the package; required |
| `source` | where the package came from: `own`, `generated` or `modgui`, with the `bundle` and the `licenceEvidence` an importer read; an imported MOD GUI may name its own icon template and stylesheet, `modgui: { html, css }`, both under `modgui/` |
| `fingerprint` | the panel description fingerprint the file was written against; a mismatch is a warning, never a refusal |
| `family` | a panel family; replaces the description's |
| `roles` | role (`time`, `band_freq[2]`) to control symbol; replaces the description's roles, each checked against the family |
| `sections` | `[{ key, labelKey?, label?, controls }]`; replaces the sections and their order; a control named nowhere goes to a last section, never hidden |
| `labels` | control symbol to `{ labelKey?, label? }` |
| `visibleWhen` | control symbol to `{ param, values }`, the integer values 0 to 63 that show it |
| `displays` | `[{ kind, section, source, ... }]`, the displays the panel draws |
| `houseView` | the family of the house view to use |
| `look` | the default look; a client's own choice still wins |
| `backdrop` | an image under `art/` |
| `view` | `{ entry, api }`: the view's entry under `view/` (`view/index.mjs`) and the skin API version it was written for, `MAJOR.MINOR` |
| `modgui` | `{ entry }` under `modgui/`: the opt-in for a MOD GUI's own script, never beside a `view` |

A path in a skin is relative to the package and stays inside it: no absolute path, no `..` segment, no backslash.

The skin restates no range, unit or scale. The plugin's own description holds those, and the skin binds to a
control by its symbol and its meaning.

## Applying it

`applySkinOverride(description, override)` applies the file to a panel description field by field. An entry that
names an unknown symbol, a role the family has no place for or whose unit it does not take, or a display in no
section is dropped and listed with its reason (`unknown-symbol`, `unknown-section`, `role-not-in-family`,
`role-unit`, `role-repeats`); the rest of the file stands. The role check reads `ROLES` of
`tools/panel-description.mjs`; a caller may pass its own. That table is wider than the console's own at five
roles: `threshold` of gate, dynamics, limiter and deesser and `ceiling` of limiter take `db, dbfs, dbu, lufs` here and
`db, dbfs` in the console. A console that keeps its own table passes it as the check; one that adopts this table
accepts a threshold in dBu or LUFS.

## Refusals

Each refusal is a code with named arguments (`SKIN_REFUSAL_CODES`): `SKIN_OVERRIDE_INVALID` (the file does not parse
or fails the schema, `args.field` the first field that broke it), `SKIN_OVERRIDE_ENTRY_DROPPED`, `SKIN_API_MISMATCH`,
`SKIN_VIEW_ERROR`, `SKIN_VIEW_LINT`, `SKIN_MODGUI_LICENCE`, and the importer's own eight, `MODGUI_*` (below).

## The licence

`SKIN_LICENCE_ALLOW_LIST` is the one list a MOD GUI's licence must be on: GPL-2.0-or-later, GPL-3.0-or-later,
LGPL-2.1-or-later, LGPL-3.0-or-later, MIT, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, CC0-1.0 and CC-BY-4.0.
`spdxFromDoapLicence` reads a plugin's `doap:license` as an SPDX id; mapping is not permission.

## Importing a MOD GUI

`omx-panel import <bundle.lv2> --out <skins dir> [--plugin <uri>]` (`tools/modgui-import.mjs`) reads a bundle's
`modgui.ttl` and the plugin's `doap:license` and writes a package: one section in `modgui:port` order, each port's
`lv2:name` as its label, the screenshot as the backdrop under `art/`, the whole resources directory and the TTL
under `modgui/`, and `source` `{ kind: "modgui", bundle, licenceEvidence }`. It writes no view, no family and no
roles. It refuses, with a code that names the file it read and nothing written: `MODGUI_NOT_FOUND`,
`MODGUI_TTL_INVALID`, `MODGUI_NO_LICENCE`, `MODGUI_LICENCE_UNMAPPED`, `MODGUI_LICENCE_REFUSED` (outside the
allow-list), `MODGUI_UNKNOWN_PROPERTY`, `MODGUI_PATH_ESCAPE` and `MODGUI_TARGET_EXISTS`.

## What the validator checks

The shape. That every control id exists in the plugin's description and that a role fits its control is
`applySkinOverride`'s, against the description it is applied to.
