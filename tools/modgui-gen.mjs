#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * modgui-gen.mjs — a MOD modgui for one plugin, from its DESCRIPTOR (omx-contract docs/descriptors.md) and,
 * when the plugin declares one, its panel, so MOD and Zynthian draw it properly (docs/modgui.md).
 *
 * The descriptor gives every control's symbol, name, travel and default, and a choice's values and labels;
 * the declared panel (a plugin's own, omx-plugins' `panel` block) gives the family, the sections and each
 * control's widget (`widgets`, by schema/panel.schema.json's names; left out, the kind's default). With no
 * declared panel the sections and the family are the layout's (tools/panel-description.mjs) over the
 * descriptor's groups and meanings. The colours and the font are the omx look's, tools/look.json, which
 * tools/look.mjs resolves from tools/look/tokens.css. This file types no travel and no colour.
 *
 * Written into the LV2 bundle `--out` names: `modgui.ttl` and `modgui/` (template, stylesheet, screenshot,
 * thumbnail, knob film strip, and the fader's when a control is one). The images are rasterised here from the
 * template's own layout (raster.mjs) — the plugin title, the section labels, each control's name and its default with unit, set in the look's bundled font (tools/fonts/), each knob at its declared default, byte-deterministic.
 *
 * Usage: `node tools/modgui-gen.mjs [--check|--emit-stdout] (--descriptor <file> | --installed <package>/<name>)
 * [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>] [--easy-first]` — `--check` writes nothing and refuses a
 * stale, missing or extra file byte for byte; `--no-films` leaves out the knob and fader film strips (every bundle's
 * same render of the look, which a tree need not track: `--check` then names a returning one EXTRA), and
 * `--films-only` writes only them, into a built bundle, leaving its other files as they are; `--emit-stdout` prints every text file and one digest line per
 * image, writing nothing. `--stem` names the files (the bundle's name without .lv2 by default); `--source` is what
 * the banner names as their source (the descriptor and the panel files by default).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFont } from './font.mjs';
import { barsOf } from './bars.mjs';
import { LOOK_JSON, LOOK_TOKENS, NOT_COLOURS } from './look.mjs';
import { easyOf } from './easy.mjs';
import { unitToken as unitTokenOf, basisOf, BarsRefused, DISPLAY_OF_GRAPH, EASY_PAGE, keyOf, panelLayout, visibilityRules } from './panel-description.mjs';
import { canvas, disc, drawText, encodePng, fitText, rgbOf, roundRect, segment } from './raster.mjs';
import { parseTurtle } from './turtle-read.mjs';
import { installedDescriptorFile } from './vocabulary.mjs';

export { LOOK_JSON };
const TOOLS = dirname(fileURLToPath(import.meta.url));
/** The shared widgets, schema/panel.schema.json's `$defs.widget`: the one list a plugin's schema, this generator
 * and the console name a control's widget from. */
export const WIDGETS = Object.freeze(JSON.parse(readFileSync(join(TOOLS, '..', 'schema', 'panel.schema.json'), 'utf8')).$defs.widget.enum);
/** The widgets the MOD GUI draws: the controls a plugin's own parameters take; the others are read-only or a graph. */
export const DRAWN_WIDGETS = Object.freeze(['knob', 'fader', 'switch', 'selector']);
export const MODGUI_TTL = 'modgui.ttl';
export const MODGUI_DIR = 'modgui';
/** An integer travel with more steps than this is a continuous knob; fewer is a selector. */
export const MAX_SELECTOR_STEPS = 16;
/** The face's numbers, tools/look/geometry.json: the file the C renderer (renderer/) reads too. */
const FACE = JSON.parse(readFileSync(join(TOOLS, 'look', 'geometry.json'), 'utf8'));
/** The controls of one row of a section; a section with more wraps onto further rows. */
export const ROW_CONTROLS = FACE.rowControls;

/** The geometry, in CSS px: one set of numbers the template, the stylesheet and the raster read. */
export const GEOMETRY = Object.freeze(FACE.geometry);

/** A choice control whose descriptor states ids (and labels) but no `values`: the value the plugin reads for an id is
 * the descriptor's to say, an index is not it, so the generator refuses and names the control. */
export class ChoiceNoValues extends Error {
  code = 'MODGUI_CHOICE_NO_VALUES';
}

/**
 * A descriptor control as the travel this generator draws: `{ kind, min, max, def, points? }`, `kind` `toggle`
 * (0..1), `integer` (a choice, or a travel of step 1) or none (a continuous travel); a choice's `points` are its
 * values and labels, `{value, label}` from the lowest. Undefined for a control with no travel to draw (a trigger,
 * a text, a read-only reading).
 */
export function travelOf(c) {
  if (c.readonly) return undefined;
  if (c.kind === 'toggle') return { kind: 'toggle', min: 0, max: 1, def: c.default ? 1 : 0 };
  if (c.kind === 'choice') {
    if (!Array.isArray(c.values)) throw new ChoiceNoValues(`modgui-gen: choice control '${c.symbol ?? c.id ?? c.name}' states no \`values\`; the descriptor must say the value the plugin reads for each of its ids`);
    const points = c.values.map((value, k) => ({ value, label: c.labels?.[k] ?? c.ids[k] }));
    const at = c.ids.indexOf(c.default);
    return { kind: 'integer', min: points[0].value, max: points[points.length - 1].value, def: at >= 0 ? c.values[at] : c.default, points };
  }
  if (c.kind === 'travel') return { ...(c.travel.step === 1 ? { kind: 'integer' } : {}), min: c.travel.min, max: c.travel.max, def: c.travel.default };
  return undefined;
}

/** The range a readout (a read-only control) shows, `{ min, max }`, or none for one with no range. */
function readoutRange(c) {
  if (c.kind === 'travel') return { min: c.travel.min, max: c.travel.max };
  if (c.kind === 'toggle') return { min: 0, max: 1 };
  if (c.kind === 'choice') return { min: Math.min(...c.values), max: Math.max(...c.values) };
  return {};
}

/** The labelled values of a travel, `{value, label}` from min up, or undefined. */
const choicesOf = (p) => p.points;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TTL_ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
/** A Turtle short string: backslash, quote and the line breaks and tab it may not hold raw are escaped. */
const ttlStr = (s) => `"${String(s).replace(/[\\"\n\r\t]/g, (ch) => TTL_ESCAPES[ch])}"`;

/**
 * The widget a declared parameter takes when its panel names none: a toggle is a switch; a parameter with
 * labelled values (a choice, an enumeration port) or an integer with a few steps is a selector,
 * MOD's own `custom-select` over the port's values; an integer with a wide travel (more than
 * MAX_SELECTOR_STEPS steps, e.g. a time in ms) and every other travel is a knob.
 */
export function widgetOf(p) {
  if (p.kind === 'toggle') return 'switch';
  if (choicesOf(p) || (p.kind === 'integer' && p.max - p.min <= MAX_SELECTOR_STEPS)) return 'selector';
  return 'knob';
}

/**
 * Whether `widget` can draw `p`: a switch a toggle; a selector an integer travel (every step an
 * option); a knob or a fader a travel with no labelled values (labels are a selector's) and no toggle.
 */
export function widgetFits(widget, p) {
  if (widget === 'switch') return p.kind === 'toggle';
  if (widget === 'selector') return p.kind === 'integer' || p.kind === 'toggle';
  return !choicesOf(p) && p.kind !== 'toggle';
}

/** The widget a control of `panel` is drawn with: the panel's `widgets` entry, else widgetOf. */
export function widgetFor(panel, symbol, p) {
  const named = panel.widgets?.[symbol];
  if (named === undefined) return widgetOf(p);
  if (!WIDGETS.includes(named)) throw new Error(`modgui-gen: '${symbol}' names widget '${named}', none of ${WIDGETS.join(', ')}`);
  if (!DRAWN_WIDGETS.includes(named)) throw new Error(`modgui-gen: '${symbol}' names widget '${named}', which the MOD GUI does not draw (it draws ${DRAWN_WIDGETS.join(', ')})`);
  if (!widgetFits(named, p)) throw new Error(`modgui-gen: '${symbol}' cannot be drawn as a ${named}`);
  return named;
}

/** A selector's options, `{value, label}` from min up: the labelled values, else every step. */
export function optionsOf(p) {
  return choicesOf(p) ?? Array.from({ length: p.max - p.min + 1 }, (_x, k) => ({ value: p.min + k, label: `${p.min + k}` }));
}

/** Where a value sits on its travel, 0..1 (every declared travel is linear). */
export function travelFraction(p, v) {
  return p.max === p.min ? 0 : (v - p.min) / (p.max - p.min);
}

/** A descriptor with no visible control (a synth whose parameters are not LV2 ports): there is no face to make. Not a
 * fault of the descriptor; `omx-panel modgui` exits 3 for it so a sweep records a skip. */
export class NothingToDraw extends Error {
  code = 'MODGUI_NOTHING_TO_DRAW';
}

/** The display kinds that are a curve on the face: a frame with the curve's basis word in its caption place. */
const CURVES = ['eq_response', 'transfer_curve'];

/**
 * The curve function of omx-dsp, its TypeScript twin (`@openmixer/omx-dsp`, `curvePoints`): never vendored here. A tree that does not
 * have it draws each curve's frame and caption alone, and says so by `curve: { code: 'no-twin' }`; with `OMX_PANEL_DSP=required` its
 * absence is an error (the release gate).
 */
const TWIN = await import('@openmixer/omx-dsp').catch((err) => {
  if (process.env.OMX_PANEL_DSP === 'required') throw err;
  return null;
});
/** The rate a static curve is computed at, and the grid it is sampled on. */
export const STATIC_CURVE = Object.freeze({ sampleRate: 48000, points: 128 });
/** The one letter a mark wears: one per planter family, as the console's band-origin.ts names it. */
export const ORIGIN_LETTER = Object.freeze({ 'fbs-fixed': 'F', 'fbs-live': 'F', hrp: 'H', 'room-mode': 'R' });

/** The terms of a curve request from a layout's roles, each at its come-up value, in the unit the description gives the role. */
function curveTerms(descriptor, x) {
  const roles = new Set(TWIN.CURVE_WORDS.roles);
  const control = (symbol) => descriptor.controls.find((c) => keyOf(c) === symbol);
  const valueOf = (c) => (c.kind === 'choice' ? (c.values ?? c.ids.map((_, i) => i))[Math.max(0, c.ids.indexOf(c.default))] : c.kind === 'toggle' ? (c.default === true ? 1 : 0) : (c.travel.default ?? c.travel.min));
  return x.roles.filter((r) => roles.has(r.role)).map((r) => {
    const value = valueOf(control(r.symbol));
    return {
      role: r.role, index: r.index, value, unit: r.token ?? unitTokenOf(r.unit),
      ...(r.shape ? { shape: r.shape } : {}),
      ...(r.role === 'band_type' && r.shapes ? { shape: r.shapes[value] } : {}),
      ...(r.origin ? { origin: r.origin } : {}),
    };
  });
}

/** The static curve of one display at the come-up values: `{ points, marks }`, or `{ code }` where the twin draws none. */
function staticCurve(descriptor, x, dsp) {
  if (!TWIN) return { code: 'no-twin' };
  const answer = TWIN.curvePoints({ kind: dsp.kind, family: x.family, ...STATIC_CURVE, terms: curveTerms(descriptor, x) });
  return 'code' in answer ? { code: answer.code } : { points: answer.points, marks: answer.marks };
}

/**
 * Where a curve's stroke, axis and marks fall inside its frame of `cw` x `ch` device px at scale `s`, relative to the frame's corner: the
 * mapping of renderer/src/view.c `draw_curve`, operation for operation (an eq_response on a log frequency axis with the dB symmetric about 0
 * to the next 6 dB; a transfer_curve on linear dB, input and output on one span), so the two rasterisers draw one stroke.
 */
export function curveGeometry(curve, kind, cw, ch, s) {
  const pts = curve?.points;
  if (!pts || pts.length < 2) return null;
  const ix = 5 * s, iy = 5 * s, iw = cw - 10 * s, ih = ch - 10 * s - 12 * s;
  const eq = kind === 'eq_response';
  let lo, hi, x0, x1, axis;
  if (eq) {
    let m = 6;
    for (const p of pts) m = Math.max(m, Math.abs(p.y));
    hi = Math.ceil(m / 6) * 6, lo = -hi;
    x0 = Math.log10(pts[0].x), x1 = Math.log10(pts[pts.length - 1].x);
    axis = [ix, iy + ih / 2, ix + iw, iy + ih / 2];
  } else {
    lo = Math.min(pts[0].x, pts[0].y), hi = Math.max(pts[pts.length - 1].x, pts[0].y);
    for (const p of pts) lo = Math.min(lo, p.y), hi = Math.max(hi, p.y);
    x0 = lo, x1 = hi;
    axis = [ix, iy + ih, ix + iw, iy];
  }
  const at = (xv, yv) => [ix + (((eq ? Math.log10(xv) : xv) - x0) / (x1 - x0)) * iw, iy + ih - ((yv - lo) / (hi - lo)) * ih];
  const marks = eq ? (curve.marks ?? []).map((m) => ({ at: at(m.freq, m.depthDb), letter: ORIGIN_LETTER[m.origin] ?? '?' })) : [];
  return { axis, poly: pts.map((p) => at(p.x, p.y)), marks };
}

/** The curves of a panel section: a derived panel's are the layout's; a declared one's follow its `graph`. */
const displaysOf = (descriptor, s) => s.displays ?? (CURVES.includes(DISPLAY_OF_GRAPH[s.graph]) ? [{ kind: DISPLAY_OF_GRAPH[s.graph], basis: basisOf(descriptor, s) }] : []);

/** The panel a descriptor is drawn with: the declared one, else the layout's sections and family over its
 * groups and meanings (tools/panel-description.mjs); with `wantEasyFirst` (--easy-first), the Easy controls first. */
export function panelOf(descriptor, declared, wantEasyFirst = false) {
  if (!declared) {
    const x = panelLayout(descriptor, { derive: true });
    const panel = { family: x.family, sections: x.sections.map((s, i) => ({ key: s.key, label: s.label, controls: x.controls.filter((c) => c.section === i).map((c) => c.symbol), displays: x.displays.filter((d) => d.section === i && CURVES.includes(d.kind)).map((d) => ({ kind: d.kind, basis: d.basis })) })) };
    return wantEasyFirst ? easyFirst(panel, x.easy) : panel;
  }
  if (!wantEasyFirst) return declared;
  // A declared panel is checked by resolvePanel, each fault by its own message: a control it cannot find is simply not drawable here
  const controlOf = (symbol) => descriptor.controls?.find((c) => keyOf(c) === symbol);
  const roles = Object.entries(declared.roles ?? {}).flatMap(([role, syms]) => [syms].flat().map((symbol, index) => ({ role, index, symbol })));
  const controls = declared.sections.flatMap((s) => s.controls.map((symbol) => ({ symbol })));
  const drawable = ({ symbol }) => {
    const c = controlOf(symbol);
    return c !== undefined && !c.readonly && !c.hidden && c.kind !== 'trigger' && c.meaning !== 'bypass' && c.meaning !== 'enabled';
  };
  return easyFirst(declared, easyOf({ family: declared.family, roles, controls }, { declared: declared.easy ?? descriptor.easy, drawable, where: 'modgui-gen' }));
}

/** The Easy controls as a first section, and the rest in their sections after it, so a pedal's listed ports are the Easy ones.
 * A panel Easy holds whole keeps its sections: there is nothing to unfold. A section Easy emptied is left out. */
function easyFirst(panel, easy) {
  const listed = panel.sections.flatMap((s) => s.controls);
  if (listed.every((symbol) => easy.includes(symbol))) return panel;
  const rest = panel.sections.map((s) => ({ ...s, controls: s.controls.filter((symbol) => !easy.includes(symbol)) })).filter((s, i) => s.controls.length > 0 || panel.sections[i].controls.length === 0);
  return { ...panel, sections: [{ key: 'easy', label: EASY_PAGE, controls: easy }, ...rest] };
}

/** The panel of a descriptor, resolved: each section with its controls, each control its descriptor control's
 * symbol, name and travel. `stem` names the files. */
export function resolvePanel(descriptor, { panel: declared, stem, easyFirst: wantEasyFirst = false }) {
  const plugin = descriptor.plugin ?? {};
  const uri = plugin.format === 'lv2' ? plugin.id : plugin.uri;
  if (!uri) throw new Error(`modgui-gen: '${plugin.id}' states no LV2 URI; a MOD GUI belongs to an LV2 bundle`);
  let panel;
  try {
    panel = panelOf(descriptor, declared, wantEasyFirst);
  } catch (err) {
    throw err.code === 'PANEL_NO_CONTROLS' ? new NothingToDraw(`modgui-gen: '${stem}' has no control to draw`) : err;
  }
  const controls = descriptor.controls ?? [];
  // a control a declared rule governs carries it: the governing port's symbol and the mask of the values that show it,
  // and whether the come-up values show it
  const rules = visibilityRules(descriptor, panel.visibleWhen, `modgui-gen: '${stem}'`);
  for (const sym of rules.keys()) if (!panel.sections.some((s) => s.controls.includes(sym))) throw new Error(`modgui-gen: visibleWhen names '${sym}', which the panel does not draw`);
  const shownBy = (symbol) => {
    const r = rules.get(symbol);
    return r ? { visibleWhen: { symbol: r.symbol, mask: r.mask }, shown: ((r.mask >> BigInt(r.default)) & 1n) === 1n } : { shown: true };
  };
  const seen = new Set();
  // A trigger is momentary and how MOD-UI wires a momentary port is not verified: it is left off the face and reported.
  const skipped = [];
  const isTrigger = (symbol) => controls.find((x) => (x.symbol ?? x.id) === symbol)?.kind === 'trigger';
  const sections = panel.sections.map((s) => ({
    key: s.key,
    label: s.label,
    displays: displaysOf(descriptor, s),
    controls: s.controls.filter((symbol) => {
      if (!isTrigger(symbol)) return true;
      seen.add(symbol);
      skipped.push(symbol);
      return false;
    }).map((symbol) => {
      if (seen.has(symbol)) throw new Error(`modgui-gen: '${symbol}' is in two sections`);
      seen.add(symbol);
      const c = controls.find((x) => keyOf(x) === symbol);
      if (!c) throw new Error(`modgui-gen: panel names '${symbol}', which '${stem}' has no control for`);
      if (c.readonly) {
        if (panel.widgets?.[symbol] !== undefined) throw new Error(`modgui-gen: '${symbol}' is a readout and takes no widget`);
        return { symbol, name: c.name, widget: 'display', ...readoutRange(c), ...shownBy(symbol) };
      }
      const q = travelOf(c);
      if (!q) throw new Error(`modgui-gen: '${symbol}' is not a declared control input with a travel`);
      const widget = widgetFor(panel, symbol, q);
      return { symbol, name: c.name, widget, min: q.min, max: q.max, def: q.def, unit: c.travel?.unit ?? '', ...(widget === 'selector' ? { options: optionsOf(q) } : {}), ...shownBy(symbol) };
    }),
  })).filter((s, i) => s.controls.length > 0 || panel.sections[i].controls.length === 0);
  for (const symbol of Object.keys(panel.widgets ?? {})) if (!seen.has(symbol)) throw new Error(`modgui-gen: widgets names '${symbol}', which the panel does not draw`);
  if (sections.length === 0 || sections[0].controls.length === 0) throw new NothingToDraw(`modgui-gen: '${stem}' has no control to draw`);
  // the static curve of each display, at the come-up values, by omx-dsp's twin (spec §7.4, Q6)
  if (sections.some((sec) => sec.displays.length > 0)) {
    const x = panelLayout(descriptor, declared ? { panel: declared, derive: true } : { derive: true });
    for (const sec of sections) for (const dsp of sec.displays) dsp.curve = staticCurve(descriptor, x, dsp);
  }
  // a bar group is a row of faders (the one-panel spec §7.4): each bar an ordinary fader port, MOD's own fader film moving it live,
  // its label the bar's. A declared section's `bars` word wins over the rule (tools/bars.mjs); the rule's refusals are by code.
  for (const sec of sections) {
    const word = panel.sections.find((p) => p.key === sec.key)?.bars;
    const items = sec.controls.map((k) => ({ symbol: k.symbol, label: k.name, control: controls.find((x) => keyOf(x) === k.symbol) }));
    const { runs, refusal } = barsOf(items, word);
    if (refusal) throw new BarsRefused(`modgui-gen: '${stem}' section '${sec.key}' declares bars: ${refusal.why}`, refusal.code);
    if (runs.length === 0) continue;
    sec.bars = runs;
    for (const run of runs) {
      run.controls.forEach((symbol, at) => {
        const k = sec.controls.find((x) => x.symbol === symbol);
        k.widget = 'fader';
        delete k.options;
        k.bar = run.labels[at];
      });
    }
  }
  return { uri, stem, name: plugin.name, brand: plugin.vendor || plugin.name || stem, family: panel.family, sections, skipped };
}

/** Every box of the face, in px at scale 1: what the template positions and the raster paints. */
export function layout(panel) {
  const g = GEOMETRY;
  // a curve row needs a width of its own: three cells
  const most = Math.min(ROW_CONTROLS, Math.max(...panel.sections.map((s) => Math.max(s.controls.length, s.displays.length > 0 ? 3 : 0))));
  const sectionW = most * g.cellW + 2 * g.sectionPad;
  let y = g.sectionTop;
  const sections = panel.sections.map((s) => {
    const rows = Math.ceil(s.controls.length / ROW_CONTROLS);
    const curves = s.displays.length * (g.curveH + g.curveGap);
    const h = g.sectionTitleH + curves + rows * g.cellH + g.sectionPad / 2;
    const sec = {
      ...s, x: g.pad, y, w: sectionW, h,
      controls: s.controls.map((c, j) => ({ ...c, x: g.sectionPad + (j % ROW_CONTROLS) * g.cellW, y: g.sectionTitleH + curves + Math.floor(j / ROW_CONTROLS) * g.cellH })),
    };
    y += h + g.sectionGap;
    return sec;
  });
  const last = sections[sections.length - 1];
  return { w: sectionW + 2 * g.pad, h: last.y + last.h + g.pad, sections };
}

/** The look: tools/look.json, every colour a plain #rrggbb. */
export function loadLook() {
  const look = JSON.parse(readFileSync(LOOK_JSON, 'utf8'));
  const tokens = {};
  for (const k of LOOK_TOKENS) {
    const v = look.tokens?.[k];
    if (typeof v !== 'string' || !v) throw new Error(`modgui-gen: tools/look.json resolves no ${k}`);
    if (!NOT_COLOURS.includes(k)) rgbOf(v);
    tokens[k] = v;
  }
  const fontFile = resolve(TOOLS, tokens['--font-file']);
  if (!fontFile.startsWith(`${TOOLS}${sep}`)) throw new Error(`modgui-gen: --font-file '${tokens['--font-file']}' leaves tools/`);
  return { theme: look.theme, personality: look.personality, tokens, font: parseFont(readFileSync(fontFile)) };
}

/** The literal colours and font the face wears. */
export const lookTokens = () => loadLook().tokens;

// ------------------------------------------------------------------------------------ drawing

/** One knob at travel fraction `f`: rim, body, pointer over a 270° sweep from the lower left. */
function drawKnob(c, cx, cy, r, f, col) {
  disc(c, cx, cy, r, col.rim);
  disc(c, cx, cy, r - Math.max(1, r * 0.08), col.body);
  const th = (-135 + 270 * Math.min(1, Math.max(0, f))) * (Math.PI / 180);
  const sx = Math.sin(th), sy = -Math.cos(th); // the segment snaps its ends
  segment(c, cx + sx * r * 0.28, cy + sy * r * 0.28, cx + sx * r * 0.78, cy + sy * r * 0.78, Math.max(0.75, r * 0.08), col.accent);
}

/** A selector: a box, and a mark along its foot at the selected option's place among `n`. */
function drawSelector(c, x, y, w, h, at, n, col) {
  roundRect(c, x, y, w, h, Math.min(4, h / 4), col.rim);
  roundRect(c, x + 1, y + 1, w - 2, h - 2, Math.min(3, h / 4), col.body);
  const seg = (w - 4) / Math.max(1, n);
  roundRect(c, x + 2 + at * seg, y + h - 4, Math.max(1, seg), 2, 0, col.accent);
}

/** A fader at travel fraction `f`: a slot down the middle and a cap along it, minimum at the foot. */
function drawFader(c, cx, top, h, f, col) {
  const g = GEOMETRY;
  const slot = Math.max(1, g.faderW * 0.25 * (h / g.knob));
  const cap = g.faderCap * (h / g.knob);
  roundRect(c, cx - slot / 2, top + cap / 2, slot, h - cap, slot / 2, col.rim);
  const y = top + (1 - Math.min(1, Math.max(0, f))) * (h - cap);
  roundRect(c, cx - (g.faderW * (h / g.knob)) / 2, y, g.faderW * (h / g.knob), cap, Math.min(2, cap / 4), col.inkDim);
  roundRect(c, cx - (g.faderW * (h / g.knob)) / 2, y + cap / 2 - 0.5, g.faderW * (h / g.knob), 1, 0, col.accent);
}

/** A readout's display: the selector's frame, empty (a reading has no default to show). */
function drawDisplay(c, x, y, w, h, col) {
  roundRect(c, x, y, w, h, Math.min(4, h / 4), col.rim);
  roundRect(c, x + 1, y + 1, w - 2, h - 2, Math.min(3, h / 4), col.body);
}

function drawSwitch(c, x, y, w, h, on, col) {
  roundRect(c, x, y, w, h, h / 2, on ? col.accent : col.body);
  const r = h / 2 - h * 0.15;
  disc(c, on ? x + w - h / 2 : x + h / 2, y + h / 2, r, on ? col.ink : col.inkDim);
}

const palette = (tok) => ({
  surface: rgbOf(tok['--surface']), section: rgbOf(tok['--surface-2']), body: rgbOf(tok['--surface-3']),
  rim: rgbOf(tok['--border-strong']), ink: rgbOf(tok['--ink']), inkDim: rgbOf(tok['--ink-dim']), accent: rgbOf(tok['--accent']),
});

/** Text sizes and baselines, in px at scale 1: the template's 10 px small text and 14 px title. */
const TEXT = Object.freeze(FACE.text);

/** The default a control shows, with its unit: a number to three significant figures, an option's label, On or Off. */
export function valueText(k) {
  if (k.widget === 'selector') return k.options.find((o) => o.value === k.def)?.label ?? `${k.def}`;
  if (k.widget === 'switch') return k.def >= 0.5 ? 'On' : 'Off';
  const span = Math.abs(k.max - k.min);
  const places = Math.max(0, Math.min(3, 2 - Math.floor(Math.log10(Math.max(Math.abs(k.def), span / 10) || 1))));
  const n = k.def.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return k.unit ? `${n} ${k.unit}` : n;
}

/** The face at `scale`, every control at its declared default. */
export function renderFace(lay, look, scale) {
  const g = GEOMETRY, tok = look.tokens, font = look.font, col = palette(tok), s = scale;
  const c = canvas(Math.round(lay.w * s), Math.round(lay.h * s));
  roundRect(c, 0, 0, lay.w * s, lay.h * s, g.radius * s, col.rim);
  roundRect(c, s, s, (lay.w - 2) * s, (lay.h - 2) * s, (g.radius - 1) * s, col.surface);
  roundRect(c, s, (g.headH - 2) * s, (lay.w - 2) * s, 2 * s, 0, col.accent);
  disc(c, (lay.w - g.pad - 10) * s, (g.headH / 2) * s, 5 * s, col.accent);
  const headW = (lay.w - 2 * g.pad - 24) * s;
  drawText(c, font, fitText(font, lay.brand.toUpperCase(), TEXT.brand * s, headW), g.pad * s, TEXT.brandBase * s, TEXT.brand * s, col.inkDim);
  drawText(c, font, fitText(font, lay.name, TEXT.title * s, headW), g.pad * s, TEXT.titleBase * s, TEXT.title * s, col.ink);
  for (const sec of lay.sections) {
    roundRect(c, sec.x * s, sec.y * s, sec.w * s, sec.h * s, g.sectionRadius * s, col.section);
    drawText(c, font, fitText(font, sec.label.toUpperCase(), TEXT.small * s, (sec.w - 2 * g.sectionPad) * s), (sec.x + g.sectionPad) * s, (sec.y + TEXT.sectionBase) * s, TEXT.small * s, col.inkDim);
    // the curves: a frame with the basis word in the caption place; the points are drawn when a build has them (a host's curve is its own)
    sec.displays.forEach((dsp, m) => {
      const cx = (sec.x + g.sectionPad) * s, cy = (sec.y + g.sectionTitleH + m * (g.curveH + g.curveGap)) * s, cw = (sec.w - 2 * g.sectionPad) * s, ch = g.curveH * s;
      roundRect(c, cx, cy, cw, ch, Math.min(4, ch / 4), col.rim);
      roundRect(c, cx + 1, cy + 1, cw - 2, ch - 2, Math.min(3, ch / 4), col.body);
      drawText(c, font, fitText(font, dsp.basis, TEXT.small * s, cw - 12 * s), cx + 6 * s, cy + ch - 5 * s, TEXT.small * s, col.inkDim);
      const geo = curveGeometry(dsp.curve, dsp.kind, cw, ch, s);
      if (!geo) return;
      const [ax, ay, bx, by] = geo.axis;
      segment(c, cx + ax, cy + ay, cx + bx, cy + by, Math.max(0.5, 0.5 * s), col.rim);
      for (let k = 1; k < geo.poly.length; k++) segment(c, cx + geo.poly[k - 1][0], cy + geo.poly[k - 1][1], cx + geo.poly[k][0], cy + geo.poly[k][1], Math.max(0.75, 0.75 * s), col.accent);
      for (const m of geo.marks) {
        disc(c, cx + m.at[0], cy + m.at[1], Math.max(2, 2.5 * s), col.ink);
        drawText(c, font, m.letter, cx + m.at[0], cy + m.at[1] - 5 * s, TEXT.small * s, col.ink, 'centre');
      }
    });
    for (const k of sec.controls) {
      // a control the come-up values hide is not on the screenshot, as the face hides it
      if (!k.shown) continue;
      const x = sec.x + k.x, y = sec.y + k.y;
      if (k.widget === 'display') {
        drawDisplay(c, (x + (g.cellW - g.selectorW) / 2) * s, (y + g.selectorTop) * s, g.selectorW * s, g.selectorH * s, col);
      } else if (k.widget === 'switch') {
        drawSwitch(c, (x + (g.cellW - g.switchW) / 2) * s, (y + g.switchTop) * s, g.switchW * s, g.switchH * s, k.def >= 0.5, col);
      } else if (k.widget === 'selector') {
        const at = Math.max(0, k.options.findIndex((o) => o.value === k.def));
        drawSelector(c, (x + (g.cellW - g.selectorW) / 2) * s, (y + g.selectorTop) * s, g.selectorW * s, g.selectorH * s, at, k.options.length, col);
      } else if (k.widget === 'fader') {
        drawFader(c, (x + g.cellW / 2) * s, (y + g.knobTop) * s, g.knob * s, travelFraction(k, k.def), col);
      } else {
        drawKnob(c, (x + g.cellW / 2) * s, (y + g.knobTop + g.knob / 2) * s, (g.knob / 2) * s, travelFraction(k, k.def), col);
      }
      const mid = (x + g.cellW / 2) * s, fit = (g.cellW - 4) * s;
      drawText(c, font, fitText(font, k.bar ?? k.name, TEXT.small * s, fit), mid, (y + TEXT.nameBase) * s, TEXT.small * s, col.inkDim, 'centre');
      if (k.widget === 'selector') {
        const shown = fitText(font, valueText(k), TEXT.small * s, (g.selectorW - 8) * s);
        drawText(c, font, shown, mid, (y + g.selectorTop + g.selectorH / 2 + TEXT.small * 0.36) * s, TEXT.small * s, col.ink, 'centre');
      } else if (k.widget !== 'display') {
        drawText(c, font, fitText(font, valueText(k), TEXT.small * s, fit), mid, (y + TEXT.valueBase) * s, TEXT.small * s, col.ink, 'centre');
      }
    }
  }
  return encodePng(c);
}

/** MOD's film strip: `filmFrames` square frames left to right, the knob from minimum to maximum. */
export function renderFilm(tok) {
  const g = GEOMETRY, col = palette(tok), n = g.filmFrames;
  const c = canvas(g.knob * n, g.knob);
  for (let i = 0; i < n; i++) drawKnob(c, i * g.knob + g.knob / 2, g.knob / 2, g.knob / 2 - 1, i / (n - 1), col);
  return encodePng(c, g.knob);
}

/** The fader's film strip: the same square frames, the fader from minimum to maximum. */
export function renderFaderFilm(tok) {
  const g = GEOMETRY, col = palette(tok), n = g.filmFrames;
  const c = canvas(g.knob * n, g.knob);
  for (let i = 0; i < n; i++) drawFader(c, i * g.knob + g.knob / 2, 0, g.knob, i / (n - 1), col);
  return encodePng(c, g.knob);
}

// ------------------------------------------------------------------------------------- text

const banner = (lead, source) => [
  `${lead}SPDX-License-Identifier: GPL-3.0-or-later`,
  `${lead}Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>`,
  `${lead}GENERATED — DO NOT EDIT BY HAND. Produced by tools/modgui-gen.mjs from`,
  `${lead}${source}`,
  `${lead}Regenerate: \`node tools/modgui-gen.mjs\`, then commit the result.`,
];

const files = (stem) => ({
  template: `${MODGUI_DIR}/icon-${stem}.html`,
  stylesheet: `${MODGUI_DIR}/stylesheet-${stem}.css`,
  screenshot: `${MODGUI_DIR}/screenshot-${stem}.png`,
  thumbnail: `${MODGUI_DIR}/thumbnail-${stem}.png`,
  film: `${MODGUI_DIR}/knobs/omx-knob.png`,
  faderFilm: `${MODGUI_DIR}/knobs/omx-fader.png`,
  script: `${MODGUI_DIR}/script-${stem}.js`,
});

/** Whether any control of the panel is shown by another control's value. */
const governs = (panel) => panel.sections.some((x) => x.controls.some((k) => k.visibleWhen));

/** Whether any control of the panel is drawn with `widget`. */
const draws = (panel, widget) => panel.sections.some((x) => x.controls.some((k) => k.widget === widget));

/** `modgui.ttl`: the gui resource, and `modgui:port` for every input control of the FIRST section (a readout is
 * none); a modgui:port's lv2:index is its order on the pedal, its symbol and name the LV2 port's. */
export function emitModguiTtl(panel, source) {
  const f = files(panel.stem);
  const ports = panel.sections[0].controls
    .filter((k) => k.widget !== 'display')
    .map((k, i) => `            lv2:index ${i} ;\n            lv2:symbol "${k.symbol}" ;\n            lv2:name ${ttlStr(k.name)} ;\n`)
    .join('        ] , [\n');
  return `${banner('# ', source).join('\n')}
@prefix lv2:    <http://lv2plug.in/ns/lv2core#> .
@prefix modgui: <http://moddevices.com/ns/modgui#> .

<${panel.uri}>
    modgui:gui [
        modgui:resourcesDirectory <${MODGUI_DIR}> ;
        modgui:iconTemplate <${f.template}> ;
        modgui:stylesheet <${f.stylesheet}> ;
        modgui:screenshot <${f.screenshot}> ;
        modgui:thumbnail <${f.thumbnail}> ;
        modgui:brand ${ttlStr(panel.brand)} ;
        modgui:label ${ttlStr(panel.name)} ;
${governs(panel) ? `        modgui:javascript <${f.script}> ;
` : ''}${ports ? `        modgui:port [
${ports}        ] ;
` : ''}    ] .
`;
}

/** The icon template, in MOD's documented format: every section and every control, laid out. */
export function emitTemplate(panel, lay, source) {
  const g = GEOMETRY;
  // a governed control names its governing port and the mask of the values that show it; the script reads them
  const vis = (k) => (k.visibleWhen ? ` data-visible-port="${k.visibleWhen.symbol}" data-visible-mask="${k.visibleWhen.mask.toString(16)}"` : '');
  const at = (k) => `left:${k.x}px;top:${k.y}px${k.shown ? '' : ';display:none'}`;
  const control = (k) => {
    // a readout is a display: its symbol and range, no default and no port role (MOD has none for an output port)
    if (k.widget === 'display') {
      const range = k.min === undefined ? '' : ` data-min="${k.min}" data-max="${k.max}"`;
      return `            <div class="omx-control omx-display" style="${at(k)}" title="${esc(k.name)}" data-symbol="${k.symbol}"${range}${vis(k)}>
                <div class="omx-display-image"></div>
                <span class="omx-control-title">${esc(k.name)}</span>
            </div>`;
    }
    const data = `data-symbol="${k.symbol}" data-min="${k.min}" data-max="${k.max}" data-default="${k.def}"`;
    // a selector is MOD's custom-select over the port's values: the shown value and one option each
    const options = (k.options ?? []).map((o) => `\n                    <div class="omx-selector-option" mod-role="enumeration-option" mod-port-value="${o.value}">${esc(o.label)}</div>`).join('');
    const image = k.widget === 'switch'
      ? `<div class="omx-switch-image" mod-role="input-control-port" mod-port-symbol="${k.symbol}" mod-widget="switch"></div>`
      : k.widget === 'selector'
        ? `<div class="omx-selector-image" mod-role="input-control-port" mod-port-symbol="${k.symbol}" mod-widget="custom-select">
                    <div class="omx-selector-value" mod-role="input-control-value" mod-port-symbol="${k.symbol}"></div>
                    <div class="omx-selector-list">${options}
                    </div>
                </div>`
        : `<div class="omx-${k.widget}-image" mod-role="input-control-port" mod-port-symbol="${k.symbol}"></div>`;
    return `            <div class="omx-control omx-${k.widget}${k.bar === undefined ? '' : ' omx-bar'}" style="${at(k)}" title="${esc(k.name)}" ${data}${vis(k)}>
                ${image}
                <span class="omx-control-title">${esc(k.bar ?? k.name)}</span>
            </div>`;
  };
  // a curve's stroke, its axis and its marks, a static SVG in the frame's own px: the geometry the raster draws
  const plot = (dsp, w) => {
    const geo = curveGeometry(dsp.curve, dsp.kind, w, g.curveH, 1);
    if (!geo) return '';
    const n = (v) => Math.round(v * 100) / 100;
    const marks = geo.marks.map((m) => `<circle cx="${n(m.at[0])}" cy="${n(m.at[1])}" r="2.5"/><text x="${n(m.at[0])}" y="${n(m.at[1] - 5)}" text-anchor="middle">${m.letter}</text>`).join('');
    return `<svg class="omx-curve-plot" width="${w}" height="${g.curveH}" viewBox="0 0 ${w} ${g.curveH}"><line class="omx-curve-axis" x1="${n(geo.axis[0])}" y1="${n(geo.axis[1])}" x2="${n(geo.axis[2])}" y2="${n(geo.axis[3])}"/><polyline class="omx-curve-line" fill="none" points="${geo.poly.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}"/>${marks}</svg>`;
  };
  const sections = lay.sections.map((s) => `        <div class="omx-section" data-section="${s.key}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px">
            <h2 class="omx-section-title">${esc(s.label)}</h2>
${s.displays.map((dsp, m) => `            <div class="omx-curve" data-kind="${dsp.kind}" data-basis="${dsp.basis}" style="left:${g.sectionPad}px;top:${g.sectionTitleH + m * (g.curveH + g.curveGap)}px;width:${s.w - 2 * g.sectionPad}px;height:${g.curveH}px">${plot(dsp, s.w - 2 * g.sectionPad)}<span class="omx-curve-caption">${dsp.basis}</span></div>\n`).join('')}${s.controls.map(control).join('\n')}
        </div>`).join('\n');
  const jacks = (dir) => ['audio', 'midi', 'cv'].map((kind) => `        {{#effect.ports.${kind}.${dir}}}
        <div class="mod-${dir} mod-${dir}-disconnected" title="{{name}}" mod-role="${dir}-${kind}-port" mod-port-symbol="{{symbol}}">
            <div class="mod-pedal-${dir}-image"></div>
        </div>
        {{/effect.ports.${kind}.${dir}}}`).join('\n');
  return `<div class="omx-pedal{{{cns}}} omx-family-${panel.family}" style="width:${lay.w}px;height:${lay.h}px">
${banner('    <!-- ', source).map((l) => `${l} -->`).join('\n')}
    <!-- Template format: MOD Devices' modgui (mod-ui, https://github.com/moddevices/mod-ui, and the
         MOD SDK's icon-template documentation) — Mustache, mod-role / mod-port-symbol, the {{{cns}}}
         and {{{ns}}} scoping, MOD's own drag-handle, bypass and jack roles. Credited, not copied. -->
    <div mod-role="drag-handle" class="mod-drag-handle"></div>
    <div class="omx-head" style="height:${g.headH}px">
        <span class="omx-brand">{{brand}}</span>
        <span class="omx-label">{{label}}</span>
        <div class="omx-bypass" mod-role="bypass"><div class="omx-bypass-light" mod-role="bypass-light"></div></div>
    </div>
${sections}
    <div class="mod-pedal-input">
${jacks('input')}
    </div>
    <div class="mod-pedal-output">
${jacks('output')}
    </div>
</div>
`;
}

/** The stylesheet: the GEOMETRY and the look's resolved tokens, scoped by MOD's {{{cns}}}. */
export function emitStylesheet(panel, look, source) {
  const g = GEOMETRY, f = files(panel.stem), tok = look.tokens;
  const P = '.omx-pedal{{{cns}}}';
  const film = `/resources/${relative(MODGUI_DIR, f.film)}{{{ns}}}`;
  const faderFilm = `/resources/${relative(MODGUI_DIR, f.faderFilm)}{{{ns}}}`;
  return `/*
${banner(' * ', source).join('\n')}
 * Colours and font: the OpenMixer console's ${look.theme} theme, resolved in tools/look.json.
 */
${P} { position: relative; box-sizing: border-box; background: ${tok['--surface']}; border: 1px solid ${tok['--border-strong']}; border-radius: ${g.radius}px; color: ${tok['--ink']}; font-family: ${tok['--font-ui']}; }
${P} .omx-head { position: absolute; left: 0; right: 0; top: 0; border-bottom: 2px solid ${tok['--accent']}; }
${P} .omx-brand { position: absolute; left: ${g.pad}px; top: 5px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: ${tok['--ink-dim']}; }
${P} .omx-label { position: absolute; left: ${g.pad}px; top: 17px; font-size: 14px; font-weight: 600; }
${P} .omx-bypass { position: absolute; right: ${g.pad}px; top: ${g.headH / 2 - 10}px; width: 20px; height: 20px; cursor: pointer; }
${P} .omx-bypass-light { width: 10px; height: 10px; margin: 5px; border-radius: 50%; background: ${tok['--surface-3']}; }
${P} .omx-bypass-light.on { background: ${tok['--accent']}; }
${P} .omx-section { position: absolute; box-sizing: border-box; background: ${tok['--surface-2']}; border-radius: ${g.sectionRadius}px; }
${P} .omx-section-title { margin: 0; padding: 3px ${g.sectionPad}px; height: ${g.sectionTitleH}px; box-sizing: border-box; font-size: 10px; font-weight: 600; text-transform: uppercase; color: ${tok['--ink-dim']}; }
${P} .omx-control { position: absolute; width: ${g.cellW}px; height: ${g.cellH}px; text-align: center; }
${P} .omx-knob-image { width: ${g.knob}px; height: ${g.knob}px; margin: ${g.knobTop}px auto 0; background-image: url(${film}); background-repeat: no-repeat; background-size: auto ${g.knob}px; cursor: pointer; }
${draws(panel, 'fader') ? `${P} .omx-fader-image { width: ${g.knob}px; height: ${g.knob}px; margin: ${g.knobTop}px auto 0; background-image: url(${faderFilm}); background-repeat: no-repeat; background-size: auto ${g.knob}px; cursor: pointer; }
` : ''}${P} .omx-switch-image { position: relative; width: ${g.switchW}px; height: ${g.switchH}px; margin: ${g.switchTop}px auto ${g.knob + g.knobTop - g.switchTop - g.switchH}px; border-radius: ${g.switchH / 2}px; background: ${tok['--surface-3']}; cursor: pointer; }
${P} .omx-switch-image::after { content: ''; position: absolute; top: 3px; left: 3px; width: ${g.switchH - 6}px; height: ${g.switchH - 6}px; border-radius: 50%; background: ${tok['--ink-dim']}; }
${P} .omx-switch-image.on { background: ${tok['--accent']}; }
${P} .omx-switch-image.on::after { left: ${g.switchW - g.switchH + 3}px; background: ${tok['--ink']}; }
${P} .omx-control-title { display: block; margin-top: 6px; font-size: 10px; color: ${tok['--ink-dim']}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${draws(panel, 'selector') ? `${P} .omx-selector-image { position: relative; box-sizing: border-box; width: ${g.selectorW}px; height: ${g.selectorH}px; margin: ${g.selectorTop}px auto ${g.knob + g.knobTop - g.selectorTop - g.selectorH}px; border: 1px solid ${tok['--border-strong']}; border-radius: 4px; background: ${tok['--surface-3']}; cursor: pointer; }
${P} .omx-selector-value { font-size: 10px; line-height: ${g.selectorH - 2}px; color: ${tok['--ink']}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${P} .omx-selector-list { display: none; position: absolute; left: 0; top: ${g.selectorH}px; z-index: 10; min-width: 100%; background: ${tok['--surface-3']}; border: 1px solid ${tok['--border-strong']}; border-radius: 4px; }
${P} .omx-selector-image.selecting .omx-selector-list, ${P} .omx-selector-image.open .omx-selector-list { display: block; }
${P} .omx-selector-option { padding: 2px 6px; font-size: 10px; text-align: left; white-space: nowrap; }
${P} .omx-selector-option.selected { color: ${tok['--accent']}; }
` : ''}${panel.sections.some((x) => x.displays.length > 0) ? `${P} .omx-curve { position: absolute; box-sizing: border-box; border: 1px solid ${tok['--border-strong']}; border-radius: 4px; background: ${tok['--surface-3']}; }
${P} .omx-curve-plot { position: absolute; left: 0; top: 0; }
${P} .omx-curve-axis { stroke: ${tok['--border-strong']}; stroke-width: 0.5; }
${P} .omx-curve-line { stroke: ${tok['--accent']}; stroke-width: 1.5; stroke-linejoin: round; }
${P} .omx-curve-plot circle { fill: ${tok['--ink']}; }
${P} .omx-curve-plot text { fill: ${tok['--ink']}; font-size: 10px; }
${P} .omx-curve-caption { position: absolute; left: 6px; bottom: 2px; font-size: 10px; color: ${tok['--ink-dim']}; }
` : ''}${draws(panel, 'display') ? `${P} .omx-display-image { box-sizing: border-box; width: ${g.selectorW}px; height: ${g.selectorH}px; margin: ${g.selectorTop}px auto ${g.knob + g.knobTop - g.selectorTop - g.selectorH}px; border: 1px solid ${tok['--border-strong']}; border-radius: 4px; background: ${tok['--surface-3']}; }
` : ''}`;
}

/** The modgui's script, in MOD's documented format (a function of the event and MOD's helpers): on start and on each port
 * change, every control that names the changed port as its governing one is shown while bit `value` of its mask is set. */
export function emitScript(source) {
  return `${banner('// ', source).join('\n')}
function (event, funcs) {
    var show = function (symbol, value) {
        var v = Math.round(value);
        event.icon.find('[data-visible-port="' + symbol + '"]').each(function () {
            // the mask is 64 bits of hex: the half that holds bit v, read as a plain number
            var hex = this.getAttribute('data-visible-mask');
            while (hex.length < 16) hex = '0' + hex;
            var word = parseInt(v < 32 ? hex.slice(8) : hex.slice(0, 8), 16);
            var on = v >= 0 && v <= 63 && Math.floor(word / Math.pow(2, v % 32)) % 2 === 1;
            this.style.display = on ? '' : 'none';
        });
    };
    if (event.type === 'start') {
        for (var i = 0; i < event.ports.length; i++) show(event.ports[i].symbol, event.ports[i].value);
    } else if (event.type === 'change') {
        show(event.symbol, event.value);
    }
}
`;
}

/** Every file of a descriptor's modgui, as [path relative to the LV2 bundle, bytes], in a fixed order. `source`
 * is what the banner names the files were made from. */
export function generateModgui(descriptor, { panel: declared, stem, source, easyFirst: wantEasyFirst = false }, look = loadLook()) {
  const panel = resolvePanel(descriptor, { panel: declared, stem, easyFirst: wantEasyFirst });
  const lay = { ...layout(panel), brand: panel.brand, name: panel.name ?? panel.stem };
  const f = files(panel.stem);
  return [
    [MODGUI_TTL, Buffer.from(emitModguiTtl(panel, source))],
    [f.template, Buffer.from(emitTemplate(panel, lay, source))],
    [f.stylesheet, Buffer.from(emitStylesheet(panel, look, source))],
    [f.screenshot, renderFace(lay, look, 1)],
    [f.thumbnail, renderFace(lay, look, GEOMETRY.thumbScale)],
    [f.film, renderFilm(look.tokens)],
    ...(draws(panel, 'fader') ? [[f.faderFilm, renderFaderFilm(look.tokens)]] : []),
    ...(governs(panel) ? [[f.script, Buffer.from(emitScript(source))]] : []),
  ];
}

/** Every file under `dir`, relative to `base`, sorted. */
function walk(dir, base) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))]).sort();
}

