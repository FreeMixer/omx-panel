// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The one gesture vocabulary (one-panel spec 7.8): schema/gestures.json is the table and the timings, tools/gestures.mjs
 * the reference. Each rule has its test and each guard its arm, a test that goes red when what it protects is broken:
 *   the fine ratio, the palm guard, the safety-hold floor, a tap that changes a value, a read-only control taking a
 *   gesture, a bar sweep split into several gesture ids, a timing literal outside gestures.json.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GESTURES, GESTURE_CODES, GestureError, memberOf, runGesture, timingsOf, wordOf, stepOf } from '../dist/tools/gestures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const d = (t, id, x, y, ptype = 'touch') => ({ t, type: 'down', id, ptype, x, y });
const m = (t, id, x, y, ptype = 'touch', fine) => ({ t, type: 'move', id, ptype, x, y, ...(fine ? { fine: true } : {}) });
const u = (t, id, x, y, ptype = 'touch') => ({ t, type: 'up', id, ptype, x, y });
const tap = (t, id, x, y, ptype = 'touch') => [d(t, id, x, y, ptype), u(t + 60, id, x, y, ptype)];
/** Floats rounded to nine places, so a value compares as the number it is. */
const r9 = (v) => (typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r9(x)])) : Math.round(v * 1e9) / 1e9);

const knob = (extra = {}) => ({ widget: 'knob', min: 0, max: 100, def: 50, value: 20, travelPx: 200, target: { x: 0, y: 0, w: 40, h: 220 }, ...extra });
const handle = (q = 2) => ({
  widget: 'handle', target: { x: 0, y: 0, w: 60, h: 60 }, plot: { w: 400, h: 200 },
  freq: { min: 20, max: 20000, def: 120, scale: 'log', value: 500 }, gain: { min: -18, max: 18, def: 3, value: 9 }, q: { min: 0.3, max: 16, def: 1, scale: 'log', value: q },
});

// ---- the declaration -------------------------------------------------------------------------------------------

test('the timings are the declared defaults: long-press 500, double-tap 300, palm guard 300, safety hold 800 with a floor', () => {
  assert.deepEqual(timingsOf(), { longPressMs: 500, doubleTapMs: 300, palmGuardMs: 300, safetyHoldMs: 800, claimMs: 300 });
  assert.equal(GESTURES.timings.safetyHoldMs.floor, 800);
  assert.deepEqual(GESTURES.thresholds, { dragStartPx: 10, fineRatio: 0.3, stepFraction: 0.01, coarseSteps: 5, defaultTravelPx: 200 });
});

test('a surface may lengthen the safety hold and the others; it is refused below the floor, and an unknown name is refused', () => {
  assert.equal(timingsOf({ safetyHoldMs: 1200, longPressMs: 400 }).safetyHoldMs, 1200);
  assert.throws(() => timingsOf({ safetyHoldMs: 799 }), (e) => e instanceof GestureError && e.code === GESTURE_CODES.holdBelowFloor);
  assert.throws(() => timingsOf({ safetyHoldMs: 500 }), /below the declared floor 800/);
  assert.throws(() => timingsOf({ holdMs: 900 }), (e) => e.code === GESTURE_CODES.badSetting);
  assert.throws(() => timingsOf({ longPressMs: 0 }), (e) => e.code === GESTURE_CODES.badSetting);
});

test('the table is keyed by standard widget plus a bar and a handle; every cell is a declared word of a declared input', () => {
  const panelLayout = readFileSync(join(ROOT, 'docs/panel-layout.md'), 'utf8');
  const at = panelLayout.indexOf('| Standard widget |');
  const section = panelLayout.slice(at, panelLayout.indexOf('\n\n', at));
  const standard = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((x) => x[1]);
  assert.deepEqual(standard, ['knob', 'fader', 'switch', 'selector', 'meter', 'display', 'curve', 'xy']);
  assert.deepEqual(Object.keys(GESTURES.table).sort(), [...standard, 'bar', 'handle'].sort());
  for (const [widget, row] of Object.entries(GESTURES.table)) {
    for (const [input, word] of Object.entries(row)) {
      assert.ok(GESTURES.inputs.includes(input), `${widget}.${input} is no declared input`);
      assert.ok(word in GESTURES.words, `${widget}.${input} is '${word}', no declared word`);
    }
  }
  assert.deepEqual(Object.keys(GESTURES.words), ['drag', 'fine', 'step', 'second', 'reset', 'more', 'select', 'toggle', 'paint']);
});

