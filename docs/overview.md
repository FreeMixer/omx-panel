<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# omx-panel: overview

## What is here

- The layout: `tools/panel-description.mjs` lays out a panel from a plugin's descriptor (sections, controls, roles,
  the family, the pages of eight a controller shows), under the plugin's declared panel when it has one
  ([panel-layout.md](panel-layout.md)).
- The MOD GUI generator: `omx-panel modgui` writes a plugin's MOD GUI from its descriptor, its images rasterised
  byte for byte, in the omx look (`tools/look/tokens.css`) ([modgui.md](modgui.md)).
- The sync: `omx-modgui-sync` gives a generated MOD GUI to every installed LV2 plugin that ships none, into
  `/usr/local/lib/lv2` (`~/.lv2` for a user), one bundle per plugin, never touching a bundle that is not its own.
  The systemd unit is installed, not enabled: `systemctl enable omx-modgui-sync` makes it run after each
  `plugin-qualify-sync` (a drop-in on that unit queues it when a scan finishes, only if enabled). `omx-modgui-sync --check` says whether MOD-UI reads the folder. A plugin that cannot get a GUI never
  fails the run; `omx-modgui-sync(1)` has the directories, the exit status and the summary.
- The group inference: `tools/group-infer.mjs` finds the port groups an LV2 plugin lacks from what it states (its own
  partial groups, designations, name and symbol prefixes, units, index runs, its MOD GUI), or says it cannot with
  confidence and leaves the plugin as it is ([group-inference.md](group-inference.md)).
- The complement: `omx-complement-sync` (`omx-panel complement`) carries those groups to lilv, for jalv on the Zynthian
  touchscreen: for an installed bundle with a plugin to group it writes, beside omx-modgui-sync's GUIs, a bundle that
  restates the installed TTL, adds the groups and raises `lv2:microVersion` by one, so lilv loads it in place of the
  installed one. The installed files are never touched; a marker makes a second run write nothing, a run removes the
  bundles of its own no longer wanted (the installed bundle gone, changed or needing no groups now), and deleting the
  bundle restores the plugin as installed ([docs/lv2-complement.md](lv2-complement.md), `omx-complement-sync(1)`).
- The skin package: its schema, `omx-panel validate`, and its facts as a module (`src/skin-package.ts`: the
  directory name, the override and how it applies, the licence allow-list, the refusal codes)
  ([skin-package.md](skin-package.md)).
- The importer: `omx-panel import` turns a MOD GUI bundle into a skin package.
- The widgets a panel names (`schema/panel.schema.json`): knob, fader, switch, selector.
- A worked example: a third-party LV2 plugin (ZamComp) and CLAP plugin (LSP Limiter Mono) from the scan to a
  generated panel, and where Zynthian reads the LV2 one ([worked-example.md](worked-example.md)).

The documents are also published at <https://openmixer.org/projects/omx-panel>, and why most LV2 plugins on a
Zynthian need inferred port groups is the technical note
<https://openmixer.org/notes/why-lv2-plugins-on-zynthian-need-inferred-port-groups>.

## For a plugin author

A skin package is a directory named after the plugin, holding a `skin.json` that says how the plugin's panel is
drawn: its sections, labels and displays, the art it brings, and the licence of everything in it. The plugin's
own description keeps every range, unit and scale; the skin refers to controls by id. The format is described
in [skin-package.md](skin-package.md); `omx-panel validate` checks a package before it is installed.

A plugin with no MOD GUI gets one from its descriptor: `omx-panel modgui --descriptor <file> --out <bundle.lv2>`
writes `modgui.ttl` and `modgui/` into the bundle, every control drawn with its own travel and default.
`omx-panel descriptors --installed` lists the installed descriptor files, one path per line.

A plugin that already ships a MOD GUI does not start from nothing: the importer reads the bundle's `modgui.ttl` and the plugin's licence and writes a skin package from them, one
section in port order, the labels from the port names and the screenshot as the backdrop. A bundle whose licence
is missing or not on the allow-list is refused with a named code and nothing is written.

