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
 * template's own layout (raster.mjs) — no text, each knob at its declared default, byte-deterministic.
 *
 * Usage: `node tools/modgui-gen.mjs [--check|--emit-stdout] (--descriptor <file> | --installed <package>/<name>)
 * [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>]` — `--check` writes nothing and refuses a
 * stale, missing or extra file byte for byte; `--emit-stdout` prints every text file and one digest line per
 * image, writing nothing. `--stem` names the files (the bundle's name without .lv2 by default); `--source` is what
 * the banner names as their source (the descriptor and the panel files by default).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOK_JSON, LOOK_TOKENS } from './look.mjs';
import { panelLayout } from './panel-description.mjs';
import { canvas, disc, encodePng, rgbOf, roundRect, segment } from './raster.mjs';
import { installedDescriptorFile } from './vocabulary.mjs';

export { LOOK_JSON };
const TOOLS = dirname(fileURLToPath(import.meta.url));
/** The shared widgets, schema/panel.schema.json's `$defs.widget`: the one list a plugin's schema, this generator
 * and the console name a control's widget from. */
export const WIDGETS = Object.freeze(JSON.parse(readFileSync(join(TOOLS, '..', 'schema', 'panel.schema.json'), 'utf8')).$defs.widget.enum);
export const MODGUI_TTL = 'modgui.ttl';
export const MODGUI_DIR = 'modgui';
/** An integer travel with more steps than this is a continuous knob; fewer is a selector. */
export const MAX_SELECTOR_STEPS = 16;
/** The controls of one row of a section; a section with more wraps onto further rows. */
export const ROW_CONTROLS = 8;

/** The geometry, in CSS px: one set of numbers the template, the stylesheet and the raster read. */
export const GEOMETRY = Object.freeze({
  pad: 16, headH: 40, sectionTop: 52, sectionGap: 10, sectionPad: 8, sectionTitleH: 18,
  cellW: 72, cellH: 76, knob: 48, knobTop: 4, switchW: 40, switchH: 20, switchTop: 18,
  selectorW: 64, selectorH: 22, selectorTop: 17, faderW: 14, faderCap: 10,
  radius: 10, sectionRadius: 6, filmFrames: 65, thumbScale: 0.5,
});

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
    const points = c.values.map((value, k) => ({ value, label: c.labels?.[k] ?? c.ids[k] }));
    const at = c.ids.indexOf(c.default);
    return { kind: 'integer', min: points[0].value, max: points[points.length - 1].value, def: at >= 0 ? c.values[at] : c.default, points };
  }
  if (c.kind === 'travel') return { ...(c.travel.step === 1 ? { kind: 'integer' } : {}), min: c.travel.min, max: c.travel.max, def: c.travel.default };
  return undefined;
}

/** The labelled values of a travel, `{value, label}` from min up, or undefined. */
const choicesOf = (p) => p.points;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ttlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

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

/** The panel a descriptor is drawn with: the declared one, else the layout's sections and family over its
 * groups and meanings (tools/panel-description.mjs). */
export function panelOf(descriptor, declared) {
  if (declared) return declared;
  const x = panelLayout(descriptor);
  return { family: x.family, sections: x.sections.map((s, i) => ({ key: s.key, label: s.label, controls: x.controls.filter((c) => c.section === i).map((c) => c.symbol) })) };
}

/** The panel of a descriptor, resolved: each section with its controls, each control its descriptor control's
 * symbol, name and travel. `stem` names the files. */
