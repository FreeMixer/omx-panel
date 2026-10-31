<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Compare A/B/C/D and undo

`tools/compare.mjs` holds four unnamed sets of a processor's control values, and an undo ring, as pure functions: a
document and the running values in, a new document and the parameter moves out. A host reads its values, calls the
function, applies the moves through its own parameter door, and stores the document with its session. It works for any plugin:
it only ever moves parameters. Presets are not touched.

JavaScript imports `@openmixer/omx-panel/compare`. Any other host runs the command, one JSON object in, one out:

```
omx-panel compare switch --to B     { "doc": ..., "values": { ... } }
omx-panel compare copy --to C       { "doc": ..., "values": { ... } }
omx-panel compare undo              { "ring": ..., "captures": [ { ... } ], "values": { ... } }
omx-panel compare redo              { "ring": ..., "values": { ... } }
                                 -> { "doc": ..., "ring": ..., "moves": [ { "symbol": "ratio", "value": 3 } ], "unknown": [ ] }
```

Leave out `doc` or `ring` for a new one. `captures` is a queue of value sets to take before the step, in order, so a
host starts no process while a knob turns. A refusal exits 1 and names its code on stderr; a usage error exits 2.

## The document

```json
{ "format": "org.openmixer.compare/1", "active": "A",
  "slots": { "A": { "threshold": -18, "ratio": 3 }, "C": { "threshold": -30, "ratio": 8 } } }
```

`slots` holds the slots used. Values are finite numbers, under whatever key the host names a control by.

## The operations

| Function | Does | Moves |
|---|---|---|
| `switchTo(doc, values, to)` | stores the running values in the slot left and makes `to` the running one | one per control that differs from `to`, sorted by symbol; none when `to` is empty, which takes a copy |
| `copyTo(doc, values, to)` | puts the running values in `to` | none |
| `capture(ring, values)` | keeps the values as a step; the same values twice are one step, and a new step ends what could be redone; at most 64 | none |
| `undo(ring, values)`, `redo(ring, values)` | steps back or forward, keeping the running values on the other side | to the step's values; none at either end |

A control a slot holds that the running plugin does not is named in `unknown`, not moved, and kept in the slot. A control the
slot lacks keeps its value.

| Refusal | When |
|---|---|
| `COMPARE_NO_SLOT` | a slot that is not `A`, `B`, `C` or `D` |
| `COMPARE_FORMAT` | a document of another format |
| `COMPARE_VALUE` | a value that is no finite number |
| `COMPARE_COPY_TO_RUNNING` | a copy onto the slot running |

Only parameters move: a plugin's non-parameter state stays where it is, so a plugin whose sound lives in its state compares
only what its parameters reach.