test('a wheel notch, an encoder detent and an arrow key are one step, on every control that steps', () => {
  for (const widget of ['knob', 'fader', 'selector', 'bar']) {
    for (const input of ['wheel', 'wheelCoarse', 'detent', 'detentCoarse', 'arrow', 'arrowCoarse']) assert.equal(wordOf({ widget }, input), 'step', `${widget} ${input}`);
  }
});

test('the schema widget enum is the list docs/panel-layout.md gives', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema/panel.schema.json'), 'utf8'));
  assert.deepEqual(schema.$defs.widget.enum, ['knob', 'fader', 'switch', 'selector', 'meter', 'display', 'curve', 'xy']);
});

test('no section-word exception is used', () => {
  assert.deepEqual(GESTURES.exceptions, []);
  const exception = { ...GESTURES, exceptions: [{ section: 'x', widget: 'knob', input: 'doubleTap', word: 'more' }] };
  assert.ok(exception.exceptions.length === 1 && wordOf({ widget: 'knob', section: 'x' }, 'doubleTap') === 'reset', 'the table answers while none is declared');
});

// ---- the scripted gestures of the parity fixtures ---------------------------------------------------------------

const SCRIPTS = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/gestures/scripts.json'), 'utf8')).scripts;
const descriptor = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const travelOf = (dsc, symbol) => dsc.controls.find((c) => c.symbol === symbol).travel;

/** A fixture's control, built from its descriptor's own travels and the surface geometry the script file gives. */
function controlOf(s) {
  const c = s.control, dsc = s.descriptor ? descriptor(s.descriptor) : null;
  if (c.widget === 'handle') {
    const one = (k) => memberOf({ travel: travelOf(dsc, c.members[k]) }, c.start[k] !== undefined ? { value: c.start[k] } : {});
    return { widget: 'handle', target: c.target, plot: c.plot, freq: one('freq'), gain: one('gain'), q: one('q') };
  }
  if (c.widget === 'bar' && c.members) return { widget: 'bar', bars: c.members.map((b) => ({ ...b, ...(c.start?.[b.symbol] !== undefined ? { value: c.start[b.symbol] } : {}) })) };
  if (c.widget === 'bar') {
    const { w, pitch, h } = c.geometry;
    return { widget: 'bar', bars: c.symbols.map((symbol, i) => memberOf({ travel: travelOf(dsc, symbol) }, { symbol, target: { x: i * pitch, y: 0, w, h }, ...(c.start[symbol] !== undefined ? { value: c.start[symbol] } : {}) })) };
  }
  return { widget: c.widget, ...memberOf({ travel: travelOf(dsc, c.member) }, { target: c.target, travelPx: c.travelPx, ...(c.start.value !== undefined ? { value: c.start.value } : {}) }) };
}
const membersOf = (control) => (control.widget === 'handle' ? { freq: control.freq, gain: control.gain, q: control.q } : control.widget === 'bar' ? Object.fromEntries(control.bars.map((b) => [b.symbol, b])) : { value: control });

