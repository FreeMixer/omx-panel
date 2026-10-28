<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Port-group inference for LV2 plugins

Most installed LV2 plugins declare no port groups, so a consumer that draws screens per group (the Zynthian
touchscreen cuts each group into screens of four) shows them as screens of four in port order.
`tools/group-infer.mjs` (`@openmixer/omx-panel/group-infer`) infers the groups such a plugin lacks from what it
already states, or says it cannot with confidence. It is the rule set of plugin-hostd#218 (lane G1): a pure
function, no file written. The bundle that carries the result to lilv is the next lane's (G2).

```js
import { readBundle } from '@openmixer/omx-panel/modgui-import';
import { inferGroups, pluginUris, readPluginPorts, readModguiLayout } from '@openmixer/omx-panel/group-infer';

const triples = readBundle('/usr/lib64/lv2/fil4.lv2');            // the bundle's TTL, through tools/turtle-read.mjs
for (const uri of pluginUris(triples)) {
  const verdict = inferGroups(readPluginPorts(triples, uri), readModguiLayout(triples, uri));
}
```

## The inputs

- **The ports** (`readPluginPorts`): per port its `lv2:symbol`, `lv2:name`, `lv2:index`, whether it is a control
  input, `lv2:designation`, `units:unit`, the `pg:group` it already has, and `pprops:notOnGUI`; and per group node the
  plugin states, its `lv2:symbol`, `lv2:name` (else `rdfs:label`) and `lv2:displayPriority`.
