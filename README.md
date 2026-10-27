<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# omx-panel

Panels for audio plugins, generated from what the plugin declares. Give any LV2 or CLAP plugin a panel
without drawing one: a MOD GUI for MOD and Zynthian, pages for a controller, a layout for a host, all from
the plugin's own declaration, in the omx look, vintage or modern.

## What is here today

- The layout: `tools/panel-description.mjs` lays out a panel from a plugin's descriptor (sections, controls, roles,
  the family, the pages of eight a controller shows), under the plugin's declared panel when it has one
  ([docs/panel-layout.md](docs/panel-layout.md)).
- The MOD GUI generator: `omx-panel modgui` writes a plugin's MOD GUI from its descriptor, its images rasterised
  byte for byte, in the omx look (`tools/look/tokens.css`) ([docs/modgui.md](docs/modgui.md)).
- The sync: `omx-modgui-sync` gives a generated MOD GUI to every installed LV2 plugin that ships none, into
  `/var/lib/omx/modgui` (on MOD-UI's `LV2_PATH`), one bundle per plugin, never touching a bundle that is not its own.
  The systemd unit is installed, not enabled: `systemctl enable omx-modgui-sync`. A plugin that cannot get a GUI never
  fails the run; `omx-modgui-sync(1)` has the directories, the exit status and the summary.
- The skin package: its schema, `omx-panel validate`, and its facts as a module (`src/skin-package.ts`: the
  directory name, the override and how it applies, the licence allow-list, the refusal codes)
  ([docs/skin-package.md](docs/skin-package.md)).
- The importer: `omx-panel import` turns a MOD GUI bundle into a skin package.
- The widgets a panel names (`schema/panel.schema.json`): knob, fader, switch, selector.
- A worked example: a third-party LV2 plugin (ZamComp) and CLAP plugin (LSP Limiter Mono) from the scan to a
  generated panel, and where Zynthian reads the LV2 one ([docs/worked-example.md](docs/worked-example.md)).

## Install

The first release publishes `omx-panel` as an RPM (`dnf install omx-panel`) and a DEB (`apt install omx-panel`),
each carrying the tools, the schema and the skins directory, and `@openmixer/omx-panel` on npm
(`npm install @openmixer/omx-panel`). Until then, build from source: see [BUILDING.md](BUILDING.md).

## For a plugin author

A skin package is a directory named after the plugin, holding a `skin.json` that says how the plugin's panel is
drawn: its sections, labels and displays, the art it brings, and the licence of everything in it. The plugin's
own description keeps every range, unit and scale; the skin refers to controls by id. The format is described
in [docs/skin-package.md](docs/skin-package.md); `omx-panel validate` checks a package before it is installed.

A plugin with no MOD GUI gets one from its descriptor: `omx-panel modgui --descriptor <file> --out <bundle.lv2>`
writes `modgui.ttl` and `modgui/` into the bundle, every control drawn with its own travel and default.
`omx-panel descriptors --installed` lists the installed descriptor files, one path per line.

A plugin that already ships a MOD GUI does not start from nothing: the importer reads the bundle's `modgui.ttl` and the plugin's licence and writes a skin package from them, one
section in port order, the labels from the port names and the screenshot as the backdrop. A bundle whose licence
is missing or not on the allow-list is refused with a named code and nothing is written.

Licence: GPL-3.0-or-later (`LICENSE`).
