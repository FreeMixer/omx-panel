// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The skin package and the skin API's declared facts (docs/skin-package.md).
 *
 * Pure, so a console's resolver, a web interface and the generator call the SAME functions:
 * the id → directory-name encoding (§6.1), the override file's schema and its application to a
 * description (§6.3), the version rule (§7.2), the view lint (§7.3) and the resolution's shape
 * (§6.5), and the modgui import's vocabulary (§6.6): the licence allow-list and map, the known
 * modgui properties and the refusal codes the importer (`tools/modgui-import.mjs`) applies. Reading
 * the disk is the caller's.
 *
 * The description an override applies to is any value with the fields below (`SkinDescription`): a console's
 * served description is one. Its families, display kinds and sources, and the roles each family takes, are
 * tools/panel-description.mjs's, the one panel vocabulary.
 */
import { DISPLAY_KINDS, DISPLAY_SOURCES, FAMILIES, INDEXED_ROLES, ROLES, WIDGETS } from '../tools/panel-description.mjs';

/** The panel families (§4), tools/panel-description.mjs's list. */
export const PANEL_FAMILIES: readonly string[] = FAMILIES;
export type PanelFamily = string;
/** The display kinds and sources (§3c), tools/panel-description.mjs's lists. */
export const PANEL_DISPLAY_KINDS: readonly string[] = DISPLAY_KINDS;
export const PANEL_DISPLAY_SOURCES: readonly string[] = DISPLAY_SOURCES;
export type PanelDisplayKind = string;
export type PanelDisplaySource = string;
/** The widgets a face serves for a control (§3c), tools/panel-description.mjs's list. */
export const PANEL_WIDGETS: readonly string[] = WIDGETS;
export type PanelWidget = string;

/** The contract facts of one numeric parameter (§3f): a unit as its contract token (`ms`, `db`, `none`). */
export interface ServedNumberParam {
  readonly kind: 'number';
  readonly symbol: string;
  readonly name: string;
  readonly unit: string;
  readonly unitText?: string;
  readonly scale: 'linear' | 'log' | 'stepped';
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  readonly default: number;
  readonly enumLabels?: readonly string[];
}

/** A text parameter (§3f): an LV2 `atom:Path` (`path`) or `atom:String` (`text`) patch parameter. */
export interface ServedTextParam {
  readonly kind: 'path' | 'text';
  readonly symbol: string;
  readonly name: string;
  readonly default: string;
}

