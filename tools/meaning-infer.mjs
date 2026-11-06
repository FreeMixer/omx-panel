// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * meaning-infer.mjs — the EQ bands a plugin leaves unnamed, inferred from what it states (the one-panel spec Q9, §3.1):
 * the controls no descriptor word and no override gives a meaning, grouped into bands by their symbols, names and
 * units. Beside group-infer.mjs, with the same kind of verdict: an answer, or "cannot with confidence". Pure: a
 * descriptor's controls in, a verdict out. A heuristic over names is a derivation, never stored, so it is not an
 * override; every role it yields carries `inferred: true`, and a surface draws the mark.
 *
 * Only a control with no `meaning` is read. A control the descriptor gives a meaning stands as the descriptor says.
 *
 * The verdict is one of:
 *   { outcome: 'inferred', roles }                  the band roles, `{ role, index, symbol, unit, inferred: true,
 *                                                   shape? }`; `unit` is the contract token the inference reads the
 *                                                   control in (`hz`, `db` or `coef`, `oct` or `none`);
 *   { outcome: 'no-confident-inference', reason }   nothing is bound.
 *
 * A band shape no parameter selects is the `shape` of its `band_freq` role; a `band_type` role carries `shapes` where
 * the choice's labels are read (`shapesOf`): the curve function receives shapes, never a label to parse.
 */

/** The band shapes a curve function knows, and `-` for a choice value that is none of them. */
export const SHAPES = ['off', 'bell', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];

/** The label of a control: its name, else its label, else its symbol. */
const nameOf = (c) => c.name ?? c.label ?? '';
const symbolOf = (c) => c.symbol ?? (typeof c.id === 'string' ? c.id : Number.isInteger(c.id) ? `p${c.id}` : nameOf(c));
const unitOf = (c) => (c.travel?.unit ?? '').toLowerCase();

/** Symbol + name, underscores flattened to spaces, lowercased: the match haystack. */
const hay = (c) => `${symbolOf(c)} ${nameOf(c)}`.replace(/_/g, ' ').toLowerCase();

/** A gain or level control that trims the whole plugin, not one band. */
const isGlobalGain = (h) => /(gain|level)/.test(h) && /\b(in|out|input|output|make ?up|master|global|dry|wet)\b/.test(h);

/** The band role a control plays, from its metadata alone; null for a control that is not a band control. */
function roleOf(c) {
  if (c.hidden || c.readonly || c.meaning) return null;
  const h = hay(c);
  const sym = symbolOf(c).toLowerCase();
  const unit = unitOf(c);
  const choice = c.kind === 'choice';
  if (isGlobalGain(h)) return null;
  if (c.kind === 'travel') {
    if (unit === 'hz' || /\bfreq(uency)?\b/.test(h) || /^f[ _]?\d+$/.test(sym) || /^f[lh]$/.test(sym)) return 'freq';
  }
  if (choice && /(filter\s*type|\btype\b|\bmode\b|^ft\b|^fm\b)/.test(h)) return 'type';
  if (c.kind === 'travel') {
    if (unit === 'db' || /\b(gain|boost|cut|level)\b/.test(h) || /^g[ _]?\d+$/.test(sym) || /^boost[lh]$/.test(sym)) return 'gain';
    if (/\bq\b|quality|bandwidth|resonance|\bwidth\b|^q[ _]?\d+$|^bw\d*$/.test(h) || unit === 'oct') return 'q';
  }
  if (c.kind === 'toggle' || choice || /\b(active|enable|on|section|sec|bypass)\b|highpass|lowpass/.test(h)) return 'enable';
  return null;
}

/** Role affix tokens stripped to derive a band's group key (longest first). */
const AFFIX = {
  freq: ['frequency', 'freq', 'hz', 'f'],
  gain: ['boost', 'gain', 'level', 'cut', 'g'],
  q: ['bandwidth', 'resonance', 'quality', 'width', 'bw', 'q', 'w'],
  type: ['filtertype', 'type', 'mode', 'ft', 'fm'],
  enable: ['active', 'section', 'sec', 'enable', 'on'],
};

/** A band's group key: the symbol with the role affix and the separators stripped. */
function bandKey(symbol, role) {
  let s = symbol.toLowerCase();
  for (const t of AFFIX[role]) {
    if (s.startsWith(t)) { s = s.slice(t.length); break; }
    if (s.endsWith(t)) { s = s.slice(0, s.length - t.length); break; }
  }
  return s.replace(/[_\-\s]+/g, '');
}

/** A band's shape from its key and the names of its controls. */
function shapeOfNames(key, names) {
  const k = key.toLowerCase(), n = names.toLowerCase();
  if (/low\s*shelf|lo\s*shelf|loshelf|lowshelf/.test(n) || k.startsWith('ls')) return 'lowshelf';
  if (/high\s*shelf|hi\s*shelf|hishelf|highshelf/.test(n) || k.startsWith('hs')) return 'highshelf';
  if (/high\s*pass|hi\s*pass|highpass/.test(n) || k.startsWith('hp')) return 'highpass';
  if (/low\s*pass|lo\s*pass|lowpass/.test(n) || k.startsWith('lp')) return 'lowpass';
  if (/notch/.test(n)) return 'notch';
  return 'bell';
}

