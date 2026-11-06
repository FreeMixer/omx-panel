// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe.mjs — the one derivation of a plugin's panel description (the one-panel spec §3.1): the descriptor, a user's
 * override layers and a skin in; the description every surface draws, and the refusals, out. It never throws: each
 * throw of the layout (no controls, a bad key, a family its meanings do not back, a bar group the rule refuses)
 * is a refusal by code.
 *
 *   describe(descriptor, { overrides, applyOverride, skin, panel, ns }) -> { description, refusals }
 *
 * - the override layers are omx-contract's `applyOverride` over the descriptor (the caller passes the function; omx-contract
 *   does not export it from its package entry), before the layout;
 * - the PARAMS are the effective descriptor's controls as contract facts: kind, unit and its token, scale, step, ends,
 *   default and the labels of a choice (`log` over a floor at or below zero is served linear, the same rule as omx-contract's
 *   `contract.override.scale-floor`);
 * - the FAMILY is the one general rule of §3.1.1: a candidate from the plugin's own LV2 class or CLAP feature (a fixed
 *   table, no list of plugins), kept only when the controls back every required role of the family, from descriptor
 *   words or from the meaning inference (tools/meaning-infer.mjs, each role `inferred`); else `none`. A declared panel's
 *   family, or a user's override naming one, wins and is applied as the layout applies it;
 * - the DISPLAYS of a derived panel are the family's closed form on the section holding its required roles, each with its
 *   `basis`: `exact` only when an authored descriptor declares it, else `modelled`;
 * - the ROLES carry `unit` (the contract token), `inferred`, a band's `shape` and a band-type role's `shapes`;
 * - the SECTIONS carry `bars` (tools/bars.mjs), a view of the panel that stays out of the fingerprint;
 * - the skin applies last, by `applySkinOverride`.
 */
import { applySkinOverride } from '../src/skin-package.js';
import { inferBands } from './meaning-infer.mjs';
import { FamilyNotBacked, NoControls, BarsRefused, FAMILIES, familyOf, keyOf, pagesOf, panelFingerprint, panelLayout, requiredRolesMapped, unitToken } from './panel-description.mjs';

/** The refusal codes of the derivation, beside the layout's and the bar rule's. */
export const DESCRIBE_CODES = {
  noControls: 'PANEL_NO_CONTROLS',
  familyNotBacked: 'PANEL_FAMILY_NOT_BACKED',
  layoutInvalid: 'PANEL_LAYOUT_INVALID',
  overrideUnavailable: 'PANEL_OVERRIDE_UNAVAILABLE',
  overrideRefused: 'PANEL_OVERRIDE_REFUSED',
  overrideDropped: 'PANEL_OVERRIDE_DROPPED',
  roleDropped: 'PANEL_ROLE_DROPPED',
  skinDropped: 'PANEL_SKIN_DROPPED',
};

/** What a plugin declares about itself (an LV2 class, a CLAP feature) -> the family whose closed form omx-panel knows. */
export const FAMILY_OF_DECLARED = {
  'lv2:EQPlugin': 'eq', 'lv2:ParaEQPlugin': 'eq', equalizer: 'eq',
  'lv2:CompressorPlugin': 'dynamics', compressor: 'dynamics',
  'lv2:GatePlugin': 'gate', 'lv2:ExpanderPlugin': 'gate', gate: 'gate',
  'lv2:DistortionPlugin': 'drive', distortion: 'drive',
};

const LV2_CORE = 'http://lv2plug.in/ns/lv2core#';

/**
 * The classes and features the descriptor carries as the plugin states them: its extension bag, `extensions.lv2` (a class
 * as a field, `lv2:CompressorPlugin`, or among `rdf:type`'s values) and `extensions.clap`
 * (`clap_plugin_descriptor.features`).
 */
export function declaredOf(descriptor) {
  const lv2 = descriptor.extensions?.lv2 ?? {};
  const clap = descriptor.extensions?.clap ?? {};
  const out = new Set(Object.keys(lv2).filter((k) => lv2[k] !== false && lv2[k] !== null));
  for (const t of [lv2['rdf:type']].flat()) if (typeof t === 'string') out.add(t.startsWith(LV2_CORE) ? `lv2:${t.slice(LV2_CORE.length)}` : t);
  for (const f of [clap['clap_plugin_descriptor.features']].flat()) if (typeof f === 'string') out.add(f);
  return [...out];
}

