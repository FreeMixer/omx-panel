<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# omx-skins

The skin format for openmixer panels. A skin tells a panel how to draw its standard widgets
(knobs, faders, switches, selectors, meters, curves): one skin, one look.

This repository will hold the skin schema, the validator, the loader that reads the system and
per-user skin directories, the licence rules that refuse a skin whose licence we cannot allow,
the registry of representations for each standard widget, and the openmixer look as the first skin.
Anyone can add a skin by installing a skin file into the skins directory.

## What is here today

- `schema/skin-package.schema.json`: the schema of the `skin.json` file inside a skin package.
- `omx-skins validate <skin.json | package directory>`: checks a skin against the schema and names each fault by file and path.
- `examples/skins/org.example.plate/`: a small skin package that validates.

The format is described in [docs/skin-package.md](docs/skin-package.md). The loader, the licence rules and the
widget registry are not here yet.

## Install

The first release will publish `omx-skins` (the schema and the skins directory) as an RPM and a DEB and
`@openmixer/omx-skins` (the validator) on npm. Until then, build from source.

Building from source: see [BUILDING.md](BUILDING.md).

Licence: GPL-3.0-or-later (`LICENSE`).
