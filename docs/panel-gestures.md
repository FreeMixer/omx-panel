# One gesture vocabulary

Every surface moves a panel's controls with one set of gestures, declared once here and in `schema/gestures.json`; each
surface maps its own inputs onto it. `tools/gestures.mjs` is the reference: given a control and a script of events with
timestamps, it answers the value in the control's own unit and the begin and end of each gesture. Every surface is
checked against it, and the parity fixtures carry scripted gestures (`test/fixtures/gestures/scripts.json`). A panel
description gains nothing: the table is keyed by the standard widget, and by a bar and a curve handle bound by their roles.

The console's own gesture table (`2026-08-04-processing-view-layout.md` §9) is the law this conforms to. It adds two
things to it: painting across a bar group, and the timings declared here.

## The words

| Word | What it is |
|---|---|
| `drag` | Move the value with the pointer, relative to where the drag began. |
| `fine` | A drag at 0.3 of the drag. |
| `step` | One declared step, else 1% of the normalised travel; coarse is 5 steps. A wheel notch, an encoder detent and an arrow key are one `step`. |
| `second` | A handle's Q, by pinch, encoder 3, a wheel on the node or Shift with the arrows. |
| `reset` | The declared default; nothing for a control that declares none. A band's reset is its gain: frequency and Q keep. |
| `more` | The surface's precise editor or menu. Never a value change. |
| `select` | Select a bar or a handle. Never a value change. |
| `toggle` | Flip a switch. |
| `paint` | A drag that leaves the pressed bar's column. |

## The table

| Widget | Gestures |
|---|---|
| `knob`, `fader` | drag; fine (Shift, or the fine-mode toggle, or two fingers vertical); step (wheel, detent, arrow; Shift is coarse); reset (double-tap, Backspace); select (tap); more (long-press) |
| `selector` | drag across the options; step; reset; select; more |
| `switch` | toggle (tap, on release inside); reset (Backspace); more |
| `xy` | drag; fine; step; reset; select; more |
| `meter`, `display`, `curve` | none: a read-only control takes no gesture |
| `bar` | drag within the column; paint (a drag that leaves it); fine; step; reset; select (tap); more |
| `handle` | drag (frequency and gain); fine; step (arrows: up and down the gain, left and right the frequency); second (pinch, encoder 3, wheel on the node, Shift+arrows); reset; select; more |

`bar` is a bar group's bar (the `band_gain` of a graphic EQ, an organ's drawbar); `handle` is a curve's node (a band's
`band_freq`, `band_gain` and `band_q` together). `schema/gestures.json` holds the table; a section-word exception may be
layered on it there, and none is used.

## The rules

- A tap acts on release inside its target. It selects a bar or a handle and never changes a value; a release outside the
  target is nothing.
- A drag starts past 10 px. The 10 px are dead travel: the value moves from the point the threshold was crossed.
  The travel of a knob or a fader is its drawn length, which the surface gives (200 px when it gives none).
- A read-only control takes no gesture. The reference refuses with `GESTURE_READ_ONLY` and changes nothing.
- A reset is the declared default. A control that declares none refuses with `GESTURE_NO_DEFAULT`.
- Painting. A drag that leaves the pressed bar's column paints: every bar the pointer enters takes its height, absolute,
  and a column jumped over in one event is entered at the height on the line between. The pressed bar keeps the height
  it had in its column. Painting is required on touch and optional with a mouse (`paintWithMouse`); a surface that
  turns it off for touch is refused. One sweep is one gesture id across all its bars, so one undo entry; a reset is its
  own entry.
- Pinch. A pinch is two pointers of one type that both began inside the control's target within the palm guard. Anything
  else is not a pinch. The spread of the two pointers scales Q.
- Ownership. A control belongs to the pointer, or the touch-sensed hardware fader, that pressed it. A later press on it
  is refused with `GESTURE_CONTROL_OWNED`, as one corrector refuses another. Two people are two pointers. Gloves and wet
  fingers: no claim. After a step the control is the stepper's through the claim.
- A control marked `hold` acts only when held the safety hold; a shorter press is refused with `GESTURE_HOLD_SHORT`.
  It has no long-press: the hold is its press.
- Steps of one source within the claim are one gesture, one undo entry.

## The timings

Declared defaults in `schema/gestures.json`; no component keeps a timing constant. Each surface shows them in its own
settings, and `/surface/gestures` carries `holdMs`.

| Timing | Default | |
|---|---|---|
| `longPressMs` | 500 ms | A press held this long without a drag is a long-press: `more`. |
| `doubleTapMs` | 300 ms | A second tap that begins within this of the first tap's release is a double-tap. |
| `palmGuardMs` | 300 ms | Two pointers that begin within this of each other can be a pinch; a later one is refused. |
| `safetyHoldMs` | 800 ms | The hold a `hold` control needs. A surface may lengthen it; `timingsOf` refuses less than the declared floor (800 ms). |
| `claimMs` | 300 ms | How long a stepped control stays the stepper's and shows its value text. |

## Shown while touched

From press to release, and through the claim after a step, the control shows its value text clear of the finger. The drawn
value follows the finger; the read-back replaces it. The reference says so in each gesture: `shown` is
`{ from, until, clearOfFinger, drawnFollowsFinger, readBackReplaces }`, `until` the release (or the last step plus the
claim).

## The reference

```js
import { runGesture, timingsOf, withinStep } from '@openmixer/omx-panel/gestures';

const r = runGesture(control, script, { timings: { safetyHoldMs: 1000 }, paintWithMouse: false });
// r.value, r.begin, r.end, r.gesture, r.gestures[{ id, word, begin, end, changes, shown }], r.undo, r.selected, r.refused
```

A control is `{ widget, min, max, def, scale, step, value, target, travelPx }`, a `handle` has `freq`, `gain` and `q`
members and a `plot`, a `bar` has `bars`. `memberOf(descriptorControl)` builds a member from a descriptor control's own
travel. The events are pointer `down`, `move` and `up` (with `id`, `ptype`: `touch`, `mouse`, `pen` or `fader`, and `fine`),
`wheel` and `detent` (`n`, `coarse`, `encoder`), and `key`.

## The parity check

On each surface the value of a scripted gesture is within one declared step of the reference in the control's own unit
(`withinStep`), and a reset or a tap is exact. The scripts are in `test/fixtures/gestures/scripts.json`, one set per fixture
of the parity check: an omx-eq band (drag, fine, reset, step, second), an omx-comp threshold, an 8-band bar group (a sweep,
a tap, a reset) and setBfree's drawbars (a sweep, a tap, a double-tap). The expected values are worked from the declared
travel, not taken from the module.
