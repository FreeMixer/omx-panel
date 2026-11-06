// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * bars.mjs — the bar group of a section (docs/panel-layout.md "Bars", the one-panel spec §6): a run of controls that
 * do one job on different parts of the sound (an organ's drawbars, a graphic EQ's band gains, a sequencer's steps),
 * drawn as one row of thin faders. The layout carries it as an optional field of the section, `bars`: a list of
 * runs, each `{ controls, labels, tied }`, one label and one tied list per bar, at most MAX_BARS bars a run.
 *
 * The rule (§6.2): inside one section, at least MIN_BARS controls one after another that are each a visible, writable
 * travel with the same ends, the same step, the same unit and the same scale, and whose labels form one series.
 * A declared section says `bars: true` (its controls, in order, are one run; the rule's checks still apply and refuse
 * by name) or `bars: false` (no inference there).
 *
 * `bars` is a view of the panel, like `easy`: it stays out of the canonical form and the fingerprint.
 */

export const MIN_BARS = 4;
export const MAX_BARS = 16;

/** The footages of an organ's drawbars, as setBfree and Hammond clones label them. */
export const FOOTAGES = ['16\'', '5 1/3\'', '8\'', '4\'', '2 2/3\'', '2\'', '1 3/5\'', '1 1/3\'', '1\''];

/** The refusal codes of a declared `bars: true`, each naming the check it failed. */
export const BARS_CODES = {
  few: 'PANEL_BARS_TOO_FEW',
  kind: 'PANEL_BARS_NOT_TRAVEL',
  facts: 'PANEL_BARS_FACTS_DIFFER',
  series: 'PANEL_BARS_LABELS_NOT_SERIES',
  unknown: 'PANEL_BARS_UNKNOWN_CONTROL',
};

/** A bar-able control: a visible, writable travel. */
const barable = (c) => c.kind === 'travel' && c.travel && !c.hidden && !c.readonly;

/** The facts every bar of a run shares: ends, step (0 for a continuous travel), unit and scale. */
const factsOf = (c) => JSON.stringify([c.travel.min, c.travel.max, c.travel.step ?? 0, c.travel.unit, c.travel.scale]);

const FOOT = new Set(FOOTAGES);
/** A drawbar's footage in a label: `8'`, or `DB 8'`; undefined for any other label. */
const footageOf = (label) => {
  const m = /^(?:DB\s+)?(\d+(?: \d\/\d)?'|\d\/\d')$/.exec(label.trim());
  return m && FOOT.has(m[1]) ? m[1] : undefined;
};

/** A frequency label in Hz: `100 Hz`, `1k`, `1.2 kHz`; undefined for any other label. */
export function hzOf(label) {
  const m = /^(\d+(?:\.\d+)?)\s*(k?hz|k)$/i.exec(label.trim());
  if (!m) return undefined;
  return Number(m[1]) * (m[2].toLowerCase().startsWith('k') ? 1000 : 1);
}

const NUMBER = /\d+(?:\.\d+)?/g;
/** A label cut at its numbers: the words with `#` where a number stood, and the numbers. */
function cut(label) {
  const nums = label.match(NUMBER) ?? [];
  return { template: label.replace(NUMBER, '#'), nums };
}

/**
 * How far from `i` the labels form one series, as `{ end, kind, labels }`; `end` is the index after the last
 * control of the longest series (`end === i` when there is none of at least two). The kinds: `numbered` (the same words
 * with one varying number: the bar's label is the varying part), `footage`, `frequency` (strictly rising).
 */
function seriesFrom(labels, i) {
  const best = { end: i, kind: null, labels: [] };
  // the same words, one number position varying
  const first = cut(labels[i]);
  if (first.nums.length > 0 && hzOf(labels[i]) === undefined) {
    for (let at = 0; at < first.nums.length; at++) {
      let j = i + 1;
      for (; j < labels.length; j++) {
        const c = cut(labels[j]);
        if (c.template !== first.template || c.nums.length !== first.nums.length) break;
        if (c.nums.some((n, k) => k !== at && n !== first.nums[k])) break;
      }
      const varies = j - i >= 2 && new Set(labels.slice(i, j).map((l) => cut(l).nums[at])).size > 1;
      if (varies && j > best.end) Object.assign(best, { end: j, kind: 'numbered', labels: labels.slice(i, j).map((l) => cut(l).nums[at]) });
    }
  }
  let j = i;
  while (j < labels.length && footageOf(labels[j])) j++;
  if (j - i >= 2 && j > best.end) Object.assign(best, { end: j, kind: 'footage', labels: labels.slice(i, j).map(footageOf) });
  j = i;
  while (j < labels.length && hzOf(labels[j]) !== undefined && (j === i || hzOf(labels[j]) > hzOf(labels[j - 1]))) j++;
  if (j - i >= 2 && j > best.end) Object.assign(best, { end: j, kind: 'frequency', labels: labels.slice(i, j).map((l) => l.trim()) });
  return best;
}

/** Cut a run into runs of at most MAX_BARS, the same on every surface. */
const chunks = (list) => Array.from({ length: Math.ceil(list.length / MAX_BARS) }, (_, k) => list.slice(k * MAX_BARS, (k + 1) * MAX_BARS));

/**
 * The bar runs of one section. `items` are the section's visible controls in order, each `{ symbol, label, control }`
 * (`control` the descriptor control); `declared` the section's `bars` word (true, false, or undefined). Answers
 * `{ runs, refusal }`: `refusal` is `{ code, why }` when a declared `bars: true` fails a check of the rule; the
 * runs are then empty. A run is `{ controls, labels, tied }`.
 */
export function barsOf(items, declared) {
  if (declared === false) return { runs: [], refusal: null };
  const labels = items.map((it) => it.label);
  if (declared === true) {
    if (items.length < MIN_BARS) return { runs: [], refusal: { code: BARS_CODES.few, why: `a bar group is at least ${MIN_BARS} controls, the section has ${items.length}` } };
    const bad = items.find((it) => !barable(it.control));
    if (bad) return { runs: [], refusal: { code: BARS_CODES.kind, why: `'${bad.symbol}' is not a visible, writable travel` } };
    const odd = items.find((it) => factsOf(it.control) !== factsOf(items[0].control));
    if (odd) return { runs: [], refusal: { code: BARS_CODES.facts, why: `'${odd.symbol}' differs from '${items[0].symbol}' in range, step, unit or scale` } };
    const s = seriesFrom(labels, 0);
    if (s.end !== items.length) return { runs: [], refusal: { code: BARS_CODES.series, why: `the labels of '${items[s.end]?.symbol ?? items[0].symbol}' onward are not one series` } };
    return { runs: tie(items.map((it, k) => ({ symbol: it.symbol, label: String(s.labels[k]), meaning: it.control.meaning })), [], 'declared'), refusal: null };
  }
  const found = [];
  let i = 0;
  while (i < items.length) {
    if (!barable(items[i].control)) { i++; continue; }
    // the stretch of controls from i that share one set of facts
    let stretch = i + 1;
    while (stretch < items.length && barable(items[stretch].control) && factsOf(items[stretch].control) === factsOf(items[i].control)) stretch++;
    const s = seriesFrom(labels.slice(0, stretch), i);
    if (s.end - i >= MIN_BARS) {
      found.push({ kind: s.kind, labels: s.labels.map(String), rows: items.slice(i, s.end) });
      i = s.end;
    } else i++;
  }
  return { runs: tie(null, found), refusal: null };
}

/** Whether two found runs are over the same bands: the same length with labels that are not the same labels. */
const overSameBands = (a, b) => a.rows.length === b.rows.length && a.rows.some((r, k) => r.label !== b.rows[k].label);

/** The level meanings: the run whose controls have one takes the bars when several runs qualify over the same bands. */
const LEVEL = new Set(['gain', 'level']);

/** Fold the found runs into the section's `bars`: runs over the same bands become one run with the others `tied`. */
function tie(declaredRows, found) {
  if (declaredRows) {
    return chunks(declaredRows).map((rows) => ({ controls: rows.map((r) => r.symbol), labels: rows.map((r) => r.label), tied: rows.map(() => []) }));
  }
  const taken = new Set();
  const runs = [];
  found.forEach((f, a) => {
    if (taken.has(a)) return;
    const same = found.map((g, b) => (b !== a && !taken.has(b) && overSameBands(f, g) ? b : -1)).filter((b) => b >= 0);
    const group = [a, ...same];
    group.forEach((b) => taken.add(b));
    const level = group.find((b) => found[b].rows.every((r) => LEVEL.has(r.control.meaning)));
    const head = found[level ?? group[0]];
    const rest = group.filter((b) => found[b] !== head).map((b) => found[b]);
    const rows = head.rows.map((r) => ({ symbol: r.symbol }));
    const lab = head.labels;
    const tied = rows.map((_, k) => rest.map((g) => g.rows[k].symbol));
    for (const part of chunkIdx(rows.length)) {
      runs.push({ controls: part.map((k) => rows[k].symbol), labels: part.map((k) => lab[k]), tied: part.map((k) => tied[k]) });
    }
  });
  // the section's order: runs in the order their first control stands
  return runs;
}

const chunkIdx = (n) => chunks(Array.from({ length: n }, (_, k) => k));

/**
 * The bar runs of a section of a served description (a skin's `sections` rebuild them): `controls` are the section's description
 * controls in order, `params` the description's params. A number with labels is a choice and a trigger or text is no travel;
 * a skin states no meaning, so the tie goes to the first run.
 */
export function barsOfDescription(controls, params, declared) {
  const bySymbol = new Map(params.map((p) => [p.symbol, p]));
  const items = controls.map((c) => {
    const p = bySymbol.get(c.symbol);
    const travel = p?.kind === 'number' && p.enumLabels === undefined ? { min: p.min, max: p.max, step: p.step, unit: p.unit, scale: p.scale } : undefined;
    return { symbol: c.symbol, label: c.label || p?.name || c.symbol, control: travel ? { kind: 'travel', travel } : { kind: 'choice' } };
  });
  return barsOf(items, declared);
}