/** The candidate families of a descriptor's declarations, in the table's order and without repeats. */
export const candidatesOf = (descriptor) => [...new Set(declaredOf(descriptor).map((d) => FAMILY_OF_DECLARED[d]).filter(Boolean))];

// ---- the params: the effective descriptor's controls as contract facts ----

/** The numbers of a mask as the values that set its bits, 0..63. */
const valuesOfMask = (mask) => {
  const m = typeof mask === 'string' ? BigInt(`0x${mask}`) : BigInt(mask);
  return Array.from({ length: 64 }, (_, v) => v).filter((v) => ((m >> BigInt(v)) & 1n) === 1n);
};

/** One control as the contract facts the description serves (§3.1 `params`). */
export function servedParamOf(c) {
  const symbol = keyOf(c);
  const name = c.label ?? c.name ?? symbol;
  if (c.kind === 'trigger') return { kind: 'trigger', symbol, name, min: 0, max: 1 };
  if (c.kind === 'toggle') return { kind: 'number', symbol, name, unit: 'none', scale: 'stepped', step: 1, min: 0, max: 1, default: c.default === true ? 1 : 0 };
  if (c.kind === 'choice') {
    const values = c.values ?? c.ids.map((_, i) => i);
    const min = Math.min(...values), max = Math.max(...values);
    const at = Math.max(0, c.ids.indexOf(c.default));
    const labels = c.labels ?? c.ids;
    const enumLabels = Number.isInteger(min) && Number.isInteger(max) && max - min < 256 ? Array.from({ length: max - min + 1 }, (_, k) => labels[values.indexOf(min + k)] ?? String(min + k)) : undefined;
    return { kind: 'number', symbol, name, unit: 'none', scale: 'stepped', step: 1, min, max, default: values[at] ?? min, ...(enumLabels ? { enumLabels } : {}) };
  }
  const t = c.travel;
  const token = unitToken(t.unit);
  const stepped = t.scale === 'stepped' || (t.step ?? 0) >= 1;
  // log over a floor at or below zero is served linear (contract.override.scale-floor)
  const scale = stepped ? 'stepped' : t.scale === 'log' && t.min > 0 ? 'log' : 'linear';
  const at = t.default ?? t.min;
  return {
    kind: 'number', symbol, name, unit: token ?? 'none',
    ...(token === undefined && t.unit && t.unit !== 'unknown' ? { unitText: t.unit } : {}),
    scale, step: stepped ? Math.max(1, t.step ?? 1) : 0, min: t.min, max: t.max,
    default: stepped ? Math.min(t.max, Math.max(t.min, Math.round(at))) : at,
  };
}

// ---- the layout of a candidate family, and the family rule ----

/** The layout of `descriptor` under `family`, with the bands the meanings leave unnamed inferred (family `eq` only). */
function layoutUnder(descriptor, family, options) {
  const inferred = family === 'eq' ? inferBands(descriptor.controls) : null;
  return panelLayout(descriptor, { ...options, family, derive: true, inferredRoles: inferred?.outcome === 'inferred' ? inferred.roles : undefined });
}

/**
 * The family and layout of a plugin that declares no panel and has no override naming one (§3.1.1). One candidate from the
 * plugin's declarations, kept when the layout under it maps every required role; two or more candidates give a family only
 * when exactly one of them is kept; none, or no kept one, is `none`.
 */
export function familyRule(descriptor, options) {
  const kept = [];
  for (const family of candidatesOf(descriptor)) {
    const layout = layoutUnder(descriptor, family, options);
    if (requiredRolesMapped(family, layout.roles)) kept.push({ family, layout });
  }
  if (kept.length === 1) return kept[0];
  return { family: 'none', layout: layoutUnder(descriptor, 'none', options) };
}

const refuse = (code, args = {}) => ({ code, args });

/**
 * The description of `descriptor` and the refusals, as the header says. `description` is null when no panel can be made
 * (no control, an invalid layout); a declared family the controls do not back is `none` with its refusal.
 */