for (const s of SCRIPTS) {
  test(`fixture script: ${s.name}`, () => {
    const control = controlOf(s);
    const r = runGesture(control, s.script, s.mouse ? { paintWithMouse: false } : {});
    const want = typeof s.expect.value === 'object' ? s.expect.value : { value: s.expect.value };
    const got = typeof r.value === 'object' ? r.value : { value: r.value };
    for (const [key, w] of Object.entries(want)) {
      const mem = membersOf(control)[key];
      if (s.expect.tolerance === 'exact') assert.equal(got[key], w, `${key} exact`);
      else assert.ok(Math.abs(mem.scale === 'log' ? Math.log(got[key] / w) / Math.log(mem.max / mem.min) : (got[key] - w) / (mem.max - mem.min)) <= (mem.integer ? 1 / (mem.max - mem.min) : mem.step && mem.scale !== 'log' ? mem.step / (mem.max - mem.min) : 0.01) + 1e-9, `${key}: ${got[key]} is within one declared step of ${w}`);
    }
    if (s.expect.word) assert.equal(r.gesture.word, s.expect.word);
    if (s.expect.selected !== undefined) assert.equal(r.selected, s.expect.selected);
    if (s.expect.gestures !== undefined) assert.equal(r.gestures.length, s.expect.gestures, 'gestures');
    if (s.expect.undo !== undefined) assert.equal(r.undo.length, s.expect.undo, 'undo entries');
    if (s.expect.changed) assert.deepEqual(Object.keys(r.gestures.at(-1).changes), s.expect.changed);
    assert.deepEqual(r.refused, [], 'nothing refused');
  });
}

test('every fixture of 7.5 that takes a gesture has scripts: omx-eq, omx-comp, the 8-band bar group, setBfree drawbars', () => {
  const names = SCRIPTS.map((s) => s.name).join('\n');
  for (const prefix of ['omx-eq band', 'omx-comp threshold', '8-band graphic EQ', 'setBfree']) assert.match(names, new RegExp(`^${prefix}`, 'm'));
  for (const word of ['drag', 'fine', 'reset', 'step', 'select', 'paint', 'second']) assert.ok(SCRIPTS.some((s) => s.expect.word === word), `a script ends in ${word}`);
});

// ---- the rules -----------------------------------------------------------------------------------------------

test('a drag starts past 10 px: ten is a tap, eleven is a drag', () => {
  const ten = runGesture(knob(), [d(0, 'p', 10, 10), m(20, 'p', 10, 0), u(40, 'p', 10, 0)]);
  assert.equal(ten.value, 20);
  assert.equal(ten.gesture.word, 'select', 'released inside the target: a tap');
  const eleven = runGesture(knob(), [d(0, 'p', 10, 20), m(20, 'p', 10, 9), m(40, 'p', 10, -11), u(60, 'p', 10, -11)]);
  assert.equal(eleven.gesture.word, 'drag');
  assert.ok(eleven.value > 20);
});

test('a drag measures from where the threshold was crossed, relative to the value, 200 px the whole travel', () => {
  const r = runGesture(knob(), [d(0, 'p', 10, 100), m(10, 'p', 10, 80), m(20, 'p', 10, 0), u(30, 'p', 10, 0)]);
  assert.equal(r9(r.value), 60, 'up 80 px past the crossing at y 80 is 40% of the 200 px travel');
  assert.deepEqual([r.begin, r.end], [0, 30], 'begins at the press, ends at the release');
});

test('arm: fine is 0.3 of the drag', () => {
  const run = (fine) => runGesture(knob(), [d(0, 'p', 10, 100), m(10, 'p', 10, 80, 'touch', fine), m(20, 'p', 10, 0, 'touch', fine), u(30, 'p', 10, 0)]).value - 20;
  assert.ok(Math.abs(run(true) / run(false) - 0.3) < 1e-9, `fine moved ${run(true)}, drag ${run(false)}`);
  assert.equal(runGesture(knob(), [d(0, 'p', 10, 100), m(10, 'p', 10, 80, 'touch', true), m(20, 'p', 10, 0, 'touch', true), u(30, 'p', 10, 0)]).gesture.word, 'fine');
});

