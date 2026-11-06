<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Panel layout from a descriptor

`tools/panel-description.mjs` lays out a plugin's panel from its **descriptor**: the words omx-contract
uses to describe one plugin, ours or anyone's (omx-contract `docs/descriptors.md`). A plugin from any
origin (`authored`, `built`, `scanned`) gets a layout; a plugin that declares its panel (omx-plugins'
do, in `<stem>.decl.json`) adds it on top, and what its faces serve as `org.openmixer.panel-description/1`
is this layout.

## The two inputs

| Input | Who has it | What it gives |
|---|---|---|
| The descriptor | every plugin | each control's `kind`, `travel` (range, `unit`, `scale`, default), choice ids and labels, `label`, `group`, `meaning`, `hidden`, `readonly`; the `ports`; the `origin` |
| The declared panel | a plugin that declares one (omx-plugins: `<stem>.decl.json`, `panel`) | the family, the section keys and labels, the order of the controls in each section, the roles, the widgets the panel names, the graphs, the per-placement come-up values |

This package reads descriptors, never a declaration. omx-plugins renders its declarations as their
`authored` descriptors (its `tools/descriptor.mjs`): one control per parameter, its id the parameter's
index, its name the symbol, its label the parameter's name; a toggle is a `toggle`, an integer travel
with labelled values a `choice`, every other parameter a `travel` with the declared unit and scale; its
`group` the label of the panel section that lists it; its `meaning` the one the declared role names
(below). The declared panel then goes to the layout unchanged.

## Units

