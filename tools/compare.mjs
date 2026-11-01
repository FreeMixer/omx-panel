// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * compare.mjs — Compare A/B/C/D and the undo ring of one processor (docs/compare.md), as pure functions: a document and the
 * running values in, a new document and the parameter moves out. A host reads its values, calls these, applies the moves
 * through its own parameter door and stores the document with its session. There is no I/O, and no Node import, so a browser or
 * a server loads this file and any other host runs `omx-panel compare`.
 */

export const COMPARE_FORMAT = 'org.openmixer.compare/1';
export const COMPARE_SLOTS = Object.freeze(['A', 'B', 'C', 'D']);
/** How many steps an undo ring keeps. */
export const RING_BOUND = 64;

export class CompareRefused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const slotOf = (slot) => {
  if (!COMPARE_SLOTS.includes(slot)) throw new CompareRefused('COMPARE_NO_SLOT', `compare: '${slot}' is no slot; the slots are ${COMPARE_SLOTS.join(' ')}`);
  return slot;
};
const checkDoc = (doc) => {
  if (doc?.format !== COMPARE_FORMAT) throw new CompareRefused('COMPARE_FORMAT', `compare: the document's format is ${doc?.format}, not ${COMPARE_FORMAT}`);
  return doc;
};
const checkValues = (values) => {
  for (const [symbol, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new CompareRefused('COMPARE_VALUE', `compare: '${symbol}' holds ${value}, which is no number`);
  }
  return values;
};
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A document with no slot used. */
export const emptyCompare = () => ({ format: COMPARE_FORMAT, active: COMPARE_SLOTS[0], slots: {} });

/** The slots holding values, in order. */
export const filledSlots = (doc) => COMPARE_SLOTS.filter((s) => doc.slots[s] !== undefined);

/** The moves from `from` to `target`: one per control both hold that differs, sorted; what only `target` holds is unknown. */
function movesTo(from, target) {
  const keys = Object.keys(target).sort(byCodeUnit);
  return {
    moves: keys.filter((k) => k in from && from[k] !== target[k]).map((symbol) => ({ symbol, value: target[symbol] })),
    unknown: keys.filter((k) => !(k in from)),
  };
}

/** What a slot holds after the running values are stored in it: a control the plugin no longer has stays in the slot. */
const stored = (slot, values) => {
  const kept = Object.fromEntries(Object.entries(slot ?? {}).filter(([k]) => !(k in values)));
  return { ...kept, ...values };
};

/** Go to slot `to`: the running values are stored in the slot left, and an empty slot takes a copy, so nothing moves. */
export function switchTo(doc, values, to) {
  checkDoc(doc);
  checkValues(values);
  slotOf(to);
  if (to === doc.active) return { doc, moves: [], unknown: [] };
  const target = doc.slots[to];
  const slots = { ...doc.slots, [doc.active]: stored(doc.slots[doc.active], values), [to]: target ?? { ...values } };
  return { doc: { ...doc, active: to, slots }, ...(target ? movesTo(values, target) : { moves: [], unknown: [] }) };
}

/** Put the running values in another slot. Nothing moves. */
export function copyTo(doc, values, to) {
  checkDoc(doc);
  checkValues(values);
  slotOf(to);
  if (to === doc.active) throw new CompareRefused('COMPARE_COPY_TO_RUNNING', `compare: slot ${to} is the one running`);
  return { doc: { ...doc, slots: { ...doc.slots, [to]: stored(doc.slots[to], values) } }, moves: [], unknown: [] };
}

const same = (a, b) => {
  const k = Object.keys(a);
  return k.length === Object.keys(b).length && k.every((x) => a[x] === b[x]);
};

/** A ring with no step. */
export const emptyRing = () => ({ undo: [], redo: [] });

/** Keep `values` as the step to come back to. The same values twice are one step; a new step ends what could be redone. */
export function capture(ring, values) {
  checkValues(values);
  const top = ring.undo[ring.undo.length - 1];
  if (top && same(top, values)) return ring;
  return { undo: [...ring.undo, { ...values }].slice(-RING_BOUND), redo: [] };
}

function step(from, to, ring, values) {
  checkValues(values);
  const list = [...ring[from]];
  let target = list.pop();
  while (target && same(target, values)) target = list.pop();
  if (!target) return { ring, moves: [], unknown: [] };
  return { ring: { [from]: list, [to]: [...ring[to], { ...values }].slice(-RING_BOUND) }, ...movesTo(values, target) };
}

/** Back one step. At the end the ring stands still and nothing moves. */
export const undo = (ring, values) => step('undo', 'redo', ring, values);
/** Forward one step. */
export const redo = (ring, values) => step('redo', 'undo', ring, values);