/** A momentary parameter (§3f, LV2 `pprops:trigger`): pressed it reads `max`, released `min`. */
export interface ServedTriggerParam {
  readonly kind: 'trigger';
  readonly symbol: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

/** One parameter of the description: a number with its contract facts, a trigger, or a path or text. */
export type ServedParam = ServedNumberParam | ServedTriggerParam | ServedTextParam;

/** Whether `p` is a numeric parameter: the only kind a role, a condition or a travel names. */
export function isNumberParam(p: ServedParam | undefined): p is ServedNumberParam {
  return p?.kind === 'number';
}

export interface PanelSection {
  readonly key: string;
  readonly labelKey: string;
  /** Fallback text; never fingerprinted. */
  readonly label: string;
}

export interface PanelVisibleWhen {
  readonly param: string;
  readonly values: readonly number[];
}

export interface PanelControl {
  readonly symbol: string;
  /** The section's key. */
  readonly section: string;
  readonly widget: PanelWidget;
  readonly labelKey: string;
  readonly label: string;
  readonly visibleWhen: PanelVisibleWhen | null;
}

export interface PanelRole {
  readonly role: string;
  readonly index: number;
  readonly symbol: string;
  /** A band's fixed shape when no `band_type` parameter selects it (§4 "eq"). */
  readonly shape?: string;
}

export interface PanelDisplay {
  readonly kind: PanelDisplayKind;
  readonly section: string;
  readonly source: PanelDisplaySource;
  readonly meterIds: readonly [number | null, number | null];
  readonly curveIndex: number | null;
  /** GAIN_REDUCTION_BAR: a floor parameter's symbol, or a fixed floor in dB; null for a kind with no floor. */
  readonly floor: { readonly param: string } | { readonly db: number } | null;
  readonly labelKey: string;
  readonly label: string;
}

/** What an override applies to: the fields of a panel description it reads and replaces (§3f). */
export interface SkinDescription {
  readonly family: PanelFamily;
  /** Every parameter of the contract, in its id order. */
  readonly params: readonly ServedParam[];
  readonly sections: readonly PanelSection[];
  readonly controls: readonly PanelControl[];
  readonly roles: readonly PanelRole[];
  readonly displays: readonly PanelDisplay[];
}

/** Why D6 dropped a role entry (§3d): the rest of the description stands. */
export type RoleDropReason = 'role-not-in-family' | 'role-repeats' | 'role-unit' | 'unknown-symbol';

/** A D6 check over a list of role entries: the survivors in order, and each dropped one with its reason. */
export type SkinRoleCheck = (
  family: PanelFamily,
  roles: readonly PanelRole[],
  params: readonly ServedParam[],
) => { readonly roles: readonly PanelRole[]; readonly dropped: readonly { readonly role: PanelRole; readonly reason: RoleDropReason }[] };

/**
 * D6 over tools/panel-description.mjs's `ROLES`: each entry whose role is not in the family's table (or repeats by
 * index when the role is not an indexed one), whose parameter is unknown or not a number, whose unit token the role
 * does not take, or whose `(role, index)` repeats is dropped and named; the survivors keep their order.
 */
export const checkSkinRoles: SkinRoleCheck = (family, roles, params) => {
  const table = (ROLES as Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>)[family] ?? {};
  const kept: PanelRole[] = [];
  const dropped: { role: PanelRole; reason: RoleDropReason }[] = [];
  const seen = new Set<string>();
  for (const r of roles) {
    const units = table[r.role];
    const found = params.find((p) => p.symbol === r.symbol);
    const param = isNumberParam(found) ? found : undefined;
    const key = `${r.role}\u0000${r.index}`;
    let reason: RoleDropReason | null = null;
    if (!units || (r.index !== 0 && !(INDEXED_ROLES as readonly string[]).includes(r.role))) reason = 'role-not-in-family';
    else if (!param) reason = found ? 'role-unit' : 'unknown-symbol';
    else if (!units.includes(param.unit)) reason = 'role-unit';
    else if (seen.has(key)) reason = 'role-repeats';
    if (reason) {
      dropped.push({ role: r, reason });
      continue;
    }
    seen.add(key);
    kept.push(r);
  }
  return { roles: kept, dropped };
};

/** The refusal codes of the skin package and its importer, each with named arguments (docs/skin-package.md). */
export const SKIN_REFUSAL_CODES = [
  /** `skin.json` does not parse or fails the one schema (§6.3): `args.plugin`, `args.field` the first field that broke it. */
  'SKIN_OVERRIDE_INVALID',
  /** One override entry names what the plugin's parameters cannot take: that entry is left out, the rest stands.
   * `args.plugin`, `args.field`, `args.entry`, `args.reason` (the drop's own code). */
  'SKIN_OVERRIDE_ENTRY_DROPPED',
  /** A view declares a skin-API version §7.2 does not accept; it is never imported. `args.declared`, `args.supported`. */
  'SKIN_API_MISMATCH',
  /** A view failed to import, threw on mount or render, or raised an uncaught error naming the package. `args.message`. */
  'SKIN_VIEW_ERROR',
  /** A view names a word §7.3's lint refuses: `args.word`, in `args.file`. An accident catcher, not a security control. */
  'SKIN_VIEW_LINT',
  /** The importer: the bundle holds no `modgui:gui` (or more than one with no plugin named), or a resource it names
   * does not exist. Nothing is written; `args.file` names the file read, `args.detail` what was found there. */
  'MODGUI_NOT_FOUND',
  /** The importer: a TTL of the bundle does not parse, or a `modgui:port` has no integer `lv2:index` or no `lv2:symbol`. */
  'MODGUI_TTL_INVALID',
  /** The importer: the plugin carries no `doap:license`, nor does its `lv2:project`. */
  'MODGUI_NO_LICENCE',
  /** The importer: the plugin's `doap:license` names no SPDX licence the map reads. */
  'MODGUI_LICENCE_UNMAPPED',
  /** The importer: the plugin's licence maps to an SPDX id outside the allow-list (GPL-2.0-only among them). */
  'MODGUI_LICENCE_REFUSED',
  /** The importer: the bundle carries a `modgui:` property (or a `modgui:port` an `lv2:` property) outside its list. */
  'MODGUI_UNKNOWN_PROPERTY',
  /** The importer: a `modgui:port`'s `lv2:symbol` names no `lv2:symbol` of the plugin's own `lv2:port`, a renamed or
   * stale entry. `args.file` names the TTL, `args.detail` the symbol. */
  'MODGUI_PORT_UNKNOWN',
  /** The importer: an image the icon template names under mod-ui's `/resources/` route is not in the resources
   * directory. `args.file` names the template, `args.detail` the path it names. */
  'MODGUI_IMAGE_NOT_FOUND',
  /** The importer: a resource the modgui names resolves outside the bundle (a symlink or a non-`file:` IRI). */
  'MODGUI_PATH_ESCAPE',
  /** The importer: the package directory is already in the skins directory; nothing is overwritten. */
  'MODGUI_TARGET_EXISTS',
  /** A package opted into the MOD GUI's own script (`skin.json`'s `modgui`, §6.7) with a licence missing or outside
   * `SKIN_LICENCE_ALLOW_LIST`: the entry is dropped. `args.plugin`, `args.licence`. */
  'SKIN_MODGUI_LICENCE',
] as const;
export type SkinRefusalCode = (typeof SKIN_REFUSAL_CODES)[number];

/** A refusal: the code plus the named parameters a client needs to render or act on it. */
export interface Refusal {
  readonly code: SkinRefusalCode;
  readonly args?: Readonly<Record<string, string | number>>;
}

/** The path prefix the console serves skin packages under (§6.5), beside `MANUAL_MOUNT`. */
export const SKIN_MOUNT = '/skins';

/** The skin API version this console implements (§7.1). */
export const SKIN_API_VERSION = '1.1';

/** The override file's name inside a package (§6.2). */
export const SKIN_OVERRIDE_FILE = 'skin.json';

/**
 * The one modgui licence allow-list (§6.6, §6.7): the importer refuses a bundle outside it at
 * import, and this console refuses it again at resolve time, because `skin.json` is itself
 * editable after import. ONE array both read; never a second copy under a second name.
 */
export const SKIN_LICENCE_ALLOW_LIST = [
  'GPL-2.0-or-later', 'GPL-3.0-or-later', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later',
  'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'CC0-1.0', 'CC-BY-4.0',
] as const;

/** The override file's one schema version (§6.3); another value refuses the file. */
export const SKIN_OVERRIDE_SCHEMA = 1;

/** Where a package is looked up, first found wins whole (§6.5, §12 Q4). */
export const SKIN_LEVELS = ['config', 'omx-plugins', 'builtin'] as const;
export type SkinLevel = (typeof SKIN_LEVELS)[number];

/** Level 1, under `xdgConfigHome()`. */
export const SKIN_CONFIG_SUBDIR = 'openmixer/skins';
/** Level 2: installed with omx-plugins (`%{_datadir}/omx-plugins/skins`). */
export const OMX_PLUGINS_SKIN_INSTALL_DIR = '/usr/share/omx-plugins/skins';
/** Level 3: the built-in defaults installed with openmixer, as the manual is. */
export const OPENMIXER_SKIN_INSTALL_DIR = '/usr/share/openmixer/skins';

/**
 * The §7.2 version rule: accepted when the majors are equal and the view's minor is not above the
 * console's. A string that is not `MAJOR.MINOR` is not accepted.
 */
export function acceptsSkinApi(declared: string, supported: string = SKIN_API_VERSION): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)$/.exec(v);
  const d = parse(declared);
  const s = parse(supported);
  if (!d || !s) return false;
  return Number(d[1]) === Number(s[1]) && Number(d[2]) <= Number(s[2]);
}

