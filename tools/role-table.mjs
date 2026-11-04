// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * role-table.mjs — each panel family's roles, the units each role accepts, the roles that repeat by
 * index, and the roles a family needs before a host may draw its family view. Data only: no import and
 * no file read, so a browser loads it as it is (`@openmixer/omx-panel/role-table`), and a host's D6 check,
 * a console's family view and this package's own layout read the one table.
 *
 *   import { ROLES, INDEXED_ROLES, REQUIRED_ROLES } from '@openmixer/omx-panel/role-table';
 */

/** @typedef {'none' | 'gate' | 'dynamics' | 'limiter' | 'deesser' | 'eq' | 'filter' | 'drive' | 'modulation' | 'delay' | 'reverb' | 'pitch'} PanelFamily */

const T = ['ms', 's'], LVL = ['db', 'dbfs', 'dbu', 'lufs'], DB = ['db'], FREQ = ['hz', 'khz'], PLAIN = ['none', 'pc', 'coef'], RATIO = ['ratio', 'coef'], CHOICE = ['none'];
const WET = { mix: ['pc', 'coef', 'none'], output: DB };

/**
 * Each family's roles and the unit tokens each accepts (the param-contract extension's tokens).
 * @type {Readonly<Record<PanelFamily, Readonly<Record<string, readonly string[]>>>>}
 */
export const ROLES = {
  none: {},
  gate: { threshold: LVL, range: DB, attack: T, release: T, hold: T, knee_start: DB, knee_end: DB, hysteresis: DB, ratio: RATIO, key_listen: CHOICE },
  dynamics: { threshold: LVL, ratio: RATIO, attack: T, release: T, knee: DB, makeup: DB, lookahead: ['ms'], ...WET },
  limiter: { ceiling: LVL, release: T, lookahead: ['ms'], threshold: LVL, ...WET },
  deesser: { frequency: FREQ, threshold: LVL, range: DB, width: ['oct'], ratio: RATIO, attack: T, release: T, knee: DB, mode: CHOICE, listen: CHOICE, ...WET },
  eq: { band_type: CHOICE, band_freq: FREQ, band_gain: ['db', 'coef'], band_q: ['none', 'coef', 'oct'], band_on: CHOICE, hpf_freq: FREQ, hpf_slope: ['none', 'db'], hpf_on: CHOICE, lpf_freq: FREQ, lpf_slope: ['none', 'db'], lpf_on: CHOICE, output: DB },
  filter: { cutoff: FREQ, resonance: PLAIN, filter_type: CHOICE, ...WET },
  drive: { drive: DB, tone: PLAIN, model: CHOICE, ...WET },
  modulation: { rate: ['hz', 'bpm'], depth: [...PLAIN, 'oct'], feedback: PLAIN, voices: CHOICE, spread: PLAIN, shape: CHOICE, ...WET },
  delay: { time: T, feedback: PLAIN, tone: PLAIN, sync: CHOICE, division: CHOICE, pingpong: CHOICE, ...WET },
  reverb: { size: PLAIN, decay: T, algorithm: CHOICE, predelay: ['ms'], damping: PLAIN, width: PLAIN, low_cut: FREQ, high_cut: FREQ, ...WET },
  pitch: { shift: ['semitone12TET', 'cent'], fine: ['cent'], ...WET },
};

/**
 * The roles that repeat by index, one control per band: schema/panel.schema.json's `$defs.indexedRole`.
 * @type {readonly string[]}
 */
export const INDEXED_ROLES = ['band_type', 'band_freq', 'band_gain', 'band_q', 'band_on'];

/**
 * The roles each family needs mapped (at index 0) before a host draws its family view: a list of
 * alternatives, each met by any ONE of its roles. `none` draws no family view.
 * @type {Readonly<Record<PanelFamily, readonly (readonly string[])[]>>}
 */
export const REQUIRED_ROLES = {
  none: [],
  gate: [['threshold'], ['range'], ['attack'], ['release']],
  dynamics: [['threshold'], ['ratio'], ['attack'], ['release']],
  limiter: [['ceiling'], ['release']],
  deesser: [['frequency'], ['threshold'], ['range']],
  eq: [['band_freq'], ['band_gain']],
  filter: [['cutoff']],
  drive: [['drive']],
  modulation: [['rate'], ['depth']],
  delay: [['time'], ['feedback']],
  reverb: [['size', 'decay'], ['mix']],
  pitch: [['shift']],
};