test('a tap acts on release inside its target and never changes a value; a release outside is nothing', () => {
  for (const widget of ['knob', 'fader', 'selector', 'xy']) {
    const r = runGesture(knob({ widget }), tap(0, 'p', 5, 5));
    assert.equal(r.value, 20, `${widget}: a tap changes no value`);
    assert.equal(r.gesture.word, 'select');
    assert.deepEqual(r.undo, [], `${widget}: a tap is no undo entry`);
  }
  const away = runGesture(knob({ widget: 'switch', min: 0, max: 1, value: 0 }), [d(0, 'p', 5, 5), u(60, 'p', 90, 90)]);
  assert.equal(away.value, 0);
  assert.equal(away.gestures.length, 0);
  assert.equal(away.cancelled.length, 1);
  const on = runGesture(knob({ widget: 'switch', min: 0, max: 1, value: 0 }), tap(0, 'p', 5, 5));
  assert.equal(on.value, 1, 'a switch toggles on release');
});

test('reset is the declared default and nothing without one', () => {
  assert.equal(runGesture(knob(), [...tap(0, 'p', 5, 5), ...tap(150, 'p', 5, 5)]).value, 50);
  const none = runGesture(knob({ def: undefined }), [...tap(0, 'p', 5, 5), ...tap(150, 'p', 5, 5)]);
  assert.equal(none.value, 20);
  assert.equal(none.refused[0].code, GESTURE_CODES.noDefault);
  assert.equal(runGesture(knob(), [{ t: 0, type: 'key', key: 'Backspace' }]).value, 50);
});

test('a second tap after the double-tap window is a tap, not a reset', () => {
  const late = runGesture(knob(), [...tap(0, 'p', 5, 5), ...tap(60 + 300 + 1, 'p', 5, 5)]);
  assert.equal(late.value, 20);
  assert.equal(late.gesture.word, 'select');
  assert.equal(runGesture(knob(), [...tap(0, 'p', 5, 5), ...tap(60 + 300, 'p', 5, 5)]).value, 50, 'at the window is a double-tap');
});

test('a long-press is `more` at the long-press time and never a value change', () => {
  const r = runGesture(knob(), [d(0, 'p', 5, 5), u(700, 'p', 5, 5)]);
  assert.equal(r.gestures.length, 1);
  assert.equal(r.gesture.word, 'more');
  assert.equal(r.gesture.begin, 500);
  assert.equal(r.value, 20);
  assert.deepEqual(r.undo, []);
  assert.equal(runGesture(knob(), [d(0, 'p', 5, 5), u(499, 'p', 5, 5)]).gesture.word, 'select', 'shorter is a tap');
});

test('a band reset is its gain: frequency and Q keep', () => {
  const r = runGesture(handle(), [...tap(0, 'p', 30, 30), ...tap(150, 'p', 30, 30)]);
  assert.deepEqual(r.value, { freq: 500, gain: 3, q: 2 });
  assert.deepEqual(Object.keys(r.gesture.changes), ['gain']);
});

test('a step is the declared step or 1% of the normalised travel, coarse five', () => {
  assert.equal(r9(runGesture(knob(), [{ t: 0, type: 'wheel', n: 1 }]).value), 21);
  assert.equal(r9(runGesture(knob(), [{ t: 0, type: 'wheel', n: -1, coarse: true }]).value), 15);
  assert.equal(r9(runGesture(knob({ step: 0.5 }), [{ t: 0, type: 'detent', n: 2 }]).value), 21);
  assert.equal(runGesture(knob({ min: 0, max: 8, integer: true, value: 3, step: 1 }), [{ t: 0, type: 'key', key: 'ArrowUp' }]).value, 4);
  assert.ok(Math.abs(stepOf({ min: -60, max: 0, scale: 'linear' }, -18) - 0.6) < 1e-9, 'one step of a -60..0 dB travel is 0.6 dB');
  const claimed = runGesture(knob(), [0, 100, 250].map((t) => ({ t, type: 'detent', n: 1 })));
  assert.equal(claimed.gestures.length, 1, 'detents within the claim are one gesture');
  assert.equal(r9(claimed.value), 23);
  const apart = runGesture(knob(), [{ t: 0, type: 'detent', n: 1 }, { t: 301, type: 'detent', n: 1 }]);
  assert.equal(apart.gestures.length, 2);
});

