// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * gestures.mjs — the reference of the one gesture vocabulary (one-panel spec 7.8; docs/panel-gestures.md). Every
 * surface moves a panel's controls with the gestures schema/gestures.json declares; each maps its own inputs onto
 * them, and is checked against this module: given a control and a script of events with timestamps, it answers
 * the resulting value in the control's own unit and the begin and end of each gesture.
 *
 * Nothing here keeps a timing or a threshold: the timings, the 10 px, the fine ratio and the step all come from
 * gestures.json. A surface may lengthen the safety hold in its own settings and never shorten it below the declared
 * floor; `timingsOf` refuses a shorter one.
 *
 * A control:   { widget, min, max, def?, scale?, step?, integer?, value?, readOnly?, hold?, section?, orientation?,
 *                travelPx?, target: { x, y, w, h } }               (knob, fader, switch, selector, xy, ...)
 *              { widget: 'handle', target, plot: { w, h }, freq, gain, q }   (each a member: min, max, def, scale, value)
 *              { widget: 'bar', bars: [{ symbol, min, max, def?, value?, target }], selected? }   (a bar group)
 * An event:    { t, type: 'down' | 'move' | 'up', id, ptype: 'touch' | 'mouse' | 'pen' | 'fader', x, y, fine? }
 *              { t, type: 'wheel' | 'detent', n, coarse?, encoder?, bar? }
 *              { t, type: 'key', key, shift?, bar? }
 * The answer:  { value, begin, end, gesture, gestures, undo, selected, refused, cancelled }
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The declaration, schema/gestures.json, read once. */
export const GESTURES = Object.freeze(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'gestures.json'), 'utf8')));

/** The refusal codes, each naming the rule that refused. */
export const GESTURE_CODES = {
  readOnly: 'GESTURE_READ_ONLY',
  owned: 'GESTURE_CONTROL_OWNED',
  noDefault: 'GESTURE_NO_DEFAULT',
  notInTable: 'GESTURE_NOT_IN_TABLE',
  holdShort: 'GESTURE_HOLD_SHORT',
  holdBelowFloor: 'GESTURE_HOLD_BELOW_FLOOR',
  noTarget: 'GESTURE_NO_TARGET',
  paintRequired: 'GESTURE_PAINT_REQUIRED_ON_TOUCH',
  badSetting: 'GESTURE_BAD_SETTING',
};

export class GestureError extends Error {
  constructor(code, why) {
    super(`${code}: ${why}`);
    this.code = code;
  }
}

/**
 * The timings a surface runs with: the declared defaults, with the surface's own settings over them. The safety hold
 * may be lengthened and is refused below the declared floor; an unknown name or a non-positive time is refused.
 */
export function timingsOf(settings = {}) {
  const declared = GESTURES.timings;
  const out = {};
  for (const [name, t] of Object.entries(declared)) out[name] = t.default;
  for (const [name, ms] of Object.entries(settings)) {
    const t = declared[name];
    if (!t) throw new GestureError(GESTURE_CODES.badSetting, `'${name}' is no timing; the timings are ${Object.keys(declared).join(', ')}`);
    if (typeof ms !== 'number' || !(ms > 0)) throw new GestureError(GESTURE_CODES.badSetting, `${name} is ${ms}: a time in ms above zero`);
    if (t.floor !== undefined && ms < t.floor) throw new GestureError(GESTURE_CODES.holdBelowFloor, `${name} ${ms} ms is below the declared floor ${t.floor} ms`);
    out[name] = ms;
  }
  return Object.freeze(out);
}

