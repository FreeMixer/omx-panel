// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * easy.mjs — the controls a plugin's Easy face holds (docs/panel-layout.md, "The Easy face"): the one rule the console, a
 * Zynthian engine and a MOD GUI read. A declared list wins; else the roles, in their family's order; else the layout's order
 * fills what is left. It takes the layout's family, roles and controls, and has no Node import, so a browser loads it too.
 */

/** The most controls a declared list names: what one surface page holds. */
export const EASY_DECLARED_MAX = 8;
/** The most the roles pick. */
export const EASY_RULE_MAX = 6;
/** The order fills up to this many when the roles gave fewer. */
export const EASY_FILL = 4;

/** Each family's roles for the Easy face, in order: what is first matters most, a screen of four shows those. */
export const EASY_ROLES = Object.freeze({
  none: [],
  gate: ['threshold', 'range', 'attack', 'release'],
  dynamics: ['threshold', 'ratio', 'makeup', 'mix', 'attack', 'release'],
  limiter: ['ceiling', 'threshold', 'release', 'output'],
  deesser: ['frequency', 'threshold', 'range', 'mix'],
  eq: ['band_gain', 'output'],
  filter: ['cutoff', 'resonance', 'filter_type', 'mix'],
  drive: ['drive', 'tone', 'model', 'mix'],
  modulation: ['rate', 'depth', 'feedback', 'mix'],
  delay: ['time', 'feedback', 'tone', 'mix'],
  reverb: ['size', 'decay', 'damping', 'mix'],
  pitch: ['shift', 'fine', 'mix'],
});

export class EasyRefused extends Error {
  code = 'PANEL_EASY_REFUSED';
}

/** A layout control a face can set: no reading, no trigger, no bypass (the header draws it). */
const drawableInLayout = (c) => {
  const w = c.standard?.widget;
  return w !== 'meter' && w !== 'display' && !c.standard?.momentary && c.meaning !== 'bypass' && c.meaning !== 'enabled';
};

function checked(declared, controls, drawable, where) {
  if (declared.length === 0) throw new EasyRefused(`${where}: the easy list is empty; leave it out to take the rule`);
  if (declared.length > EASY_DECLARED_MAX) throw new EasyRefused(`${where}: the easy list names ${declared.length} controls, at most ${EASY_DECLARED_MAX}`);
  const seen = new Set();
  for (const symbol of declared) {
    const c = controls.find((x) => x.symbol === symbol);
    if (!c) throw new EasyRefused(`${where}: the easy list names '${symbol}', no control of the panel`);
    if (!drawable(c)) throw new EasyRefused(`${where}: the easy list names '${symbol}', which no face can set`);
    if (seen.has(symbol)) throw new EasyRefused(`${where}: the easy list names '${symbol}' twice`);
    seen.add(symbol);
  }
  return [...declared];
}

/** `count` of `n` positions evenly spread, both ends included. */
const spread = (n, count) => (count >= n ? Array.from({ length: n }, (_, i) => i) : count === 1 ? [0] : Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1))));

/**
 * The symbols of the Easy face of `x`, a layout or anything with its `family`, `roles` (`role`, `index`, `symbol`) and
 * `controls` (`symbol`). `declared` is the plugin's own list, refused whole by name when it is wrong. `drawable` says which
 * controls a face can set, for a host whose controls are not the layout's.
 */
export function easyOf(x, { declared, drawable = drawableInLayout, where = 'easy' } = {}) {
  if (declared !== undefined) return checked(declared, x.controls, drawable, where);
  const can = new Set(x.controls.filter(drawable).map((c) => c.symbol));
  const row = EASY_ROLES[x.family] ?? [];
  const members = (role) => x.roles.filter((r) => r.role === role && can.has(r.symbol)).sort((a, b) => a.index - b.index);
  const mapped = row.filter((role) => members(role).length > 0);
  const places = EASY_RULE_MAX - (mapped.length - 1);
  const picked = mapped.flatMap((role) => {
    const m = members(role);
    return (m.length === 1 ? m : spread(m.length, places).map((k) => m[k])).map((r) => r.symbol);
  });
  const easy = [...new Set(picked)].slice(0, EASY_RULE_MAX);
  for (const c of x.controls) {
    if (easy.length >= EASY_FILL) break;
    if (can.has(c.symbol) && !easy.includes(c.symbol)) easy.push(c.symbol);
  }
  return easy;
}