test('the value text is shown from press to release, and through the 300 ms claim after a step; the drawn value follows the finger', () => {
  const drag = runGesture(knob(), [d(0, 'p', 10, 100), m(10, 'p', 10, 80), m(20, 'p', 10, 0), u(30, 'p', 10, 0)]).gesture;
  assert.deepEqual(drag.shown, { from: 0, until: 30, clearOfFinger: true, drawnFollowsFinger: true, readBackReplaces: true });
  const step = runGesture(knob(), [{ t: 40, type: 'detent', n: 1 }]).gesture;
  assert.deepEqual(step.shown, { from: 40, until: 340, clearOfFinger: true, drawnFollowsFinger: false, readBackReplaces: true });
});

// ---- ownership, pinch, the palm guard ---------------------------------------------------------------------------------

const pinch = (lateMs, ptype2 = 'touch') => runGesture(handle(2), [d(0, 'a', 20, 20), d(lateMs, 'b', 30, 30, ptype2), m(lateMs + 20, 'b', 40, 40, ptype2), u(lateMs + 40, 'b', 40, 40, ptype2), u(lateMs + 60, 'a', 20, 20)]);

test('a pinch is two pointers of one type, both inside the target, within the palm guard; Q follows the spread', () => {
  const r = pinch(100);
  assert.equal(r.gesture.word, 'second');
  assert.ok(Math.abs(r.value.q - 4) < 1e-9, `the spread doubled: ${r.value.q}`);
  assert.deepEqual([r.value.freq, r.value.gain], [500, 9]);
  assert.deepEqual(r.refused, []);
});

test('arm: a second pointer past the palm guard is refused, never a pinch', () => {
  const late = pinch(301);
  assert.equal(late.value.q, 2);
  assert.equal(late.refused[0].code, GESTURE_CODES.owned);
  assert.ok(late.gestures.every((g) => g.word !== 'second'));
  assert.equal(pinch(300).gesture.word, 'second', 'at the palm guard still a pinch');
});

test('a second pointer of another type, or outside the target, is not a pinch', () => {
  const pen = pinch(100, 'pen');
  assert.equal(pen.value.q, 2);
  assert.equal(pen.refused[0].code, GESTURE_CODES.owned);
  const outside = runGesture(handle(2), [d(0, 'a', 20, 20), d(50, 'b', 200, 200), u(80, 'b', 200, 200), u(90, 'a', 20, 20)]);
  assert.deepEqual(outside.refused, [], 'a press outside the target is not on the control at all');
  assert.equal(outside.value.q, 2);
});

test('a control belongs to the pointer that pressed it; a later press, even a hardware fader touch, is refused by name', () => {
  const r = runGesture(knob(), [d(0, 'a', 5, 5), d(100, 'b', 8, 8, 'mouse'), u(150, 'b', 8, 8, 'mouse'), u(200, 'a', 5, 5)]);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].code, GESTURE_CODES.owned);
  const fader = runGesture(knob({ widget: 'fader' }), [d(0, 'hw', 5, 5, 'fader'), d(20, 'finger', 5, 5, 'touch'), u(40, 'finger', 5, 5), u(60, 'hw', 5, 5, 'fader')]);
  assert.equal(fader.refused[0].code, GESTURE_CODES.owned);
  assert.equal(fader.gestures.length, 1, 'only the fader\'s tap');
  const encoder = runGesture(knob(), [d(0, 'a', 5, 5), { t: 50, type: 'detent', n: 1 }, u(100, 'a', 5, 5)]);
  assert.equal(encoder.refused[0].code, GESTURE_CODES.owned);
  assert.equal(encoder.value, 20);
});

test('after a step the control is the stepper\'s through the claim: a press in it is refused, one after is not', () => {
  const inside = runGesture(knob(), [{ t: 0, type: 'wheel', n: 1 }, ...tap(100, 'p', 5, 5)]);
  assert.equal(inside.refused[0].code, GESTURE_CODES.owned);
  const after = runGesture(knob(), [{ t: 0, type: 'wheel', n: 1 }, ...tap(300, 'p', 5, 5)]);
  assert.deepEqual(after.refused, []);
});

