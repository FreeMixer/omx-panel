// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * vocabulary.mjs — the readers of the plugin vocabulary the layout judges a descriptor by, each over what its
 * owner installs, never a copy of it:
 *
 *   - the meanings: omx-contract's closed list of control meanings, `$defs.meaning` of its installed schema
 *     (`<datadir>/omx-contract.schema.json`, installed by omx-contract-data; `$OMX_CONTRACT_SCHEMA` stands in),
 *     `unknown` aside; and the panel roles that play them, `meaningOfRole`;
 *   - the unit tokens: the token of a descriptor unit is the LV2 unit a face writes for it, plugin-hostd's
 *     installed LV2 table read backwards (`<contractdir>/3/plugin-hostd/formats/lv2.json`, installed by
 *     plugin-hostd-contract; `$PLUGIN_HOSTD_TABLES`, a directory holding lv2.json, stands in), or the name of a unit
 *     in the param-contract extension's vendor block; a token is served when that extension's header gives it a
 *     value (`omx_param_contract.h`, installed by omx-plugins-devel; `$OMX_PARAM_CONTRACT_H` stands in);
 *   - the descriptors a package installs, `<contractdir>/3/<package>/plugins/<name>.json` (omx-plugins-contract
 *     installs omx-plugins').
 *
 * The contract directories are `$OMX_CONTRACT_PATH` (a `:` list, the first that holds a package wins), else
 * omx-contract's pkg-config variable `contractdir` where omx-contract.pc is installed (omx-contract-devel), else
 * /usr/share/omx-contract/contract.d, where omx-contract-data installs it. omx-contract's datadir is the pkg-config
 * variable `datadir`, else /usr/share/omx-contract. A runtime install reads its files with no pkg-config.
 *
 * A reader whose source is not installed throws, naming what to install; nothing is guessed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** Where omx-contract-data installs its files and the contract directory, for an install with no omx-contract.pc. */
export const DEFAULT_DATADIR = '/usr/share/omx-contract';
export const DEFAULT_CONTRACTDIR = '/usr/share/omx-contract/contract.d';
/** Where omx-plugins-devel installs the param-contract header. */
const DEFAULT_PARAM_CONTRACT_H = '/usr/include/omx-plugins/omx_param_contract.h';

/** The contract directories, in the order they are read: `$OMX_CONTRACT_PATH`, else omx-contract's `contractdir`,
 * else the default. */
export function contractDirs() {
  const path = process.env.OMX_CONTRACT_PATH;
  if (path) return path.split(':').filter(Boolean);
  return [pkgVariable('omx-contract', 'contractdir') ?? DEFAULT_CONTRACTDIR];
}

/** The directory `<contractdir>/3/<package>` of the first contract directory that holds it, or undefined. */
export function packageDir(pkg) {
  return contractDirs().map((d) => join(d, '3', pkg)).find((d) => existsSync(d));
}

/** omx-contract's own data directory: its pkg-config `datadir`, else the default. */
export function contractDataDir() {
  return pkgVariable('omx-contract', 'datadir') ?? DEFAULT_DATADIR;
}

const once = (read) => {
  let v;
  return () => (v ??= read());
};

/** The installed omx-contract schema, where the descriptor words are declared. */
export function contractSchemaFile() {
  return process.env.OMX_CONTRACT_SCHEMA || join(contractDataDir(), 'omx-contract.schema.json');
}

/** The descriptor's closed list of meanings, `unknown` aside: omx-contract's schema, `$defs.meaning`. */
export const meanings = once(() => {
  const file = contractSchemaFile();
  if (!existsSync(file)) throw new Error(`vocabulary: omx-contract's schema is not installed (${file}): install omx-contract-data, or name the file in $OMX_CONTRACT_SCHEMA`);
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

/** The file of plugin-hostd's LV2 table: in `$PLUGIN_HOSTD_TABLES`, else in the first contract directory holding
 * plugin-hostd (named in the first one when none does). */
export function lv2TableFile() {
  if (process.env.PLUGIN_HOSTD_TABLES) return join(process.env.PLUGIN_HOSTD_TABLES, 'lv2.json');
  return join(packageDir('plugin-hostd') ?? join(contractDirs()[0], '3', 'plugin-hostd'), 'formats', 'lv2.json');
}

/** plugin-hostd's installed LV2 table: `{ <unit>: <LV2 source value> }` from its lookup rows of the unit word. */
export const lv2UnitTable = once(() => {
  const file = lv2TableFile();
  if (!existsSync(file)) throw new Error(`vocabulary: plugin-hostd's LV2 table is not installed (${file}): install plugin-hostd-contract, or name a directory holding lv2.json in $PLUGIN_HOSTD_TABLES`);
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

/** The param-contract header: `$OMX_PARAM_CONTRACT_H`, else under omxplugins' pkg-config `includedir`, else the
 * default; undefined when none is there. */
export function paramContractHeader() {
  if (process.env.OMX_PARAM_CONTRACT_H) return existsSync(process.env.OMX_PARAM_CONTRACT_H) ? process.env.OMX_PARAM_CONTRACT_H : undefined;
  const inc = pkgVariable('omxplugins', 'includedir');
  return [...(inc ? [join(inc, 'omx-plugins', 'omx_param_contract.h'), join(inc, 'omx_param_contract.h')] : []), DEFAULT_PARAM_CONTRACT_H].find(existsSync);
}

/** The param-contract header's unit values, by name without underscores (SEMITONE12TET): `Map<name, value>`. */
export const headerUnits = once(() => {
  const file = paramContractHeader();
  if (!file) throw new Error(`vocabulary: the param-contract header omx_param_contract.h is not installed (${process.env.OMX_PARAM_CONTRACT_H || DEFAULT_PARAM_CONTRACT_H}): install omx-plugins-devel, or name the file in $OMX_PARAM_CONTRACT_H`);
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
  const file = contractDirs().map((d) => join(d, '3', m[1], 'plugins', `${m[2]}.json`)).find((f) => existsSync(f));
  if (!file) throw new Error(`vocabulary: no descriptor ${ref} is installed (in ${contractDirs().join(':')})`);
  return file;
}

/** Every descriptor file installed under the contract directories, sorted: `<contractdir>/<major>/<package>/plugins/*.json`,
 * whatever majors are installed. A `<package>/<name>` installed under several majors or directories is listed once,
 * from the highest major of the first contract directory that holds it. */
export function installedDescriptorFiles() {
  const names = (dir, keep) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter(keep).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const seen = new Map();
  for (const d of contractDirs()) {
    const majors = names(d, (e) => e.isDirectory() && /^[0-9]+$/.test(e.name)).sort((a, b) => Number(b) - Number(a));
    for (const major of majors) {
      for (const pkg of names(join(d, major), (e) => e.isDirectory())) {
        for (const f of names(join(d, major, pkg, 'plugins'), (e) => !e.isDirectory() && e.name.endsWith('.json'))) {
          const ref = `${pkg}/${f}`;
          if (!seen.has(ref)) seen.set(ref, join(d, major, pkg, 'plugins', f));
        }
      }
    }
  }
  return [...seen.values()].sort();
}
