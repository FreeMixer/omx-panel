// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * vocabulary.mjs — the readers of the plugin vocabulary the layout judges a descriptor by, each over what its
 * owner installs, never a copy of it:
 *
 *   - the meanings: omx-contract's closed list of control meanings, `$defs.meaning` of its installed schema
 *     (`<pkg-config --variable=datadir omx-contract>/omx-contract.schema.json`; `$OMX_CONTRACT_SCHEMA` stands in),
 *     `unknown` aside; and the panel roles that play them, `meaningOfRole`;
 *   - the unit tokens: the token of a descriptor unit is the LV2 unit a face writes for it, plugin-hostd's
 *     installed LV2 table read backwards (`<contractdir>/3/plugin-hostd/formats/lv2.json`; `$PLUGIN_HOSTD_TABLES`, a
 *     directory holding lv2.json, stands in), or the name of a unit in the param-contract extension's vendor
 *     block; a token is served when that extension's header gives it a value (`omx_param_contract.h`, installed by
 *     omx-plugins-devel; `$OMX_PARAM_CONTRACT_H` stands in).
 *
 * A reader whose source is not installed throws, naming what to install; nothing is guessed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_CONFIG = () => process.env.PKG_CONFIG || 'pkg-config';

/** A pkg-config variable of an installed package, or undefined. */
function pkgVariable(pkg, name) {
  try {
    return execFileSync(PKG_CONFIG(), [`--variable=${name}`, pkg], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const once = (read) => {
  let v;
  return () => (v ??= read());
};

/** The installed omx-contract schema, where the descriptor words are declared. */
export function contractSchemaFile() {
  if (process.env.OMX_CONTRACT_SCHEMA) return process.env.OMX_CONTRACT_SCHEMA;
  const dir = pkgVariable('omx-contract', 'datadir');
  return dir && join(dir, 'omx-contract.schema.json');
}

/** The descriptor's closed list of meanings, `unknown` aside: omx-contract's schema, `$defs.meaning`. */
export const meanings = once(() => {
  const file = contractSchemaFile();
  if (!file || !existsSync(file)) throw new Error(`vocabulary: omx-contract's schema is not installed (${file ?? 'pkg-config finds no omx-contract'}): install omx-contract-devel, or name the file in $OMX_CONTRACT_SCHEMA`);
  const list = JSON.parse(readFileSync(file, 'utf8')).$defs?.meaning?.enum;
  if (!Array.isArray(list)) throw new Error(`vocabulary: ${file} declares no $defs.meaning`);
  return Object.freeze(list.filter((m) => m !== 'unknown'));
});

/** A panel role -> the descriptor meaning it plays, where the two names differ. A role whose name is
 * a meaning plays that meaning; a role in neither has no meaning word and is bound only by a panel. */
export const MEANING_OF_ROLE = Object.freeze({
  mix: 'wetDryRatio', time: 'delay', cutoff: 'cutoffFrequency',
  band_freq: 'frequency', band_gain: 'gain', band_q: 'q',
  hpf_freq: 'lowCut', low_cut: 'lowCut', lpf_freq: 'highCut', high_cut: 'highCut',
  hpf_slope: 'slope', lpf_slope: 'slope', key_listen: 'listen',
});

/** The meaning role `role` plays, or undefined when the descriptor has no word for it. */
export function meaningOfRole(role) {
  const m = MEANING_OF_ROLE[role] ?? role;
  return meanings().includes(m) ? m : undefined;
}

/** plugin-hostd's installed LV2 table: `{ <unit>: <LV2 source value> }` from its lookup rows of the unit word. */
export const lv2UnitTable = once(() => {
  const dir = process.env.PLUGIN_HOSTD_TABLES || (pkgVariable('omx-contract', 'contractdir') && join(pkgVariable('omx-contract', 'contractdir'), '3', 'plugin-hostd', 'formats'));
  const file = dir && join(dir, 'lv2.json');
  if (!file || !existsSync(file)) throw new Error(`vocabulary: plugin-hostd's LV2 table is not installed (${file ?? 'pkg-config finds no omx-contract contract directory'}): install plugin-hostd-devel, or name a directory holding lv2.json in $PLUGIN_HOSTD_TABLES`);
  const item = JSON.parse(readFileSync(file, 'utf8')).PLUGIN_HOSTD_LV2_MAP;
  if (item?.kind !== 'formatMap' || typeof item.rows !== 'object') throw new Error(`vocabulary: ${file} holds no PLUGIN_HOSTD_LV2_MAP formatMap`);
  const out = {};
  for (const row of Object.values(item.rows)) {
    const w = row.word;
    if (w?.word !== 'controls[].travel.unit' || w.transform !== 'lookup') continue;
    for (const [source, unit] of Object.entries(w.values ?? {})) {
      if (unit in out && out[unit] !== source) throw new Error(`vocabulary: ${file} maps the unit ${unit} from ${out[unit]} and ${source}: a face writes one`);
      out[unit] = source;
    }
  }
  return out;
});

/** The param-contract header's unit values, by name without underscores (SEMITONE12TET): `Map<name, value>`. */
export const headerUnits = once(() => {
  let file = process.env.OMX_PARAM_CONTRACT_H;
  if (!file) {
    const inc = pkgVariable('omxplugins', 'includedir');
    file = inc && [join(inc, 'omx-plugins', 'omx_param_contract.h'), join(inc, 'omx_param_contract.h')].find(existsSync);
  }
  if (!file || !existsSync(file)) throw new Error(`vocabulary: the param-contract header omx_param_contract.h is not installed (${file ?? 'pkg-config finds no omxplugins'}): install omx-plugins-devel, or name the file in $OMX_PARAM_CONTRACT_H`);
  const body = readFileSync(file, 'utf8').match(/enum omx_clap_param_unit \{([\s\S]*?)\};/)?.[1];
  if (!body) throw new Error(`vocabulary: ${file} declares no enum omx_clap_param_unit`);
  return new Map([...body.matchAll(/OMX_CLAP_UNIT_(\w+)\s*=\s*(0x[0-9a-fA-F]+|\d+)/g)].map((m) => [m[1].replaceAll('_', ''), Number(m[2])]));
});

/** The first value of the extension's vendor block: the units of its own, past the LV2 ones. */
const VENDOR_BLOCK = 0x100;

/** A descriptor unit's token: the LV2 unit a face writes for it (units:db -> db, urn:openmixer:unit#dBFS -> dbfs), else
 * the name of a vendor-block unit it is (dBu -> dbu), else undefined. */
export function unitTokenOf(unit) {
  const source = lv2UnitTable()[unit];
  if (source) return source.startsWith('units:') ? source.slice('units:'.length) : source.split('#').pop().toLowerCase();
  const name = String(unit).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (headerUnits().get(name) ?? 0) >= VENDOR_BLOCK ? name.toLowerCase() : undefined;
}

/** The token of a unit the param-contract extension serves (one with a header value, or "" for none), else undefined. */
export function servedToken(unit) {
  if (unit === '') return 'none';
  const token = unitTokenOf(unit);
  return token && headerUnits().get(token.toUpperCase()) ? token : undefined;
}

/** Every unit plugin-hostd's LV2 table maps, and "", with its contract unit: `{ <unit>: [token, header value] }`, a unit
 * the header has no value for `['none', 0]`. */
export function contractUnits() {
  return Object.fromEntries(['', ...Object.keys(lv2UnitTable())].map((u) => {
    const token = u === '' ? undefined : unitTokenOf(u);
    const value = token ? headerUnits().get(token.toUpperCase()) ?? 0 : 0;
    return [u, value ? [token, value] : ['none', 0]];
  }));
}

/** The descriptor file a package installed into omx-contract's contract directory, `<package>/<name>`:
 * `<contractdir>/3/<package>/plugins/<name>.json`. */
export function installedDescriptorFile(ref) {
  const m = /^([a-z0-9][a-z0-9.+-]*)\/([A-Za-z0-9._-]+)$/.exec(ref);
  if (!m) throw new Error(`vocabulary: '${ref}' is not <package>/<name>`);
  const dir = pkgVariable('omx-contract', 'contractdir');
  const file = dir && join(dir, '3', m[1], 'plugins', `${m[2]}.json`);
  if (!file || !existsSync(file)) throw new Error(`vocabulary: no descriptor ${ref} is installed (${file ?? 'pkg-config finds no omx-contract contract directory'})`);
  return file;
}