test('encoder 3, a wheel on the node and Shift+arrows are a handle\'s second (Q); a knob has none', () => {
  const q = (e) => runGesture(handle(2), [e]).value.q;
  assert.ok(q({ t: 0, type: 'detent', n: 1, encoder: 3 }) > 2);
  assert.ok(q({ t: 0, type: 'wheel', n: 1 }) > 2);
  assert.ok(q({ t: 0, type: 'key', key: 'ArrowDown', shift: true }) < 2);
  assert.equal(runGesture(handle(2), [{ t: 0, type: 'key', key: 'ArrowRight' }]).value.freq > 500, true);
  assert.equal(runGesture(knob(), [{ t: 0, type: 'detent', n: 1, encoder: 3 }]).refused[0].code, GESTURE_CODES.notInTable);
});

// ---- the safety hold ---------------------------------------------------------------------------------------------

test('a control with a safety hold acts only when held the hold; a surface may lengthen it', () => {
  const sw = (extra = {}) => knob({ widget: 'switch', min: 0, max: 1, value: 0, hold: true, ...extra });
  const held = (ms, settings) => runGesture(sw(), [d(0, 'p', 5, 5), u(ms, 'p', 5, 5)], settings);
  assert.equal(held(799).value, 0);
  assert.equal(held(799).refused[0].code, GESTURE_CODES.holdShort);
  assert.equal(held(800).value, 1);
  assert.equal(held(1000, { timings: { safetyHoldMs: 1200 } }).value, 0, 'a longer hold is the surface\'s');
  assert.equal(held(1200, { timings: { safetyHoldMs: 1200 } }).value, 1);
  assert.throws(() => held(900, { timings: { safetyHoldMs: 500 } }), (e) => e.code === GESTURE_CODES.holdBelowFloor);
});

// ---- read-only ----------------------------------------------------------------------------------------------------

test('arm: a read-only control takes no gesture, whatever the input', () => {
  const inputs = [
    [d(0, 'p', 5, 5), m(20, 'p', 5, -40), u(40, 'p', 5, -40)],
    tap(0, 'p', 5, 5),
    [...tap(0, 'p', 5, 5), ...tap(100, 'p', 5, 5)],
    [{ t: 0, type: 'wheel', n: 1 }],
    [{ t: 0, type: 'key', key: 'Backspace' }],
    [d(0, 'p', 5, 5), u(900, 'p', 5, 5)],
  ];
  for (const widget of ['meter', 'display', 'curve']) {
    for (const script of inputs) {
      const r = runGesture(knob({ widget }), script);
      assert.equal(r.value, 20, `${widget}`);
      assert.equal(r.gestures.length, 0, `${widget} took a gesture`);
      assert.ok(r.refused.length > 0 && r.refused.every((x) => x.code === GESTURE_CODES.readOnly), `${widget} refused by name`);
    }
  }
  for (const script of inputs) {
    const r = runGesture(knob({ readOnly: true }), script);
    assert.equal(r.value, 20);
    assert.equal(r.gestures.length, 0);
  }
});

// ---- painting ---------------------------------------------------------------------------------------------------------

const bars = (n = 8, extra = {}) => ({ widget: 'bar', bars: Array.from({ length: n }, (_x, i) => ({ symbol: `b${i}`, min: 0, max: 100, def: 0, value: 0, target: { x: i * 32, y: 0, w: 30, h: 200 }, ...extra })) });
const sweep = (ptype = 'touch') => [d(0, 'p', 15, 100, ptype), m(10, 'p', 20, 90, ptype), m(20, 'p', 47, 50, ptype), m(30, 'p', 79, 150, ptype), m(40, 'p', 111, 200, ptype), u(50, 'p', 111, 200, ptype)];