const UNRESERVED = /^[A-Za-z0-9._-]$/;

/**
 * A plugin id as a directory name (§6.1): kept as it is when it holds only `[A-Za-z0-9._-]`, else
 * every byte outside that set percent-encoded (RFC 3986, the unreserved set kept). `.` and `..` are
 * never a name: their dots are encoded. The ONE function the server, the importer and the
 * generator call.
 */
export function encodeSkinId(id: string): string {
  if (id === '') throw new Error('encodeSkinId: an empty plugin id has no package');
  const bytes = new TextEncoder().encode(id);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += b < 0x80 && UNRESERVED.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  if (out === '.' || out === '..') out = out.replace(/\./g, '%2E');
  return out;
}

/** The plugin id a directory name encodes, or null for a name {@link encodeSkinId} never writes. */
export function decodeSkinId(name: string): string | null {
  try {
    const id = decodeURIComponent(name);
    return id !== '' && encodeSkinId(id) === name ? id : null;
  } catch {
    return null;
  }
}

/** Where a package came from (§6.3). */
export interface SkinSource {
  readonly kind: 'own' | 'generated' | 'modgui';
  readonly bundle?: string;
  readonly licenceEvidence?: string;
  /**
   * `kind: 'modgui'` only (§6.6): the bundle's own icon template and stylesheet, paths inside the
   * package's `modgui/` directory, so the modgui house view draws the plugin's OWN markup — the
   * bundle's images and layout, never our generic grid — instead of restating it as sections.
   */
  readonly modgui?: { readonly html: string; readonly css: string };
}