const SEE_ALSO = 'http://www.w3.org/2000/01/rdf-schema#seeAlso';

const MANIFEST_BASE = 'file:///bundle/manifest.ttl';

/**
 * Whether a bundle manifest points a lilv host at modgui.ttl: a seeAlso triple with that object, read as Turtle, so any
 * spelling and any place in an object list. A manifest that is not Turtle throws, naming the line: lilv cannot read it either.
 */
export function manifestSeesModgui(text) {
  const want = new URL(MODGUI_TTL, MANIFEST_BASE).href;
  return parseTurtle(text, MANIFEST_BASE).some(({ p, o }) => p.v === SEE_ALSO && o.t === 'iri' && o.v === want);
}

/** The manifest with `<uri> rdfs:seeAlso <modgui.ttl>` added, or unchanged when it already has it. */
export function withModguiSeeAlso(text, uri) {
  if (manifestSeesModgui(text)) return text;
  return `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}\n<${uri}> <${SEE_ALSO}> <${MODGUI_TTL}> .\n`;
}

const USAGE = 'usage: modgui-gen.mjs [--check|--emit-stdout] [--no-films|--films-only] (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>]\n       exit 0 made or fresh, 1 stale (--check) or a refusal by code (MODGUI_CHOICE_NO_VALUES), 2 usage, 3 nothing to draw (no visible control); a trigger control is left off the face and named on stderr';