test('painting: a touch drag that leaves the pressed column paints every bar entered, absolute, in one gesture and one undo entry', () => {
  const r = runGesture(bars(), sweep());
  assert.deepEqual(r9(r.value), { b0: 55, b1: 75, b2: 25, b3: 0, b4: 0, b5: 0, b6: 0, b7: 0 });
  assert.equal(r.gestures.length, 1);
  assert.equal(r.gesture.word, 'paint');
  assert.deepEqual(r.undo, ['g1']);
  assert.deepEqual(Object.keys(r.gesture.changes), ['b0', 'b1', 'b2', 'b3']);
});

test('arm: a sweep is one gesture id across all its bars, never one per bar', () => {
  const r = runGesture(bars(), sweep());
  assert.equal(new Set(r.gestures.map((g) => g.id)).size, 1);
  assert.equal(r.undo.length, 1);
  const again = runGesture(bars(), [...sweep(), ...sweep().map((e) => ({ ...e, t: e.t + 1000 }))]);
  assert.equal(again.undo.length, 2, 'two sweeps are two entries');
});

test('a reset after a sweep is its own entry', () => {
  const r = runGesture(bars(), [...sweep(), ...tap(1000, 'q', 47, 100), ...tap(1150, 'q', 47, 100)]);
  assert.equal(r.gestures.map((g) => g.word).join(), 'paint,select,reset');
  assert.equal(r.value.b1, 0);
  assert.equal(new Set(r.undo).size, 2);
});

test('a column jumped over by one event is entered all the same, at the height on the line between', () => {
  const r = runGesture(bars(), [d(0, 'p', 15, 100), m(10, 'p', 20, 100), m(20, 'p', 146, 0), u(30, 'p', 146, 0)]);
  const onTheLine = (cx) => (200 - (100 - 100 * ((cx - 20) / (146 - 20)))) / 200 * 100;
  assert.equal(r.value.b0, 50, 'the pressed bar keeps the height it had in its column');
  for (const c of [1, 2, 3]) assert.ok(Math.abs(r.value[`b${c}`] - onTheLine(c * 32 + 15)) < 1e-9, `b${c} ${r.value[`b${c}`]}`);
  assert.equal(r.value.b4, 100);
  assert.equal(r.gestures.length, 1);
});

test('a mouse paints only when the surface asks; a touch surface that refuses to paint is refused', () => {
  const plain = runGesture(bars(), sweep('mouse'));
  assert.equal(plain.gesture.word, 'drag', 'a mouse drag moves the pressed bar and paints nothing');
  assert.equal(plain.value.b1, 0);
  assert.equal(runGesture(bars(), sweep('mouse'), { paintWithMouse: true }).gesture.word, 'paint');
  assert.throws(() => runGesture(bars(), sweep(), { paintWithTouch: false }), (e) => e.code === GESTURE_CODES.paintRequired);
});

test('a drag inside the pressed bar\'s column stays a drag of that bar; a bar tap selects and changes nothing', () => {
  const r = runGesture(bars(), [d(0, 'p', 15, 150), m(10, 'p', 15, 100), m(20, 'p', 15, 50), u(30, 'p', 15, 50)]);
  assert.equal(r.gesture.word, 'drag');
  assert.deepEqual(Object.keys(r.gesture.changes), ['b0']);
  const t = runGesture(bars(), tap(0, 'p', 79, 100));
  assert.equal(t.selected, 'b2');
  assert.deepEqual(Object.values(t.value), Array(8).fill(0));
});

// ---- the conformance greps ----------------------------------------------------------------------------------------------

/** Every timing literal that is not gestures.json: a gesture word beside a declared default, or a timer with a literal. */
export function timingLiterals(text) {
  const declared = Object.values(GESTURES.timings).map((t) => t.default).concat(Object.values(GESTURES.timings).map((t) => t.floor).filter(Boolean));
  const words = /long-?press|double-?tap|palm|safety|hold|claim|debounce|dwell/i;
  return text.split('\n').flatMap((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
    const timer = /\bset(Timeout|Interval)\s*\(.*,\s*\d+\s*\)/.test(line);
    const beside = words.test(line) && declared.some((n) => new RegExp(`(?<![\\w.])${n}(?![\\w.])`).test(line));
    return timer || beside ? [`${i + 1}: ${line.trim()}`] : [];
  });
}