export interface SkinOverrideSection {
  readonly key: string;
  readonly labelKey?: string;
  readonly label?: string;
  readonly controls: readonly string[];
}

/** The override file, parsed and schema-checked (§6.3). Symbols are checked when it is applied. */
export interface SkinOverride {
  readonly schema: typeof SKIN_OVERRIDE_SCHEMA;
  readonly plugin: string;
  readonly licence: string;
  readonly source?: SkinSource;
  readonly fingerprint?: string;
  readonly family?: PanelFamily;
  readonly roles?: Readonly<Record<string, string>>;
  readonly sections?: readonly SkinOverrideSection[];
  readonly labels?: Readonly<Record<string, { readonly labelKey?: string; readonly label?: string }>>;
  readonly visibleWhen?: Readonly<Record<string, { readonly param: string; readonly values: readonly number[] }>>;
  readonly displays?: readonly PanelDisplay[];
  readonly houseView?: PanelFamily;
  readonly look?: string;
  readonly backdrop?: string;
  readonly view?: { readonly entry: string; readonly api: string };
  /** The sandboxed iframe tier's opt-in (§6.7): presence alone opts a plugin in. */
  readonly modgui?: { readonly entry: string };
}

const KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);

/** A relative path inside the package: no absolute path, no `..` segment, no backslash. */
function insidePackage(path: string, under: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false;
  const segs = path.split('/');
  return segs[0] === under && segs.length > 1 && segs.every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Why a schema check failed: the first field that broke it. */
function schemaFault(o: Record<string, unknown>, dirId: string): string | null {
  if (o['schema'] !== SKIN_OVERRIDE_SCHEMA) return 'schema';
  if (o['plugin'] !== dirId) return 'plugin';
  if (!isStr(o['licence']) || o['licence'].trim() === '') return 'licence';
  const src = o['source'];
  if (src !== undefined && (!isObj(src) || !['own', 'generated', 'modgui'].includes(src['kind'] as string) || !optStr(src['bundle']) || !optStr(src['licenceEvidence'])))
    return 'source';
  if (isObj(src) && src['modgui'] !== undefined) {
    const mg = src['modgui'];
    if (!isObj(mg) || !isStr(mg['html']) || !insidePackage(mg['html'], 'modgui') || !isStr(mg['css']) || !insidePackage(mg['css'], 'modgui'))
      return 'source';
  }
  if (!optStr(o['fingerprint'])) return 'fingerprint';
  const fam = (v: unknown) => v === undefined || (PANEL_FAMILIES as readonly unknown[]).includes(v);
  if (!fam(o['family'])) return 'family';
  if (!fam(o['houseView'])) return 'houseView';
  const roles = o['roles'];
  if (roles !== undefined && (!isObj(roles) || !Object.values(roles).every(isStr))) return 'roles';
  const sections = o['sections'];
  if (sections !== undefined) {
    if (!Array.isArray(sections)) return 'sections';
    const keys = new Set<string>();
    for (const s of sections) {
      if (!isObj(s) || !isStr(s['key']) || !KEY.test(s['key']) || keys.has(s['key'])) return 'sections';
      if ((s['labelKey'] !== undefined && (!isStr(s['labelKey']) || !KEY.test(s['labelKey']))) || !optStr(s['label'])) return 'sections';
      if (!Array.isArray(s['controls']) || !s['controls'].every(isStr)) return 'sections';
      keys.add(s['key']);
    }
  }
  const labels = o['labels'];
  if (labels !== undefined) {
    if (!isObj(labels)) return 'labels';
    for (const l of Object.values(labels)) {
      if (!isObj(l) || !optStr(l['label']) || (l['labelKey'] !== undefined && (!isStr(l['labelKey']) || !KEY.test(l['labelKey'])))) return 'labels';
    }
  }
  const vis = o['visibleWhen'];
  if (vis !== undefined) {
    if (!isObj(vis)) return 'visibleWhen';
    for (const v of Object.values(vis)) {
      if (!isObj(v) || !isStr(v['param']) || !Array.isArray(v['values'])) return 'visibleWhen';
      if (!v['values'].every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 63)) return 'visibleWhen';
    }
  }
  const displays = o['displays'];
  if (displays !== undefined) {
    if (!Array.isArray(displays)) return 'displays';
    for (const d of displays) {
      if (!isObj(d) || !(PANEL_DISPLAY_KINDS as readonly unknown[]).includes(d['kind']) || !(PANEL_DISPLAY_SOURCES as readonly unknown[]).includes(d['source']) || !isStr(d['section']))
        return 'displays';
    }
  }
  if (!optStr(o['look'])) return 'look';
  if (o['backdrop'] !== undefined && (!isStr(o['backdrop']) || !insidePackage(o['backdrop'], 'art'))) return 'backdrop';
  const view = o['view'];
  if (view !== undefined && (!isObj(view) || !isStr(view['entry']) || !insidePackage(view['entry'], 'view') || !isStr(view['api']))) return 'view';
  const modgui = o['modgui'];
  if (modgui !== undefined) {
    if (view !== undefined) return 'modgui';
    if (!isObj(modgui) || !isStr(modgui['entry']) || !insidePackage(modgui['entry'], 'modgui')) return 'modgui';
  }
  return null;
}