export function resolvePanel(descriptor, { panel: declared, stem }) {
  const plugin = descriptor.plugin ?? {};
  const uri = plugin.format === 'lv2' ? plugin.id : plugin.uri;
  if (!uri) throw new Error(`modgui-gen: '${plugin.id}' states no LV2 URI; a MOD GUI belongs to an LV2 bundle`);
  if (!plugin.vendor) throw new Error(`modgui-gen: '${plugin.id}' states no vendor, the MOD GUI's brand`);
  const panel = panelOf(descriptor, declared);
  const controls = descriptor.controls ?? [];
  const seen = new Set();
  const sections = panel.sections.map((s) => ({
    key: s.key,
    label: s.label,
    controls: s.controls.map((symbol) => {
      if (seen.has(symbol)) throw new Error(`modgui-gen: '${symbol}' is in two sections`);
      seen.add(symbol);
      const c = controls.find((x) => (x.symbol ?? x.id) === symbol);
      if (!c) throw new Error(`modgui-gen: panel names '${symbol}', which '${stem}' has no control for`);
      const q = travelOf(c);
      if (!q) throw new Error(`modgui-gen: '${symbol}' is not a declared control input with a travel`);
      const widget = widgetFor(panel, symbol, q);
      return { symbol, name: c.name, widget, min: q.min, max: q.max, def: q.def, ...(widget === 'selector' ? { options: optionsOf(q) } : {}) };
    }),
  }));
  for (const symbol of Object.keys(panel.widgets ?? {})) if (!seen.has(symbol)) throw new Error(`modgui-gen: widgets names '${symbol}', which the panel does not draw`);
  if (sections.length === 0 || sections[0].controls.length === 0) throw new Error(`modgui-gen: '${stem}' has an empty first section`);
  return { uri, stem, name: plugin.name, brand: plugin.vendor, family: panel.family, sections };
}