export function describe(descriptor, { overrides = [], applyOverride, skin, panel, ns, where } = {}) {
  const refusals = [];
  const plugin = descriptor.plugin?.id;
  let effective = descriptor, userFamily;
  if (overrides.length > 0) {
    if (typeof applyOverride !== 'function') refusals.push(refuse(DESCRIBE_CODES.overrideUnavailable, { plugin, layers: overrides.length }));
    else {
      const r = applyOverride(descriptor, overrides, {});
      effective = r.descriptor;
      userFamily = r.family;
      for (const x of r.refused ?? []) refusals.push(refuse(DESCRIBE_CODES.overrideRefused, { plugin, layer: x.layer, name: x.name, message: x.message }));
      for (const x of r.dropped ?? []) refusals.push(refuse(DESCRIBE_CODES.overrideDropped, { plugin, layer: x.layer, control: x.control, name: x.name, message: x.message }));
    }
  }
  const options = { panel, ns, ...(where ? { where } : {}) };
  let layout;
  // a declared family the controls do not back is refused by code and the panel is `none`: the plain sections
  const tryDeclared = (make) => {
    try {
      return make();
    } catch (e) {
      if (!(e instanceof FamilyNotBacked)) throw e;
      refusals.push(refuse(DESCRIBE_CODES.familyNotBacked, { plugin, message: e.message }));
      return panelLayout(effective, { ...options, panel: undefined, family: 'none', derive: true });
    }
  };
  try {
    if (panel) {
      // a declared panel's family, or a user's override over it, is applied as the layout applies it
      layout = tryDeclared(() => panelLayout(effective, { ...options, panel: userFamily === undefined ? panel : { ...panel, family: userFamily }, derive: true }));
    } else if (userFamily !== undefined) {
      const family = FAMILIES.includes(userFamily) ? userFamily : 'none';
      const inferred = family === 'eq' ? inferBands(effective.controls) : null;
      const { needs } = familyOf(effective.controls, family);
      layout = tryDeclared(() => {
        if (needs) throw new FamilyNotBacked(`${plugin}: the ${family} family needs a control meaning ${needs.join(' or ')}`);
        return panelLayout(effective, { ...options, family, derive: true, inferredRoles: inferred?.outcome === 'inferred' ? inferred.roles : undefined });
      });
    } else layout = familyRule(effective, options).layout;
  } catch (e) {
    const code = e instanceof NoControls ? DESCRIBE_CODES.noControls : e instanceof BarsRefused ? e.code : DESCRIBE_CODES.layoutInvalid;
    refusals.push(refuse(code, { plugin, message: e.message }));
    return { description: null, refusals };
  }
  for (const u of layout.unpublished) refusals.push(refuse(DESCRIBE_CODES.roleDropped, { plugin, entry: u.role, symbol: u.symbol, reason: u.why }));

  const params = effective.controls.map(servedParamOf);
  const visibleWhen = (c) => (c.visibleWhen ? { param: c.visibleWhen.symbol, values: valuesOfMask(c.mask) } : null);
  let description = {
    family: layout.family,
    fingerprint: panelFingerprint(layout),
    params,
    sections: layout.sections.map((s) => ({ key: s.key, labelKey: s.labelKey ?? '', label: s.label, ...(s.bars ? { bars: s.bars } : {}) })),
    controls: layout.controls.map((c) => ({ symbol: c.symbol, section: c.sectionKey, widget: c.widget, labelKey: c.labelKey ?? '', label: c.label, visibleWhen: visibleWhen(c) })),
    roles: layout.roles.map((r) => {
      const { role, index, symbol } = r;
      return { role, index, symbol, unit: r.token ?? unitToken(r.unit) ?? 'none', ...(r.shape ? { shape: r.shape } : {}), ...(r.shapes ? { shapes: r.shapes } : {}), ...(r.inferred ? { inferred: true } : {}) };
    }),
    displays: layout.displays.map((d) => ({ kind: d.kind, section: d.sectionKey, source: d.source, meterIds: d.meters, curveIndex: d.curve, floor: d.floor, labelKey: d.labelKey ?? '', label: d.label, basis: d.basis ?? 'modelled' })),
    pages: pagesOf({ ...layout, controls: layout.controls.filter((c) => params.find((p) => p.symbol === c.symbol)?.kind === 'number') }),
  };
  if (skin) {
    const applied = applySkinOverride(description, skin);
    description = applied.description;
    for (const d of applied.dropped) refusals.push(refuse(DESCRIBE_CODES.skinDropped, { plugin, field: d.field, entry: d.entry, reason: d.reason }));
  }
  return { description, refusals };
}

