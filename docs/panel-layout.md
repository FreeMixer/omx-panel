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
extension's vendor block (`dBu`, `ratio`); it is served when the extension's header,
`omx_param_contract.h`, gives the token a value. So a unit that table or that block knows (`LUFS`, `dBu`
among them) is checked like any other. A unit with no token there, `unknown` included, takes no role and
is drawn as a plain number. Nothing here types a unit: the reader reads the installed table
(`$PLUGIN_HOSTD_TABLES` stands in for it) and the installed header (`$OMX_PARAM_CONTRACT_H` stands in
for it), and refuses by name when either is missing.

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

## Verbatim

For omx-plugins' plugins the descriptor carries what the declaration did, so every generated header,
every built face's description, every MOD GUI and its rasters stay byte-identical when omx-plugins lays
them out through this package; its own `--check` runs hold that.

`test/panel-layout.test.mjs` (`make test`) holds each rule above by value, with an arm per rule that
breaks its input and reads the result change; it lays out omx-contract's example descriptors
(`test/fixtures/descriptors/`, scanned CLAP and LV2, a built instrument). The rule over omx-plugins' own
plugins, which loads their declarations, stays in omx-plugins.
