<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The MOD GUI generator

`tools/modgui-gen.mjs` writes a MOD GUI (MOD Devices' modgui, the format MOD and Zynthian draw) for one plugin,
from its **descriptor** (omx-contract `docs/descriptors.md`) and, when the plugin declares one, its **panel**.

```
omx-panel modgui --descriptor <file> | --installed <package>/<name>
                 [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>] [--check | --emit-stdout]
```

- `--descriptor` names a descriptor file; `--installed omx-plugins/omx-delay` reads the one a package installed into
  omx-contract's contract directory (`<contractdir>/3/<package>/plugins/<name>.json`).
- `--panel` names a JSON file holding the declared panel: `family`, `sections` (each `key`, `label`, `controls` by
  symbol) and, optionally, `widgets` (symbol to `knob`, `fader`, `switch` or `selector`, the list in
  `schema/panel.schema.json`). With none, the sections are the descriptor's groups, laid out by
  `tools/panel-description.mjs`, and the family the one their meanings make.
- `--out` is the LV2 bundle the files go into: `modgui.ttl` and `modgui/`. `--stem` names the files
  (`icon-<stem>.html`, `stylesheet-<stem>.css`, `screenshot-<stem>.png`, `thumbnail-<stem>.png`); it defaults to
  the bundle's name without `.lv2`.
- `--source` is the text the files' banner names as what they were made from; it defaults to the descriptor and
  the panel files.
- `--check` writes nothing and refuses a stale, missing or extra file byte for byte; `--emit-stdout` prints every
  text file and one digest line per image.

Every control's symbol, travel, default and label is the descriptor's. A toggle is a switch; a choice, or an
integer travel of at most 16 steps, a selector over its values; every other travel a knob. The template lays out
every section and every control; `modgui.ttl` lists the controls of the first section as `modgui:port`.

The images (the screenshot, the thumbnail, the knob film and the fader's when a control is one) are rasterised by
`tools/raster.mjs` from the template's own layout, each control at its default, with no text: a fixed-code
deflate and no zlib, so their bytes depend only on the descriptor, the panel and the look.

## The look

`tools/look/tokens.css` is the omx look's token cascade, the one source of the colours and the font a renderer
wears. `tools/look.mjs` resolves it at the look it names into `tools/look.json`, every colour a plain `#rrggbb`;
`omx-panel look --check` refuses a `look.json` that is not what the cascade resolves to.

## The test

`tools/modgui-test.sh <bundle.lv2> <descriptor> [<panel>]` holds a written MOD GUI to its descriptor on values:
the files are the generation byte for byte; every control is drawn in the template with its symbol, travel and
default, and nothing undeclared is; every choice is a selector with each of its values; `sord_validate` accepts
the bundle against the LV2 specifications, `tools/modgui-terms.ttl` (the closed modgui vocabulary) and
omx-contract's resource-hint terms, and refuses a property outside that vocabulary; and a descriptor with its
first control's default moved makes `--check` fail on the template.