/** The word a widget's input is, or undefined: the table, then a section exception layered on it. */
export function wordOf(control, input) {
  const exception = GESTURES.exceptions.find((e) => e.section === control.section && e.widget === control.widget && e.input === input);
  return exception ? exception.word : GESTURES.table[control.widget]?.[input];
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const isLog = (m) => m.scale === 'log';
/** A value's place on its travel, 0..1 (a log travel is linear in its logarithm). */
export function normOf(m, v) {
  const [a, b] = isLog(m) ? [Math.log(m.min), Math.log(m.max)] : [m.min, m.max];
  return clamp01(((isLog(m) ? Math.log(v) : v) - a) / (b - a));
}
/** The value at a place on the travel, in the control's unit; an integer travel lands on an integer. */
export function valueOfNorm(m, n) {
  const k = clamp01(n);
  const v = isLog(m) ? Math.exp(Math.log(m.min) + k * (Math.log(m.max) - Math.log(m.min))) : m.min + k * (m.max - m.min);
  return m.integer ? Math.round(v) : v;
}
/** One step on the 0..1 travel: the declared step (linear travels), an integer travel's one, else 1% of the travel. */
export function stepNormOf(m) {
  if (m.integer) return 1 / (m.max - m.min);
  if (m.step && !isLog(m)) return m.step / (m.max - m.min);
  return GESTURES.thresholds.stepFraction;
}
/** One declared step in the control's own unit at `v`: the parity tolerance of a drag against the reference. */
export function stepOf(m, v = m.value ?? m.def ?? m.min) {
  const n = normOf(m, v);
  return Math.abs(valueOfNorm({ ...m, integer: false }, n + stepNormOf(m)) - valueOfNorm({ ...m, integer: false }, n));
}
/** Whether two values are within one declared step of each other. */
export function withinStep(m, a, b) {
  return Math.abs(normOf(m, a) - normOf(m, b)) <= stepNormOf(m) + 1e-9;
}

/**
 * A control's member for the reference from a descriptor control's `travel` (the layout's own words): its ends, default,
 * log or linear scale, declared step; a stepped travel is an integer one. `extra` adds the surface's geometry and value.
 */
export function memberOf(control, extra = {}) {
  const t = control.travel;
  return { min: t.min, max: t.max, def: t.default, scale: t.scale === 'log' ? 'log' : 'linear', ...(t.step !== undefined ? { step: t.step } : {}), integer: t.scale === 'stepped', ...extra };
}

const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const startOf = (m) => m.value ?? m.def ?? m.min;
const POINTER = new Set(['down', 'move', 'up']);

/**
 * Run a script of events against one control. Scripts are in time order (a stable sort by `t` is applied). Returns the
 * value in the control's own unit (a number; `{ freq, gain, q }` for a handle; `{ [symbol]: value }` for a bar group),
 * every gesture with its id, word, begin, end and changes, the ids of the undo entries, and what was refused.
 */
export function runGesture(control, events, settings = {}) {
  const T = timingsOf(settings.timings);
  const G = GESTURES.thresholds;
  if (settings.paintWithTouch === false) throw new GestureError(GESTURE_CODES.paintRequired, 'painting is required on touch');
  const paintWith = (ptype) => (ptype === 'mouse' ? settings.paintWithMouse === true : true);

  const kind = control.widget;
  const bars = kind === 'bar' ? control.bars : null;
  const members = kind === 'handle' ? { freq: control.freq, gain: control.gain, q: control.q }
    : bars ? Object.fromEntries(bars.map((b) => [b.symbol, b]))
      : { value: control };
  const vals = Object.fromEntries(Object.entries(members).map(([k, m]) => [k, startOf(m)]));
  const columnOf = (x) => (bars ? bars.findIndex((b) => x >= b.target.x && x < b.target.x + b.target.w) : -1);
  const hit = (x, y) => (bars ? bars.some((b) => inside(b.target, x, y)) : inside(control.target, x, y));
  const readOnly = control.readOnly === true || Object.keys(GESTURES.table[kind] ?? {}).length === 0;

  const out = { gestures: [], refused: [], cancelled: [], selected: control.selected ?? null };
  let seq = 0;
  const refuse = (code, t, why) => out.refused.push({ code, t, why });
  const open = (word, input, begin, pointer) => {
    const g = { id: `g${++seq}`, word, input, begin, end: begin, changes: {}, fine: false, shown: { from: begin, until: begin, clearOfFinger: true, drawnFollowsFinger: pointer, readBackReplaces: true } };
    out.gestures.push(g);
    return g;
  };
  const close = (g, t, tail = 0) => { g.end = t; g.shown.until = t + tail; };
  const set = (g, key, v) => { vals[key] = v; g.changes[key] = v; };

  const ptr = new Map();
  let owner = null; // { ids, ptype, t0, pinch }
  let claim = null; // { source, until }: after a step, the control is the stepper's through claimMs
  let lastTap = null; // { tUp, key, ptype }
  let stepG = null;

  const resetOf = (g, key, t) => {
    // a handle's reset is its gain: frequency and Q keep
    const k = kind === 'handle' ? 'gain' : key;
    const m = members[k];
    if (!m || m.def === undefined) { refuse(GESTURE_CODES.noDefault, t, `${k} declares no default`); g.dead = true; return; }
    set(g, k, m.def);
  };

  const tick = (t) => {
    for (const [id, p] of ptr) {
      if (!owner?.ids.includes(id) || p.dragging || p.fired || owner.pinch || control.hold || t - p.t0 < T.longPressMs) continue;
      p.fired = true;
      if (wordOf(control, 'longPress') === 'more') {
        const g = open('more', 'longPress', p.t0 + T.longPressMs, true);
        close(g, g.begin);
      }
    }
  };

  const onDown = (e) => {
    if (!hit(e.x, e.y)) return;
    if (readOnly) return refuse(GESTURE_CODES.readOnly, e.t, `a ${kind} that is read-only takes no gesture`);
    if (claim && e.t < claim.until) return refuse(GESTURE_CODES.owned, e.t, `the control is the ${claim.source}'s through the claim`);
    if (owner) {
      const first = ptr.get(owner.ids[0]);
      const pinchOk = owner.ids.length === 1 && owner.ptype === e.ptype && e.id !== owner.ids[0] && wordOf(control, 'pinch') === 'second'
        && e.t - owner.t0 <= T.palmGuardMs && first && hit(first.x0, first.y0);
      if (!pinchOk) return refuse(GESTURE_CODES.owned, e.t, `the control belongs to ${owner.ids.join(', ')}; a later press is refused`);
      const d0 = Math.hypot(e.x - first.x, e.y - first.y) || 1;
      if (first.g && !first.g.closed) { first.g.closed = true; close(first.g, e.t); }
      owner.ids.push(e.id);
      owner.pinch = { d0, q0: vals.q, g: open('second', 'pinch', e.t, true), a: first.id, b: e.id };
      ptr.set(e.id, { id: e.id, x0: e.x, y0: e.y, x: e.x, y: e.y, t0: e.t, ptype: e.ptype, dragging: true });
      return;
    }
    const col = columnOf(e.x);
    const key = bars ? bars[col].symbol : 'value';
    owner = { ids: [e.id], ptype: e.ptype, t0: e.t, pinch: null };
    ptr.set(e.id, {
      id: e.id, x0: e.x, y0: e.y, x: e.x, y: e.y, t0: e.t, ptype: e.ptype, dragging: false, fired: false, key, col,
      inCol: { x: e.x, y: e.y }, second: lastTap !== null && lastTap.key === key && lastTap.ptype === e.ptype && e.t - lastTap.tUp <= T.doubleTapMs,
    });
  };

  const heightAt = (b, y) => {
    const n = clamp01((b.target.y + b.target.h - y) / b.target.h);
    return valueOfNorm(b, n);
  };

  const onMove = (e) => {
    const p = ptr.get(e.id);
    if (!p || !owner?.ids.includes(e.id)) return;
    p.x = e.x; p.y = e.y;
    if (owner.pinch) {
      const a = ptr.get(owner.pinch.a), b = ptr.get(owner.pinch.b);
      const q = members.q;
      const scaled = Math.min(q.max, Math.max(q.min, owner.pinch.q0 * (Math.hypot(a.x - b.x, a.y - b.y) / owner.pinch.d0)));
      set(owner.pinch.g, 'q', scaled);
      close(owner.pinch.g, e.t);
      return;
    }
    const col = columnOf(e.x);
    if (bars && !p.painting && col === p.col) p.inCol = { x: e.x, y: e.y };
    if (!p.dragging) {
      if (Math.hypot(e.x - p.x0, e.y - p.y0) <= G.dragStartPx) return;
      p.dragging = true;
      p.fired = true;
      p.acc = Object.fromEntries(Object.keys(members).map((k) => [k, normOf(members[k], vals[k])]));
      p.g = open(e.fine ? 'fine' : 'drag', e.fine ? 'dragFine' : 'drag', p.t0, true);
      // the drag threshold is dead travel: the value moves from here
      p.px = e.x; p.py = e.y;
    }
    if (bars && !p.painting && col !== p.col && paintWith(p.ptype)) {
      // a drag that leaves the pressed bar's column paints; the pressed bar keeps the height it had in its column
      p.painting = true;
      p.g.word = 'paint'; p.g.input = 'sweep';
      set(p.g, p.key, heightAt(members[p.key], p.inCol.y));
      p.prev = { ...p.inCol };
    }
    if (p.painting) {
      // every bar entered takes its height, absolute; a column jumped over in one event is entered all the same
      const from = columnOf(p.prev.x);
      if (col >= 0 && from >= 0) {
        // the columns after the one the pointer left, up to the one it is in (its own column when it stayed)
        const dir = Math.sign(col - from);
        const entered = dir === 0 ? [col] : Array.from({ length: Math.abs(col - from) }, (_x, k) => from + dir * (k + 1));
        for (const c of entered) {
          const b = bars[c];
          const cx = b.target.x + b.target.w / 2;
          set(p.g, b.symbol, heightAt(b, c === col ? e.y : p.prev.y + (e.y - p.prev.y) * ((cx - p.prev.x) / (e.x - p.prev.x || 1))));
        }
        p.prev = { x: e.x, y: e.y };
      }
      close(p.g, e.t);
      return;
    }
    const ratio = e.fine ? G.fineRatio : 1;
    if (e.fine) { p.g.fine = true; p.g.word = 'fine'; p.g.input = 'dragFine'; }
    const dx = e.x - p.px, dy = e.y - p.py;
    p.px = e.x; p.py = e.y;
    if (kind === 'handle') {
      p.acc.freq += (dx / control.plot.w) * ratio;
      p.acc.gain += (-dy / control.plot.h) * ratio;
      set(p.g, 'freq', valueOfNorm(members.freq, p.acc.freq));
      set(p.g, 'gain', valueOfNorm(members.gain, p.acc.gain));
    } else {
      const horizontal = !bars && control.orientation === 'horizontal';
      const travel = bars ? members[p.key].target.h : (control.travelPx ?? G.defaultTravelPx);
      p.acc[p.key] += ((horizontal ? dx : -dy) / travel) * ratio;
      set(p.g, p.key, valueOfNorm(members[p.key], p.acc[p.key]));
    }
    close(p.g, e.t);
  };

  const onUp = (e) => {
    const p = ptr.get(e.id);
    if (!p || !owner?.ids.includes(e.id)) return;
    if (owner.pinch) {
      close(owner.pinch.g, e.t);
      ptr.delete(e.id);
      owner.ids = owner.ids.filter((i) => i !== e.id);
      if (owner.ids.length === 0) owner = null;
      return;
    }
    ptr.delete(e.id);
    owner = null;
    if (p.dragging) { close(p.g, e.t); return; }
    if (p.fired) return;
    if (!hit(e.x, e.y) || (bars && columnOf(e.x) !== p.col)) { out.cancelled.push({ t: e.t, why: 'released outside the target' }); return; }
    if (control.hold && e.t - p.t0 < T.safetyHoldMs) return refuse(GESTURE_CODES.holdShort, e.t, `held ${e.t - p.t0} ms; the safety hold is ${T.safetyHoldMs} ms`);
    if (p.second && wordOf(control, 'doubleTap') === 'reset') {
      const g = open('reset', 'doubleTap', p.t0, true);
      resetOf(g, p.key, e.t);
      close(g, e.t);
      if (g.dead) out.gestures.pop();
      lastTap = null;
      return;
    }
    const word = wordOf(control, 'tap');
    if (!word) return refuse(GESTURE_CODES.notInTable, e.t, `a ${kind} has no tap`);
    const g = open(word, 'tap', p.t0, true);
    if (word === 'toggle') {
      const m = members[p.key];
      set(g, p.key, vals[p.key] === m.max ? m.min : m.max);
    } else if (word === 'select') {
      // a tap selects and never changes a value
      out.selected = bars || kind === 'handle' ? (bars ? p.key : 'handle') : true;
    }
    close(g, e.t);
    lastTap = { tUp: e.t, key: p.key, ptype: p.ptype };
  };

  const onInput = (e) => {
    let input;
    if (e.type === 'wheel') input = e.coarse ? 'wheelCoarse' : 'wheel';
    else if (e.type === 'detent') input = e.encoder === 3 ? 'encoder3' : e.coarse ? 'detentCoarse' : 'detent';
    else if (e.key === 'Backspace') input = 'backspace';
    else input = e.shift ? (kind === 'handle' ? 'arrowSecond' : 'arrowCoarse') : 'arrow';
    if (readOnly) return refuse(GESTURE_CODES.readOnly, e.t, `a ${kind} that is read-only takes no gesture`);
    const source = `${e.type}${e.encoder ?? ''}`;
    if (owner || (claim && e.t < claim.until && claim.source !== source)) return refuse(GESTURE_CODES.owned, e.t, 'the control belongs to another input');
    const word = wordOf(control, input);
    if (!word) return refuse(GESTURE_CODES.notInTable, e.t, `a ${kind} has no ${input}`);
    const arrow = e.type === 'key' ? { ArrowUp: ['gain', 1], ArrowDown: ['gain', -1], ArrowRight: ['freq', 1], ArrowLeft: ['freq', -1] }[e.key] : null;
    const dir = arrow ? arrow[1] : Math.sign(e.n ?? 0);
    const count = Math.abs(e.n ?? 1) * (/Coarse$/.test(input) ? G.coarseSteps : 1);
    let key;
    if (word === 'second') key = 'q';
    else if (kind === 'handle') key = arrow?.[0];
    else key = bars ? (e.bar ?? out.selected) : 'value';
    if (word === 'reset') {
      const g = open('reset', input, e.t, false);
      resetOf(g, bars ? (e.bar ?? out.selected) : key, e.t);
      close(g, e.t);
      if (g.dead) out.gestures.pop();
      return;
    }
    const m = members[key];
    if (!m) return refuse(GESTURE_CODES.noTarget, e.t, 'no bar or handle member selected for the step');
    // steps of one source within the claim are one gesture, one undo entry
    if (!(stepG && claim && claim.source === source && e.t < claim.until && stepG.word === word)) stepG = open(word, input, e.t, false);
    set(stepG, key, valueOfNorm(m, normOf(m, vals[key]) + dir * count * stepNormOf(m)));
    claim = { source, until: e.t + T.claimMs };
    close(stepG, e.t, T.claimMs);
  };

  const ordered = events.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e);
  for (const e of ordered) {
    tick(e.t);
    if (!POINTER.has(e.type)) onInput(e);
    else if (e.type === 'down') onDown(e);
    else if (e.type === 'move') onMove(e);
    else onUp(e);
  }
  if (ordered.length) tick(ordered[ordered.length - 1].t);

  const last = out.gestures[out.gestures.length - 1] ?? null;
  out.gesture = last;
  out.begin = last?.begin ?? null;
  out.end = last?.end ?? null;
  out.undo = out.gestures.filter((g) => Object.keys(g.changes).length > 0).map((g) => g.id);
  out.value = kind === 'handle' ? { ...vals } : bars ? { ...vals } : vals.value;
  return out;
}