/** The override file's text, parsed and schema-checked against the directory's decoded id (§6.3). */
export function parseSkinOverride(text: string, dirId: string): { readonly ok: true; readonly override: SkinOverride } | { readonly ok: false; readonly refusal: Refusal } {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    return { ok: false, refusal: { code: 'SKIN_OVERRIDE_INVALID', args: { plugin: dirId, field: 'json', detail: (e as Error).message } } };
  }
  if (!isObj(o)) return { ok: false, refusal: { code: 'SKIN_OVERRIDE_INVALID', args: { plugin: dirId, field: 'json', detail: 'not an object' } } };
  const fault = schemaFault(o, dirId);
  if (fault) return { ok: false, refusal: { code: 'SKIN_OVERRIDE_INVALID', args: { plugin: dirId, field: fault, detail: `the ${fault} field fails the schema` } } };
  return { ok: true, override: o as unknown as SkinOverride };
}

/** An override entry the application dropped, and why; the rest of the file stands (§6.3). */
export interface SkinDroppedEntry {
  readonly field: 'roles' | 'sections' | 'labels' | 'visibleWhen' | 'displays';
  readonly entry: string;
  readonly reason: RoleDropReason | 'unknown-symbol' | 'unknown-section';
}

/**
 * The override applied to a description, field by field as §6.3's table says, every symbol checked
 * against the contract (`params`): an unknown one drops that entry, D6 drops a role (`checkRoles`,
 * `checkSkinRoles` unless the caller passes its own); with no description, the override's `sections`
 * make one. The ONE function every caller applies it with.
 */