A control's unit is the descriptor's `travel.unit`. A role checks it against the units the
param-contract extension serves (`tools/vocabulary.mjs`, `servedToken`): a unit's token is the LV2 unit a
face writes for it, plugin-hostd's installed LV2 table read backwards, or the name of a unit in the
extension's vendor block (`dBu`, `ratio`); it is served when the extension's unit table,
`OMX_PARAM_CONTRACT_UNITS` (omx-contract's sheet, `3/omx-contract/param-contract.json` in the contract directory, omx-contract-data from 3.6.0), gives the token a value. So a unit that table or that block knows (`LUFS`, `dBu`
among them) is checked like any other. A unit with no token there, `unknown` included, takes no role and
is drawn as a plain number. Nothing here types a unit: the reader reads the installed table
(`$PLUGIN_HOSTD_TABLES` stands in for it) and the installed unit sheet (`param-contract.json` in omx-contract's directory), and refuses by name when either is missing.

The level roles (`threshold`, `ceiling`) take `dB`, `dBFS`, `dBu` and `LUFS`.

## Meanings and roles

A skin binds by meaning, never by symbol. A family's roles map to the descriptor's meanings
(`tools/vocabulary.mjs`, `meaningOfRole`, over omx-contract's closed list of meanings as its installed
schema declares it); a role whose name is a meaning maps to it, and these are renamed:

| Role | Meaning |
|---|---|
| `mix` | `wetDryRatio` |
| `time` | `delay` |
| `cutoff` | `cutoffFrequency` |
| `band_freq`, `band_gain`, `band_q` | `frequency`, `gain`, `q` |
| `hpf_freq`, `low_cut` | `lowCut` |
| `lpf_freq`, `high_cut` | `highCut` |
| `hpf_slope`, `lpf_slope` | `slope` |
| `key_listen` | `listen` |

A role with no meaning word (`band_type`, `model`, `algorithm`, `knee_start`, ...) is bound only by
a declared panel.

With no declared panel the roles come from the meanings: in the family the layout takes, each
meaning that names exactly one of the family's roles plays it; an indexed role (`band_*`) takes every
control of its meaning, in order; any other role is played by its first control, and a second is
left unpublished, named.

A `modulation` depth is a plain amount (`none`, `pc`, `coef`) or a sweep in octaves (`oct`), as a phaser's is.

## The family

The family follows from the meanings, never from a guess about the plugin:

| Family | A declared family needs one of | Inferred, with no declared panel, from all of |
|---|---|---|
| `limiter` | `ceiling` | `ceiling` |
| `deesser` | `frequency`, `threshold` | `frequency`, `threshold`, `listen` |
| `gate` | `threshold` | `threshold`, `range` |
| `dynamics` | `threshold`, `ratio` | `threshold`, `ratio` |
| `eq` | `gain`, `frequency` | `frequency`, `gain`, `q` |
| `filter` | `cutoffFrequency` | `cutoffFrequency` |
| `drive` | `drive` | `drive` |
| `delay` | `delay` | `delay`, `feedback` |
| `reverb` | `size`, `decay` | `size`, or `decay` |
| `pitch` | `shift` | `shift` |
| `modulation` | (any: a rotor's speeds and an LFO's shape have no meaning word yet) | `rate`, `depth` |

A declaration whose family none of its meanings backs is refused, naming the family and the
meanings it would need: a transient designer (attack and sustain amounts, no threshold, no ratio) is
not a compressor, so its family is `none`. Inference tries the families in the order of the table and
takes the first whose meanings are all there; none fits, `none`.

## One derivation: `describe`

`tools/describe.mjs` is the one function every surface calls: `describe(descriptor, { overrides, applyOverride, skin, panel })`
answers `{ description, refusals }` and never throws. The override layers go over the descriptor through omx-contract's
`applyOverride` (the caller passes it), the layout runs over the effective descriptor, and the skin applies last. The description is
the family, the `params` (each control's contract facts read from its `travel`: kind, unit and its token, scale, step, ends, default,
a choice's labels; `log` over a floor at or below zero is served linear), the sections, the controls, the roles, the displays and the
pages. A refusal is `{ code, args }`: `PANEL_NO_CONTROLS`, `PANEL_FAMILY_NOT_BACKED`, `PANEL_LAYOUT_INVALID`, a bar group's
`PANEL_BARS_*`, `PANEL_OVERRIDE_*`, `PANEL_ROLE_DROPPED`, `PANEL_SKIN_DROPPED`. The description is `null` only where no panel can be
made (no control, an invalid layout); a family the controls do not back is `none` with its refusal.

### The family of a plugin that declares no panel

One rule, the same on every surface, reading no list of plugins:

1. The candidate comes from what the plugin declares about itself, carried in the descriptor's extension bag (`extensions.lv2`:
   the class as a field or among `rdf:type`'s values; `extensions.clap["clap_plugin_descriptor.features"]`):

   | LV2 class / CLAP feature | Candidate |
   |---|---|
   | `lv2:EQPlugin`, `lv2:ParaEQPlugin` / `equalizer` | `eq` |
   | `lv2:CompressorPlugin` / `compressor` | `dynamics` |
   | `lv2:GatePlugin`, `lv2:ExpanderPlugin` / `gate` | `gate` |
   | `lv2:DistortionPlugin` / `distortion` | `drive` |

   A plugin that declares nothing in the table has no candidate; one that declares two families has a family only when exactly
   one of them passes step 2.
2. The candidate is kept only when every required role of the family (`REQUIRED_ROLES`) is mapped to a control, by a descriptor word
   or by the meaning inference below. Otherwise the family is `none` and the panel is the plain sections.
3. A declared panel, or a user's override naming a `family`, wins and is applied as the layout applies it.

The controls' meanings alone name no family for such a plugin: a plugin declares its class, or it has none.

### The band inference

A control with no `meaning` is read by `tools/meaning-infer.mjs` (only for a candidate `eq`): its symbol, name and unit give a band
role (frequency, gain, Q or width, type, on) and the band it belongs to, as the console's heuristic did. Every role it yields carries
`inferred: true`, with the contract token it reads the control in (`hz`, `db` or `coef` for a gain whose range stays above zero,
`oct` or `none`). A band whose shape no parameter selects carries `shape` on its `band_freq` role; a `band_type` role carries
`shapes`, one word per choice value from 0 (`off`, `bell`, `lowshelf`, `highshelf`, `highpass`, `lowpass`, `notch`, or `-`), read
from the choice's labels, so a curve function receives shapes and parses no label. The inference is a derivation, never stored; an
override file corrects it.

### Displays and their basis

A derived panel whose family has a closed form (`eq`, `dynamics`, `gate`, `drive`) gets its display (`eq_response` or
`transfer_curve`) on the section holding its first required role, once the required roles are mapped. Every display carries a
`basis`: `exact` only when an authored descriptor's declared section says `basis: exact` (the plugin's own audio runs the same closed
form), else `modelled`, which every surface prints in the display's caption place. `basis` is a view and stays out of the canonical
form.

## Bars

A section gains an optional `bars`: a list of runs `{ controls, labels, tied }`, one label and one `tied` list (the controls an
encoder changes beside the selected bar) per bar. Every bar is still a control of the section; the field stays out of the canonical
form and the fingerprint, and out of the CLAP extension.

The rule (`tools/bars.mjs`): inside one section, at least 4 controls one after another that are each a visible, writable `travel`
with the same ends, the same step (or all continuous), the same unit and the same scale, whose labels form one series: the same words
with one varying number (`Band 1 Gain`, `Step 1`: the label is the number), a known footage (`16'`, `5 1/3'`, `8'`, `4'`,
`2 2/3'`, `2'`, `1 3/5'`, `1 1/3'`, `1'`, also `DB <footage>`), or frequencies in strictly rising order (`100 Hz`, `1k`, `1.2 kHz`).
A run of more than 16 is cut into runs of 16 (`MAX_BARS`). Runs over the same bands (the same length, different labels: an EQ's
gains, frequencies and Qs) are one group: the run whose controls have a level meaning (`gain`) takes the bars and the others are its
`tied`; with no meaning the first run in section order. Two runs over different bands are two groups. A declared section says
`"bars": true` (its controls, in order, are one run; the rule's checks still apply and a failing one refuses the layout by
`PANEL_BARS_TOO_FEW`, `_NOT_TRAVEL`, `_FACTS_DIFFER` or `_LABELS_NOT_SERIES`) or `"bars": false` (no inference there). A plugin that
declares no panel gets its skin package's `skin.json` section word, the same `bars`; a skin that rebuilds the sections gets its bars
recomputed over them, a failing `true` dropped by name.

## The widget

The widget is a step of its own, `widgetOf(control, declared)`, before any skin. It picks one of the
standard widgets, and a representation (a skin) draws it; the skins are not chosen here.

| Standard widget | Taken by |
|---|---|
| `knob` | a travel |
| `fader` | a travel the declared panel draws as a fader |
| `switch` | a toggle; a trigger (momentary) |
| `selector` | a choice |
| `meter` | a read-only travel in a level unit (`dB`, `dBFS`, `dBu`, `LUFS`) |
| `display` | any other read-only control |
| `curve` | a section's graph a host computes (`eq-curve`, `dynamics-curve`, `transfer-curve`) |
| `xy` | no descriptor word names a pair of controls yet; nothing takes it |

A meter carries its measurement (`peak`, `rms`, `vu`, `ppm`, `lufs`): `lufs` for a LUFS reading.
The descriptor has no word for the others, so any other meter's measurement is `null`, not a guess.

What a face serves keeps the extension's widget enum: `knob`, `fader` and `switch` as they are, a
`selector` as `auto` (a CLAP selector needs `CLAP_PARAM_IS_ENUM`, which the faces do not set).

## Sections with no declared panel

Each distinct `group` path is a section, in the order its first control comes; its label is the path
joined with ` / `, its key the path's segments in the key grammar, joined with dots. Controls with no
group go to a section `controls`. A hidden control is left out. The layout also carries the ports: the
audio inputs and outputs with their channels, whether one is a side-chain, and the note inputs.

## Pages

`omx-panel layout --pages` cuts each section's controls, in the section's order, into pages of eight (the
CLAP remote-controls surface); a section of several pages numbers them (`Filter 1`, `Filter 2`). A
surface with another number of encoders asks for it: `--pages --per-page N` (`perPage` in
`schema/panel.schema.json`, default 8). Then a group that fits a page is not split across two (the page
ends early), a group wider than N is cut, and a section of several pages names each page by the controls
it holds (`Band: Freq - Q`). Every page carries N slots, a short page's last ones `null`. Left out, the
output is the plain cut of eight, unchanged.

## Visibility

A declared panel can show a control only while another control holds certain values: `visibleWhen`, control
symbol to a rule (`visibleWhen` in `schema/panel.schema.json`). `{ "param": "mode", "values": [1, 2] }` shows it while
`mode` is 1 or 2; `{ "param": "eqBands", "atLeast": 5 }` shows it while `eqBands` is 5 or more, so a band's controls
follow a band count and the rule does not go stale when the count's maximum moves. `param` is an integer or toggle
parameter of the plugin (a choice, a toggle, or a travel with step 1), every value is 0 to 63, and a rule states one of
`values` or `atLeast`; anything else is refused by name. The layout carries the rule as the extension's `visible` (the
governing parameter's id) and `mask` (bit v set: shown while the value is v; `atLeast: n` sets bits n to 63), both in the
fingerprint, and as `visibleWhen: { symbol, default }`, the governing control and its come-up value, for a renderer.

The pages follow: a control the governing values hide takes no slot, and a section left with no control has no page.
`omx-panel layout --pages --value eqBands=9` cuts at those values; a governing control left out reads its come-up value.
A host cuts again when a governing value changes (a CLAP face announces its remote-controls changed). With a strip's
band controls in band order, five a band, a band count of 4 gives the same page boundaries as before, with no hidden band
on any page. The MOD GUI shows and hides each governed control as its governing port changes, and its screenshot draws
the controls the come-up values show.

## The Easy face

`tools/easy.mjs` picks the handful of controls a plugin opens on; every control is one click away, on the same processor.
`easyOf` returns their symbols, and the layout carries them as `easy`. The first that answers wins:

1. **Declared**: the declared panel's `easy`, else the descriptor's. At most 8. A list that names no control of the panel, a
   control no face can set, or one control twice is refused by name, never trimmed.
2. **Roles**: the family's row below, each role that is mapped, at most 6. An indexed role with more members than places takes
   them evenly spaced, both ends included, so a 31-band graphic shows its whole span.
3. **Order**: when the roles gave fewer than 4, the first controls in layout order fill up to 4.

| Family | Roles, in order |
|---|---|
| `gate` | `threshold`, `range`, `attack`, `release` |
| `dynamics` | `threshold`, `ratio`, `makeup`, `mix`, `attack`, `release` |
| `limiter` | `ceiling`, `threshold`, `release`, `output` |
| `deesser` | `frequency`, `threshold`, `range`, `mix` |
| `eq` | `band_gain`, `output` |
| `filter` | `cutoff`, `resonance`, `filter_type`, `mix` |
| `drive` | `drive`, `tone`, `model`, `mix` |
| `modulation` | `rate`, `depth`, `feedback`, `mix` |
| `delay` | `time`, `feedback`, `tone`, `mix` |
| `reverb` | `size`, `decay`, `damping`, `mix` |
| `pitch` | `shift`, `fine`, `mix` |

A face can set any control that is not a reading, a trigger or a bypass. The list is a view of the panel, so it stays out of
the canonical serialisation and the fingerprint.

`omx-panel layout --pages --easy-first` puts the Easy controls first, on pages named `Easy`, `Easy 2`, with no control on two
pages; a scanned descriptor takes the `easy` of the descriptor the plugin's package installed under the same plugin id, as a scan
has nothing to read one from. Without the flag the pages are the page rule's. `omx-panel modgui --easy-first` draws the Easy
controls as a MOD GUI's first section and lists them as `modgui:port`.

## Verbatim

For omx-plugins' plugins the descriptor carries what the declaration did, so every generated header,
every built face's description, every MOD GUI and its rasters stay byte-identical when omx-plugins lays
them out through this package; its own `--check` runs hold that.

`test/panel-layout.test.mjs` (`make test`) holds each rule above by value, with an arm per rule that
breaks its input and reads the result change; it lays out omx-contract's example descriptors
(`test/fixtures/descriptors/`, scanned CLAP and LV2, a built instrument). The rule over omx-plugins' own
plugins, which loads their declarations, stays in omx-plugins.
