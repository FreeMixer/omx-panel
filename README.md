<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# omx-panel

Panels for audio plugins, generated from what the plugin declares. Give any LV2 or CLAP plugin a panel
without drawing one: a MOD GUI for MOD and Zynthian, pages for a controller, a layout for a host, all from
the plugin's own declaration, in the omx look, vintage or modern.

## What is here today

- `schema/skin-package.schema.json`: the schema of the `skin.json` file inside a skin package.
- `omx-panel validate <skin.json | package directory>`: checks a skin against the schema and names each fault by
  file and path.
- `examples/skins/org.example.plate/`: a small skin package that validates.

The schema and its validator are all this release holds. The layout, the MOD GUI generator, its images, the look
and the MOD GUI importer arrive with the next release.

## Install

The first release publishes `omx-panel` as an RPM (`dnf install omx-panel`) and a DEB (`apt install omx-panel`),
each carrying the schema and the skins directory, and `@freemixer/omx-panel` on npm
(`npm install @freemixer/omx-panel`), the validator. Until then, build from source: see [BUILDING.md](BUILDING.md).

## For a plugin author

A skin package is a directory named after the plugin, holding a `skin.json` that says how the plugin's panel is
drawn: its sections, labels and displays, the art it brings, and the licence of everything in it. The plugin's
own description keeps every range, unit and scale; the skin refers to controls by id. The format is described
in [docs/skin-package.md](docs/skin-package.md); `omx-panel validate` checks a package before it is installed.

A plugin that already ships a MOD GUI does not start from nothing: the importer, which arrives with the next
release, reads the bundle's `modgui.ttl` and the plugin's licence and writes a skin package from them, one
section in port order, the labels from the port names and the screenshot as the backdrop. A bundle whose licence
is missing or not on the allow-list is refused with a named code and nothing is written.

Licence: GPL-3.0-or-later (`LICENSE`).