export function main(argv) {
  const check = argv.includes('--check');
  const toStdout = argv.includes('--emit-stdout');
  const noFilms = argv.includes('--no-films');
  const filmsOnly = argv.includes('--films-only');
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const out = opt('--out');
  const descriptorFile = opt('--descriptor') ?? (opt('--installed') && installedDescriptorFile(opt('--installed')));
  if (!out || !descriptorFile || (noFilms && filmsOnly)) {
    console.error(USAGE);
    process.exit(2);
  }
  const panelFile = opt('--panel');
  const shownIn = (p) => relative(process.cwd(), p);
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8'));
  const panel = panelFile ? JSON.parse(readFileSync(panelFile, 'utf8')) : undefined;
  const stem = opt('--stem') ?? basename(resolve(out), '.lv2');
  const source = opt('--source') ?? `${shownIn(descriptorFile)}${panelFile ? ` and ${shownIn(panelFile)}` : ''} and tools/look.json`;
  const look = loadLook();
  let stale = 0;
  const dir = resolve(out);
  const shown = (p) => relative(process.cwd(), join(dir, p));
  const manifest = join(dir, 'manifest.ttl');
  const manifestText = !toStdout && existsSync(manifest) ? readFileSync(manifest, 'utf8') : null;
  let manifestSees = false;
  try {
    manifestSees = manifestText !== null && manifestSeesModgui(manifestText);
  } catch (err) {
    console.error(`modgui: MANIFEST ${shown('manifest.ttl')}: ${err.message}`);
    process.exit(1);
  }
  let made;
  try {
    made = generateModgui(descriptor, { panel, stem, source, easyFirst: argv.includes('--easy-first') }, look);
  } catch (err) {
    if (err.code === 'MODGUI_CHOICE_NO_VALUES') {
      console.error(`${err.code}: ${err.message}`);
      process.exit(1);
    }
    if (err.code !== 'MODGUI_NOTHING_TO_DRAW') throw err;
    console.error(err.message);
    process.exit(3);
  }
  // the film strips are every bundle's same render of the look: a tree that does not track them leaves them out, and
  // its build writes only them into the built bundle
  const films = new Set(Object.entries(files(stem)).filter(([k]) => k === 'film' || k === 'faderFilm').map(([, p]) => p));
  if (noFilms) made = made.filter(([p]) => !films.has(p));
  if (filmsOnly) made = made.filter(([p]) => films.has(p));
  for (const symbol of resolvePanel(descriptor, { panel, stem }).skipped) console.error(`modgui: skipped trigger control '${symbol}'`);
  if (toStdout) {
    for (const [p, bytes] of made) {
      if (p.endsWith('.png')) process.stdout.write(`# ${shown(p)}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}\n`);
      else process.stdout.write(bytes);
    }
  } else if (check) {
    for (const [p, bytes] of made) {
      const at = join(dir, p);
      if (!existsSync(at) || !readFileSync(at).equals(bytes)) {
        console.error(`modgui: STALE ${shown(p)} (run \`node tools/modgui-gen.mjs\`)`);
        stale++;
      }
    }
    if (manifestText !== null && !manifestSees) {
      console.error(`modgui: MANIFEST ${shown('manifest.ttl')} has no rdfs:seeAlso <${MODGUI_TTL}>, so a lilv host never reads the MOD GUI (run \`node tools/modgui-gen.mjs\`)`);
      stale++;
    }
    const want = new Set(made.map(([p]) => p));
    for (const p of walk(join(dir, MODGUI_DIR), dir)) {
      if (!want.has(p)) {
        console.error(`modgui: EXTRA ${shown(p)} is not generated — a stale modgui file; delete it`);
        stale++;
      }
    }
  } else {
    if (!filmsOnly) rmSync(join(dir, MODGUI_DIR), { recursive: true, force: true });
    for (const [p, bytes] of made) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), bytes);
      console.log(`modgui: wrote ${shown(p)}`);
    }
    // a lilv host reads modgui.ttl only if the bundle manifest points at it; with no manifest nothing is created
    if (manifestText !== null) {
      const next = withModguiSeeAlso(manifestText, resolvePanel(descriptor, { panel, stem }).uri);
      if (next !== manifestText) {
        writeFileSync(manifest, next);
        console.log(`modgui: added rdfs:seeAlso <${MODGUI_TTL}> to ${shown('manifest.ttl')}`);
      }
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log('modgui: every generated file is fresh');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