export function applySkinOverride<D extends SkinDescription>(
  description: D,
  override: SkinOverride,
  checkRoles: SkinRoleCheck = checkSkinRoles,
): { readonly description: D; readonly dropped: readonly SkinDroppedEntry[] } {
  const dropped: SkinDroppedEntry[] = [];
  const params = description.params;
  const known = (symbol: string) => params.some((p: ServedParam) => p.symbol === symbol);
  const knownNumber = (symbol: string) => isNumberParam(params.find((p) => p.symbol === symbol));
  const family = override.family ?? description.family;

  let sections: PanelSection[] = [...description.sections];
  let controls: PanelControl[] = [...description.controls];
  if (override.sections) {
    const old = new Map(description.controls.map((c) => [c.symbol, c]));
    const oldSection = new Map(description.sections.map((s) => [s.key, s]));
    sections = [];
    controls = [];
    for (const s of override.sections) {
      const was = oldSection.get(s.key);
      sections.push({ key: s.key, labelKey: s.labelKey ?? was?.labelKey ?? '', label: s.label ?? was?.label ?? s.key });
      for (const symbol of s.controls) {
        if (!known(symbol) || controls.some((c) => c.symbol === symbol)) {
          dropped.push({ field: 'sections', entry: `${s.key}:${symbol}`, reason: 'unknown-symbol' });
          continue;
        }
        const prior = old.get(symbol);
        controls.push(prior ? { ...prior, section: s.key } : { symbol, section: s.key, widget: 'auto', labelKey: '', label: '', visibleWhen: null });
      }
    }
    // A parameter named nowhere is appended in a last section, never hidden (§6.3).
    const named = new Set(controls.map((c) => c.symbol));
    const rest = description.controls.filter((c) => !named.has(c.symbol));
    if (rest.length > 0) {
      const key = 'more';
      sections.push({ key, labelKey: '', label: 'More' });
      for (const c of rest) controls.push({ ...c, section: key });
    }
  }
  if (override.labels) {
    for (const [symbol, l] of Object.entries(override.labels)) {
      const i = controls.findIndex((c) => c.symbol === symbol);
      if (i < 0) {
        dropped.push({ field: 'labels', entry: symbol, reason: 'unknown-symbol' });
        continue;
      }
      const c = controls[i]!;
      controls[i] = { ...c, labelKey: l.labelKey ?? (l.label !== undefined ? '' : c.labelKey), label: l.label ?? c.label };
    }
  }
  if (override.visibleWhen) {
    for (const [symbol, v] of Object.entries(override.visibleWhen)) {
      const i = controls.findIndex((c) => c.symbol === symbol);
      if (i < 0 || !knownNumber(v.param)) {
        dropped.push({ field: 'visibleWhen', entry: symbol, reason: 'unknown-symbol' });
        continue;
      }
      controls[i] = { ...controls[i]!, visibleWhen: { param: v.param, values: v.values } };
    }
  }
  let roles: readonly PanelRole[] = description.roles;
  if (override.roles) {
    const asked: PanelRole[] = Object.entries(override.roles).map(([k, symbol]) => {
      const m = /^(.+)\[(\d+)\]$/.exec(k);
      return { role: m ? m[1]! : k, index: m ? Number(m[2]) : 0, symbol };
    });
    const checked = checkRoles(family, asked, params);
    for (const d of checked.dropped) dropped.push({ field: 'roles', entry: `${d.role.role}[${d.role.index}]`, reason: d.reason });
    roles = checked.roles;
  }
  let displays: readonly PanelDisplay[] = description.displays;
  if (override.displays) {
    displays = override.displays.filter((d) => {
      const ok = sections.some((s) => s.key === d.section) && (d.floor === null || d.floor === undefined || !('param' in d.floor) || knownNumber(d.floor.param));
      if (!ok) dropped.push({ field: 'displays', entry: `${d.kind}@${d.section}`, reason: 'unknown-section' });
      return ok;
    });
  }
  return { description: { ...description, family, sections, controls, roles, displays } as D, dropped };
}

/** The words the view lint refuses (§7.3): an accident catcher, NOT a security control. */
export const SKIN_VIEW_LINT_WORDS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'indexedDB',
] as const;