- **The MOD GUI layout** (`readModguiLayout`): the ports the plugin's own `modgui:gui` puts on its face, in their
  order, or `null` when the plugin has none (a `modgui:gui` on the plugin's URI, the test omx-modgui-sync makes).

The rules place the **placeable controls**: control input ports, not marked `notOnGUI`, and not driven by the host
(`lv2:enabled`, the touchscreen's bypass; `lv2:freeWheeling`, `lv2:latency`, `param:bypass`, `param:sampleRate`, the
`time:` designations). A port that is not placeable needs no group.

## The verdict

- `{ outcome: 'nothing-to-do', reason }`: `own-groups-complete` (every placeable control already carries a `pg:group`
  whose node has an `lv2:symbol`, which is what the touchscreen needs), `fits-one-screen` (four placeable controls or
  fewer and no groups: one screen already holds them) or `no-controls`. The plugin is left exactly as it is. Our own
  omx-plugins bundles are the first case: their groups carry `lv2:symbol` and `rdfs:label`, and the missing
  `lv2:name` and `lv2:displayPriority` are added at their source, in omx-plugins.
- `{ outcome: 'grouped', groups, placedBy }`: each group has `symbol` (an `lv2:symbol`), `name` (its `lv2:name`),
  `displayPriority` (its `lv2:displayPriority`), `ports` (its members **by port symbol**, never by blank node: a
  plugin's ports are anonymous nodes, their symbols are stable), `rule` (the rule that made it) and, for a group the
  plugin itself states, `node` (that node). `placedBy` maps each control's symbol to the rule that placed it.
- `{ outcome: 'no-confident-grouping', reason, detail, attempt }`: the plugin is left exactly as it is, never given a
  guessed layout. `attempt` is what the rules found, for a diagnosis only.

Groups are ordered by their first control's `lv2:index`, the order the plugin's author chose and the touchscreen shows
today. `displayPriority` (higher is shown first): when every group the plugin states itself carries an
`lv2:displayPriority`, those keep theirs and the generated groups follow below the lowest of them, in port order;
otherwise every group counts down from the number of groups, in port order, so the first group is shown first. A
generated group under a plugin's own priorities therefore shows after all of the plugin's groups, even when its
controls come first in port order: the plugin's stated order is its author's word, and ours is only inferred, so ours
never outranks it.

## The rules, in this order

Each rule sees only the controls no earlier rule placed, and never moves a control an earlier rule placed. A rule
never makes a group of fewer than two controls, nor one holding every control (that is the plugin as it is, with a
title).

1. **The plugin's own `pg:group` assignments**, partial or whole. The plugin's node, symbol and name are kept, and its
   priority as above;
   a node with no `lv2:symbol` gets one from its IRI.
2. **`lv2:designation`**, through the LV2 parameters vocabulary: attack, decay, sustain, release, hold and delay are an
   Envelope (attack, release and hold are Dynamics in a plugin that also designates a threshold or a ratio);
   threshold and ratio Dynamics; cutoff frequency and resonance a Filter; waveform, pulse width, frequency and
   amplitude an Oscillator; gain, wet, dry and wet/dry an Output.
3. **A shared name or symbol prefix**, in four passes (`PREFIX_PASSES`): the symbol's trailing number, the name's
   trailing number, the name's leading word, the symbol's leading word. The symbol's number comes first because a
   symbol numbers a band the same way on every control (`xs_9`, `g_9`) where a name may print its frequency
   ("Band gain 1K", "31.5") and number nothing:
   - a shared trailing number, when it is the only number in the name and the plugin repeats it (at least two numbers,
     each on at least two controls): one group per number. The label's number is the names' own when the
     names number the same controls into the same groups (swh's `f0`, `fb0` are "Frequency 1", "Feedback 1": "Group
     1"), else the pass's, counted from 1 when a symbol counts from 0. Its word is the first word every name of the
     group starts with ("Band 1 gain" -> "Band 1"), else a section word among its controls' names or symbols
     (`SECTION_WORDS`: band, section, channel, ch, osc, oscillator, voice, step, tap, stage, lfo, env, envelope,
     part, layer, op, operator; so "Frequency 1", "Gain 1", "Section 1" are "Section 1"), else "Group". A stem is
     numbered only when its whole pattern is: every control whose word after the stem starts with a digit lands in a numbered group, or the pass
     places none of that stem's controls ("Band gain 16" ... "Band gain 1K" is left to the next pass). And the numbers
     must be one numbering: the pattern is the number set most stems carry; a stem with it, or with it less its last
     number (the last band lacking a control), belongs; a stem numbered inside it but fewer is another thing (mixtri's
     two triggers) and is left to the next pass; a stem numbered outside it is an unrelated numbering (AMS advenv:
     attack stages 1-4, release stages 1-3) and the pass places nothing; and every numbered group holds the same stems,
     at most one group lacking one;
   - a shared leading word ("Highpass Frequency", "Highpass Resonance"), or the first two when the second is a number
     and more follows ("Band 1 Freq", `b1_freq`); a control whose whole name is that word joins it ("Highpass").
     When every control of an earlier group shares the key, the controls join that group rather than cut the
     section in two ("VCF Freq" and "VCF Reso", rule 2's Filter, take "VCF Env"); a key two earlier groups share
     joins neither.
4. **A shared `units:unit`** (the same IRI): Hz is Frequency, dB Level, ms and s Time, % and coef Amount, degree
   Phase, semitone and octave Pitch, cent Tuning; another unit is named by its label.
5. **A contiguous run of `lv2:index`**: controls next to each other in index order (other ports between them do not
   break a run), none placed: "General" at the start of the plugin, "More" elsewhere. A run carries no meaning of its
   own; it fills the gaps between groups the plugin's words found.
6. **The plugin's own MOD GUI layout**: the controls its face shows are "Main", the ones it leaves off "More".

The order is part of the contract: `inferGroups(plugin, modgui, { rules, prefixPasses })` takes another order of the
rules, or of rule 3's passes, for tests only.

## Confident

A grouping is confident, and returned, only when all of these hold; the thresholds are constants of the module, each
with its reason:

| constant | value | the grouping must | why |
|---|---|---|---|
| `MAX_UNPLACED` | 0 | place every placeable control | an unplaced control falls into the consumer's catch-all ("Params") beside ours, a layout nobody inferred |
| `MIN_GROUP_SIZE` | 2 | (not checked: no rule creates a group under it; the plugin's own groups are kept whatever their size) | a screen with one control is worse than port order |
| `MIN_GROUPS` | 2 | have at least two groups | one group is the plugin as it is, with a title |
| `MAX_GROUPS` | 32 | have at most 32 groups | a ceiling, not a need: 32 screens of sections is already more than an operator pages through. A 32-band equaliser with its input and output groups does not fit (LSP's x32 needs 36) and is refused; wider, the rules are more likely slicing a sequencer or a matrix |
| `MAX_INDEX_RUN_SHARE` | 0.5 | place at most half its controls by rule 5 | when index runs are most of the plugin, the grouping is port order cut at arbitrary points |
| `SCREEN_SIZE` | 4 | (not asked: four controls or fewer is nothing to do) | one touchscreen screen holds four |

Otherwise the verdict names the first condition that failed: `unplaced-controls`, `too-few-groups`,
`too-many-groups` or `mostly-by-index`.

## Measured

Over the 979 plugins installed on a Fedora 44 desk (2026-10-28): 333 fit one screen, 98 have no controls, 40 carry
their own complete groups (all 19 of omx-plugins among them), 84 are grouped, and 424 have no confident grouping
(400 with controls left in no group, 21 mostly by index, 3 with more than 32 groups). The thresholds favour leaving a
plugin alone over a guess; loosening `MAX_UNPLACED` is the one change that would group most of the rest.

The tests (`test/group-infer.test.mjs`) run the rules over TTL copied from installed plugins: swh, Calf, x42, CAPS,
ZamAudio, MDA, LSP and our own (`test/fixtures/lv2-groups`, provenance and licences in its `SOURCES`).