/** Every box of the face, in px at scale 1: what the template positions and the raster paints. */
export function layout(panel) {
  const g = GEOMETRY;
  const most = Math.min(ROW_CONTROLS, Math.max(...panel.sections.map((s) => s.controls.length)));
  const sectionW = most * g.cellW + 2 * g.sectionPad;
  let y = g.sectionTop;
  const sections = panel.sections.map((s) => {
    const rows = Math.ceil(s.controls.length / ROW_CONTROLS);
    const h = g.sectionTitleH + rows * g.cellH + g.sectionPad / 2;
    const sec = {
      ...s, x: g.pad, y, w: sectionW, h,
      controls: s.controls.map((c, j) => ({ ...c, x: g.sectionPad + (j % ROW_CONTROLS) * g.cellW, y: g.sectionTitleH + Math.floor(j / ROW_CONTROLS) * g.cellH })),
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
    if (k !== '--font-ui') rgbOf(v);
    tokens[k] = v;
  }
  return { theme: look.theme, personality: look.personality, tokens };
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

function drawSwitch(c, x, y, w, h, on, col) {
  roundRect(c, x, y, w, h, h / 2, on ? col.accent : col.body);
  const r = h / 2 - h * 0.15;
  disc(c, on ? x + w - h / 2 : x + h / 2, y + h / 2, r, on ? col.ink : col.inkDim);
}

const palette = (tok) => ({
  surface: rgbOf(tok['--surface']), section: rgbOf(tok['--surface-2']), body: rgbOf(tok['--surface-3']),
  rim: rgbOf(tok['--border-strong']), ink: rgbOf(tok['--ink']), inkDim: rgbOf(tok['--ink-dim']), accent: rgbOf(tok['--accent']),
});

/** The face at `scale`, every control at its declared default. */
export function renderFace(lay, tok, scale) {
  const g = GEOMETRY, col = palette(tok), s = scale;
  const c = canvas(Math.round(lay.w * s), Math.round(lay.h * s));
  roundRect(c, 0, 0, lay.w * s, lay.h * s, g.radius * s, col.rim);
  roundRect(c, s, s, (lay.w - 2) * s, (lay.h - 2) * s, (g.radius - 1) * s, col.surface);
  roundRect(c, s, (g.headH - 2) * s, (lay.w - 2) * s, 2 * s, 0, col.accent);
  disc(c, (lay.w - g.pad - 10) * s, (g.headH / 2) * s, 5 * s, col.accent);
  for (const sec of lay.sections) {
    roundRect(c, sec.x * s, sec.y * s, sec.w * s, sec.h * s, g.sectionRadius * s, col.section);
    for (const k of sec.controls) {
      const x = sec.x + k.x, y = sec.y + k.y;
      if (k.widget === 'switch') {
        drawSwitch(c, (x + (g.cellW - g.switchW) / 2) * s, (y + g.switchTop) * s, g.switchW * s, g.switchH * s, k.def >= 0.5, col);
      } else if (k.widget === 'selector') {
        const at = Math.max(0, k.options.findIndex((o) => o.value === k.def));
        drawSelector(c, (x + (g.cellW - g.selectorW) / 2) * s, (y + g.selectorTop) * s, g.selectorW * s, g.selectorH * s, at, k.options.length, col);
      } else if (k.widget === 'fader') {
        drawFader(c, (x + g.cellW / 2) * s, (y + g.knobTop) * s, g.knob * s, travelFraction(k, k.def), col);
      } else {
        drawKnob(c, (x + g.cellW / 2) * s, (y + g.knobTop + g.knob / 2) * s, (g.knob / 2) * s, travelFraction(k, k.def), col);
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
});

/** Whether any control of the panel is drawn with `widget`. */
const draws = (panel, widget) => panel.sections.some((x) => x.controls.some((k) => k.widget === widget));

/** `modgui.ttl`: the gui resource, and `modgui:port` for every control of the FIRST section;
 * a modgui:port's lv2:index is its order on the pedal, its symbol and name the LV2 port's. */
export function emitModguiTtl(panel, source) {
  const f = files(panel.stem);
  const ports = panel.sections[0].controls
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
        modgui:port [
${ports}        ] ;
    ] .
`;
}

/** The icon template, in MOD's documented format: every section and every control, laid out. */
export function emitTemplate(panel, lay, source) {
  const g = GEOMETRY;
  const control = (k) => {
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
    return `            <div class="omx-control omx-${k.widget}" style="left:${k.x}px;top:${k.y}px" title="${esc(k.name)}" ${data}>
                ${image}
                <span class="omx-control-title">${esc(k.name)}</span>
            </div>`;
  };
  const sections = lay.sections.map((s) => `        <div class="omx-section" data-section="${s.key}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px">
            <h2 class="omx-section-title">${esc(s.label)}</h2>
${s.controls.map(control).join('\n')}
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
` : ''}`;
}

/** Every file of a descriptor's modgui, as [path relative to the LV2 bundle, bytes], in a fixed order. `source`
 * is what the banner names the files were made from. */
export function generateModgui(descriptor, { panel: declared, stem, source }, look = loadLook()) {
  const panel = resolvePanel(descriptor, { panel: declared, stem });
  const lay = layout(panel);
  const f = files(panel.stem);
  return [
    [MODGUI_TTL, Buffer.from(emitModguiTtl(panel, source))],
    [f.template, Buffer.from(emitTemplate(panel, lay, source))],
    [f.stylesheet, Buffer.from(emitStylesheet(panel, look, source))],
    [f.screenshot, renderFace(lay, look.tokens, 1)],
    [f.thumbnail, renderFace(lay, look.tokens, GEOMETRY.thumbScale)],
    [f.film, renderFilm(look.tokens)],
    ...(draws(panel, 'fader') ? [[f.faderFilm, renderFaderFilm(look.tokens)]] : []),
  ];
}

/** Every file under `dir`, relative to `base`, sorted. */
function walk(dir, base) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))]).sort();
}

const USAGE = 'usage: modgui-gen.mjs [--check|--emit-stdout] (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--stem <name>] [--source <text>]';

export function main(argv) {
  const check = argv.includes('--check');
  const toStdout = argv.includes('--emit-stdout');
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const out = opt('--out');
  const descriptorFile = opt('--descriptor') ?? (opt('--installed') && installedDescriptorFile(opt('--installed')));
  if (!out || !descriptorFile) {
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
  const made = generateModgui(descriptor, { panel, stem, source }, look);
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
    const want = new Set(made.map(([p]) => p));
    for (const p of walk(join(dir, MODGUI_DIR), dir)) {
      if (!want.has(p)) {
        console.error(`modgui: EXTRA ${shown(p)} is not generated — a stale modgui file; delete it`);
        stale++;
      }
    }
  } else {
    rmSync(join(dir, MODGUI_DIR), { recursive: true, force: true });
    for (const [p, bytes] of made) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), bytes);
      console.log(`modgui: wrote ${shown(p)}`);
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log('modgui: every generated file is fresh');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