/** A shape word from a filter-type choice's label; undefined when the label is none of them. */
export function shapeOfLabel(label) {
  const l = label.trim().toLowerCase();
  if (/^off$|bypass|none/.test(l)) return 'off';
  if (/lo(w)?[\s-]*shelf/.test(l)) return 'lowshelf';
  if (/hi(gh)?[\s-]*shelf/.test(l)) return 'highshelf';
  if (/hi(gh)?[\s-]*pass/.test(l)) return 'highpass';
  if (/lo(w)?[\s-]*pass/.test(l)) return 'lowpass';
  if (/notch/.test(l)) return 'notch';
  if (/bell|peak/.test(l)) return 'bell';
  return undefined;
}

/**
 * A choice control's `shapes`: one shape word per choice value from 0 (`-` for a value whose label is none of
 * them), or undefined when none of its labels is a shape. A choice's value is its entry in `values`, else its place.
 */
export function shapesOf(c) {
  const labels = c.labels ?? c.ids ?? [];
  const values = c.values ?? labels.map((_, i) => i);
  const top = Math.max(-1, ...values);
  if (!Number.isInteger(top) || top < 0 || top > 63) return undefined;
  const out = Array.from({ length: top + 1 }, () => '-');
  let any = false;
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0) return;
    const s = shapeOfLabel(String(labels[i] ?? ''));
    if (s) { out[v] = s; any = true; }
  });
  return any ? out : undefined;
}

/** The contract token a gain is read in: dB, or a linear factor (a range that stays above zero). */
function gainToken(c) {
  if (unitOf(c) === 'db') return 'db';
  return typeof c.travel?.min === 'number' && c.travel.min > 0 ? 'coef' : 'db';
}

/** Infer `controls`' EQ bands. See the file's header for the verdict. */
export function inferBands(controls) {
  const groups = new Map();
  let order = 0;
  for (const c of controls) {
    const role = roleOf(c);
    if (!role) continue;
    const key = bandKey(symbolOf(c), role);
    if (!key) continue;
    const g = groups.get(key) ?? { order: order++ };
    const strongQ = (x) => /\bq\b|quality|resonance/.test(hay(x));
    // first wins per role in descriptor order, but a real "q" beats a width fallback
    if (role === 'q' && g.q) { if (strongQ(c) && !strongQ(g.q)) g.q = c; }
    else if (!g[role]) g[role] = c;
    groups.set(key, g);
  }
  const bands = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (!g.freq) continue; // a band has a frequency
    if (!g.gain && !g.type && !g.q) continue; // a bare frequency is not a band
    const names = [g.freq, g.gain, g.q, g.type].filter(Boolean).map(nameOf).join(' ');
    bands.push({ ...g, key, shape: shapeOfNames(key, names) });
  }
  if (bands.length === 0) return { outcome: 'no-confident-inference', reason: 'no-band' };

  // a high-pass or low-pass band with no gain is the head filter; the others take the indices from 0, the
  // gain-carrying ones first
  const head = (kind, shape) => bands.filter((b) => b.shape === shape && !b.gain).slice(0, 1).map((b) => ({ kind, b }));
  const heads = [...head('hpf', 'highpass'), ...head('lpf', 'lowpass')];
  const isHead = new Set(heads.map((h) => h.b));
  const rest = bands.filter((b) => !isHead.has(b)).sort((x, y) => Number(Boolean(y.gain)) - Number(Boolean(x.gain)));
  const mark = { inferred: true };
  const roles = [];
  for (const { kind, b } of heads) {
    roles.push({ role: `${kind}_freq`, index: 0, symbol: symbolOf(b.freq), unit: 'hz', ...mark });
    if (b.enable) roles.push({ role: `${kind}_on`, index: 0, symbol: symbolOf(b.enable), unit: 'none', ...mark });
  }
  rest.forEach((b, index) => {
    // a shape no parameter selects is the band_freq role's own
    roles.push({ role: 'band_freq', index, symbol: symbolOf(b.freq), unit: 'hz', ...(b.type ? {} : { shape: b.shape }), ...mark });
    if (b.gain) roles.push({ role: 'band_gain', index, symbol: symbolOf(b.gain), unit: gainToken(b.gain), ...mark });
    if (b.q) roles.push({ role: 'band_q', index, symbol: symbolOf(b.q), unit: unitOf(b.q) === 'oct' ? 'oct' : 'none', ...mark });
    if (b.enable) roles.push({ role: 'band_on', index, symbol: symbolOf(b.enable), unit: 'none', ...mark });
    if (b.type) {
      const shapes = shapesOf(b.type);
      roles.push({ role: 'band_type', index, symbol: symbolOf(b.type), unit: 'none', ...(shapes ? { shapes } : {}), ...mark });
    }
  });
  return { outcome: 'inferred', roles };
}