function sources(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    const rel = relative(ROOT, path);
    if (e.isDirectory()) { if (['bin', 'lib', 'src', 'tools', 'renderer', 'etc', 'systemd'].includes(rel.split('/')[0]) && !/fonts|^renderer\/test/.test(rel)) sources(path, out); } else if (/\.(mjs|ts|c|h|js|py|sh|vue)$/.test(e.name) && rel.split('/').length > 1) out.push(rel);
  }
  return out;
}

test('no timing literal outside schema/gestures.json: the sources hold none', () => {
  const found = sources().flatMap((f) => timingLiterals(readFileSync(join(ROOT, f), 'utf8')).map((l) => `${f}:${l}`));
  assert.deepEqual(found, []);
});

test('arm: the timing-literal grep finds one planted in each shape, and passes the reference module', () => {
  assert.equal(timingLiterals('const longPressMs = 500;').length, 1);
  assert.equal(timingLiterals('if (t - down.t > 300) palm = true;').length, 1);
  assert.equal(timingLiterals('setTimeout(() => emit(), 120);').length, 1);
  assert.equal(timingLiterals('const holdMs = 800;').length, 1);
  assert.equal(timingLiterals('// the long-press is 500 ms').length, 0, 'a comment is not a constant');
  assert.equal(timingLiterals('const width = 300;').length, 0, 'a width is not a timing');
  assert.ok(sources().includes('tools/gestures.mjs'), 'the scan reads the module');
});

// ---- the docs ---------------------------------------------------------------------------------------------------------------

test('docs/panel-gestures.md names every widget row, word and timing it declares', () => {
  const md = readFileSync(join(ROOT, 'docs/panel-gestures.md'), 'utf8');
  for (const w of Object.keys(GESTURES.table)) assert.match(md, new RegExp(`\`${w}\``), `widget ${w}`);
  for (const w of Object.keys(GESTURES.words)) assert.match(md, new RegExp(`\`${w}\``), `word ${w}`);
  for (const [name, t] of Object.entries(GESTURES.timings)) {
    assert.ok(md.includes(`\`${name}\``), `timing ${name}`);
    assert.match(md, new RegExp(`${t.default} ms`), `${name} default ${t.default} ms`);
  }
  assert.match(md, /schema\/gestures\.json/);
  assert.match(md, /tools\/gestures\.mjs/);
  assert.match(md, /readBackReplaces/);
});

test('the MOD GUI draws the four widgets a plugin\'s parameters take, and refuses to be told a meter', async () => {
  const { widgetFor, DRAWN_WIDGETS } = await import('../dist/tools/modgui-gen.mjs');
  assert.deepEqual(DRAWN_WIDGETS, ['knob', 'fader', 'switch', 'selector']);
  const p = { kind: 'integer', min: 0, max: 4, step: 1 };
  assert.equal(widgetFor({ widgets: { a: 'selector' } }, 'a', p), 'selector');
  assert.throws(() => widgetFor({ widgets: { a: 'meter' } }, 'a', p), /does not draw/);
});

test('the gesture guard refuses a gesture-less widget NAMED for a parameter, not the drawing of a curve: the eq-marks face keeps its polyline and marks', async () => {
  const twin = await import('@openmixer/omx-dsp').then((x) => x, () => null);
  if (!twin) return; // the curve needs the twin; test/modgui-curve.test.mjs skips the same way
  const { generateModgui } = await import('../dist/tools/modgui-gen.mjs');
  const read = (f) => JSON.parse(readFileSync(join(ROOT, 'test/fixtures', f), 'utf8'));
  const page = new Map(generateModgui(read('eq-marks/eq.descriptor.json'), { panel: read('eq-marks/eq.panel.json'), stem: 'x', source: 'test' })).get('modgui/icon-x.html').toString();
  assert.match(page, /<polyline class="omx-curve-line" fill="none" points="[^"]+"/, 'the curve polyline is drawn');
  assert.equal(page.match(/<circle /g).length, 2, 'the two marks are drawn');
});
