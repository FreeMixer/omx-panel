<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The skin package

A skin package is a directory named after the plugin it draws, under one of the skins directories: `/usr/share/omx/skins`
(installed by a package) or `$XDG_DATA_HOME/omx/skins` (the user's own, `~/.local/share/omx/skins` when the variable is unset). The plugin id is the name, and an id that holds a
byte outside `A-Z a-z 0-9 . _ -` has that byte written as `%XX`, so the name is always safe in a path.

```
<skins directory>/
  org.example.plate/
    skin.json        what this skin says about the panel
    art/             the images the skin refers to
    view/            a view of the skin's own, when it brings one
```

## skin.json

The schema is `schema/skin-package.schema.json`. A file holds:

- `requires`: what a reader must provide, each as a floor, never a ceiling. `"omx-skins-schema": ">= 1.0.0"` is the
  schema version the file was written for. A file with no `requires`, or none for the schema, is refused, and so is
  a value that is not a floor (`< 2.0.0`, `1.0.0`).
- `plugin`: the id of the plugin the skin draws.
- `licence`: the SPDX identifier of the skin's licence. Which identifiers are accepted is the loader's rule.
- `source`: where the package came from: `own`, `generated`, or `modgui` (made from a MOD GUI bundle), with the bundle
  and the evidence for its licence when there is one.
- `fingerprint`: the fingerprint of the plugin description the skin was made against.
- `family`, `roles`, `sections`, `labels`, `visibleWhen`, `displays`: how the panel is arranged and named. They
  refer to controls by id.
- `backdrop`: an image under `art/`.
- `view`: a view of the skin's own: its entry file under `view/` and the skin API version it was written for.

The skin restates no range, unit or scale. The plugin's own description holds those, and the skin binds to a
control by its id and its meaning.

A path in a skin is relative to the package and stays inside it: no absolute path, no `..` segment, no backslash.

## What the validator checks

The shape only. That every control id exists in the plugin's description, that a role fits its control and that the
licence is one the console accepts are checked by the loader, which is not in this repository yet.