/** The first word of §7.3 a view's source names, or a non-relative dynamic `import(`; null when clean. */
export function lintSkinViewSource(source: string): string | null {
  for (const w of SKIN_VIEW_LINT_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(source)) return w;
  }
  const dyn = /\bimport\s*\(\s*(['"`]?)([^'"`)\s]*)/g;
  for (const m of source.matchAll(dyn)) {
    if (m[1] === '' || !(m[2]!.startsWith('./') || m[2]!.startsWith('../'))) return 'import(';
  }
  return null;
}

/** The custom view the resolution chose: its entry, its declared version and its URL on the mount. */
export interface SkinViewEntry {
  readonly entry: string;
  readonly api: string;
  readonly url: string;
}

/** The sandboxed iframe tier's entry the resolution chose (§6.7): its URL on the mount. */
export interface SkinModguiEntry {
  readonly entry: string;
  readonly url: string;
}

/**
 * Whether an opted-in `modgui` entry passes the licence gate (§6.7): the ONE check the server's
 * resolver and any other caller apply, never re-derived. `licence` is `override.licence` as read
 * off disk now (the importer's own check happened once, at import; this one happens on every read).
 */
export function isSkinLicenceAllowed(licence: string): boolean {
  return (SKIN_LICENCE_ALLOW_LIST as readonly string[]).includes(licence);
}

/**
 * The resolution of one plugin id (§6.5): which level answered (or none), the parsed override, the
 * view entry and its declared version, the package ETag, and every refusal, which the panel header
 * marks. One value every client reads.
 */
export interface SkinResolution {
  readonly plugin: string;
  readonly level: SkinLevel | null;
  /** The package's base URL on the mount, with a trailing slash; null when no level answered. */
  readonly base: string | null;
  readonly etag: string | null;
  readonly override: SkinOverride | null;
  /** The view to import, or null: none declared, or refused (its refusal is in `refusals`). */
  readonly view: SkinViewEntry | null;
  /** The sandboxed iframe tier's entry, or null: not opted in, or refused (§6.7, in `refusals`). */
  readonly modgui?: SkinModguiEntry | null;
  readonly refusals: readonly Refusal[];
}

/**
 * The base URL of a package on the mount: the directory name, itself URL-encoded once more, so a
 * `%` the directory name holds survives the one decode a server applies to a path.
 */
export function skinBaseUrl(pluginId: string): string {
  return `${SKIN_MOUNT}/${encodeURIComponent(encodeSkinId(pluginId))}/`;
}

// ─── §6.6 the modgui import ───────────────────────────────────────────────────────────────────

export type SkinLicence = (typeof SKIN_LICENCE_ALLOW_LIST)[number];

export const MODGUI_NS = 'http://moddevices.com/ns/modgui#';
export const LV2_NS = 'http://lv2plug.in/ns/lv2core#';
export const DOAP_NS = 'http://usefulinc.com/ns/doap#';

/**
 * The `modgui:` properties the importer knows on a `modgui:gui` node: mod-ui's whole list, not only
 * the ones a reviewed bundle used (docs/skin-package.md); any other is refused.
 */
export const MODGUI_GUI_PROPERTIES = [
  'resourcesDirectory',
  'iconTemplate',
  'settingsTemplate',
  'javascript',
  'stylesheet',
  'screenshot',
  'thumbnail',
  'documentation',
  'discussionURL',
  'brand',
  'label',
  'model',
  'panel',
  'color',
  'knob',
  'port',
  'monitoredOutputs',
] as const;

/**
 * The `modgui:gui` properties whose value is a file of the bundle: each must resolve inside it and is
 * copied with the package. `documentation` is one only when it names a `file:` IRI; a web address
 * there, and `discussionURL` always, are kept as text and never fetched.
 */
export const MODGUI_FILE_PROPERTIES = ['iconTemplate', 'settingsTemplate', 'javascript', 'stylesheet', 'screenshot', 'thumbnail', 'documentation'] as const;

/**
 * The modgui files whose image references (`src="..."`, `url(...)`) must resolve inside the bundle. Not
 * the stylesheet: MOD's shared pedal themes name files no one bundle carries, on purpose.
 */
export const MODGUI_TEMPLATE_PROPERTIES = ['iconTemplate', 'settingsTemplate'] as const;

/** mod-ui's server route a template names the bundle's resources directory by: `/resources/<f>`. */
export const MODGUI_RESOURCES_ROUTE = '/resources/';

/**
 * mod-ui's own routes, the directories of its html directory its static handler serves (`/fonts/<name>/...`,
 * `/img/icons/...`, `/js/...`, `/css/...`, `/include/...`): the other absolute paths a template may name, a
 * file the drawing supplies or replaces, kept as text and never fetched. Any other absolute path is outside
 * the bundle.
 */
export const MODGUI_SERVER_ROUTES = ['/fonts/', '/img/', '/js/', '/css/', '/include/'] as const;

/** The `lv2:` properties the importer knows on a `modgui:port` node; any other is refused. */
export const MODGUI_PORT_PROPERTIES = ['index', 'symbol', 'name'] as const;

/** The importer's refusals (§6.6), each naming the file it read; nothing is written on any of them. */
export const MODGUI_IMPORT_REFUSALS = [
  'MODGUI_NOT_FOUND',
  'MODGUI_TTL_INVALID',
  'MODGUI_NO_LICENCE',
  'MODGUI_LICENCE_UNMAPPED',
  'MODGUI_LICENCE_REFUSED',
  'MODGUI_UNKNOWN_PROPERTY',
  'MODGUI_PORT_UNKNOWN',
  'MODGUI_IMAGE_NOT_FOUND',
  'MODGUI_PATH_ESCAPE',
  'MODGUI_TARGET_EXISTS',
] as const satisfies readonly SkinRefusalCode[];
export type ModguiImportRefusal = (typeof MODGUI_IMPORT_REFUSALS)[number];

/** DOAP's unversioned licence IRIs and the SPDX id each is read as (an unversioned GPL lets the recipient choose any published version). */
const DOAP_UNVERSIONED: Readonly<Record<string, string>> = {
  'http://usefulinc.com/doap/licenses/gpl': 'GPL-2.0-or-later',
  'http://usefulinc.com/doap/licenses/lgpl': 'LGPL-2.1-or-later',
};

/**
 * An SPDX id as written, read as its current id: case as the allow-list spells it, and the
 * deprecated GNU forms by SPDX's own rule (`GPL-2.0+` is `GPL-2.0-or-later`, a bare `GPL-2.0` is
 * `GPL-2.0-only`).
 */
function spdxId(id: string): string {
  const listed = SKIN_LICENCE_ALLOW_LIST.find((k) => k.toLowerCase() === id.toLowerCase());
  if (listed) return listed;
  const gnu = /^(L?GPL)-(\d\.\d)(\+?)$/i.exec(id);
  if (gnu) return `${gnu[1]!.toUpperCase()}-${gnu[2]}-${gnu[3] ? 'or-later' : 'only'}`;
  return id;
}

/**
 * The SPDX expression a `doap:license` value names, or `null` when it names none this map reads
 * (§6.6): an `spdx.org/licenses/<id>` IRI or a bare SPDX literal as that id, an
 * `opensource.org/licenses/<id>` IRI as the SPDX id it names, DOAP's unversioned gpl/lgpl as
 * GPL-2.0-or-later/LGPL-2.1-or-later. Mapping is not permission: {@link isSkinLicenceAllowed} decides.
 */
export function spdxFromDoapLicence(value: { readonly iri?: string; readonly literal?: string }): string | null {
  if (value.literal !== undefined) {
    const lit = value.literal.trim();
    return /^[A-Za-z0-9.+-]+$/.test(lit) ? spdxId(lit) : null;
  }
  const iri = value.iri;
  if (iri === undefined) return null;
  const doap = DOAP_UNVERSIONED[iri.replace(/^https:/, 'http:').replace(/\/$/, '')];
  if (doap) return doap;
  const m = /^https?:\/\/(?:www\.)?(spdx\.org|opensource\.org)\/licenses\/([A-Za-z0-9.+-]+?)(?:\.html|\.php)?\/?$/.exec(iri);
  return m ? spdxId(m[2]!) : null;
}
