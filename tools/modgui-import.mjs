// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * modgui-import.mjs — a MOD modgui bundle in, a skin package out (docs/skin-package.md, "Importing a MOD GUI").
 *
 * The format read is MOD Devices' modgui, as MOD documents it (the `modgui:` vocabulary,
 * http://moddevices.com/ns/modgui#, in mod-sdk and the MOD wiki's "MOD SDK / modgui" pages): a
 * `modgui:gui` node beside an LV2 plugin naming its resources directory, icon template,
 * stylesheet, screenshot, thumbnail, brand, label, model, panel, colour and knob, and one
 * `modgui:port` per control keyed by `lv2:symbol`. Credit for the format and every skin it reads
 * is MOD Devices' and each bundle's authors'; this tool copies their files only under a licence
 * that permits it, and records that licence in the package.
 *
 * The package (§6.2, §6.3): `skin.json` with the plugin, the licence and where it came from, one
 * section in `lv2:index` order, each port's `lv2:name` as its label, the screenshot as the
 * backdrop under `art/`; the modgui's whole resources directory and its TTL under `modgui/`. No
 * custom view (§6.6: a modgui icon template is not a component of the skin API), no `family` and
 * no `roles` (D6 needs a contract unit a modgui does not carry): the operator adds them by hand.
 *
 * Refusals are the codes `MODGUI_IMPORT_REFUSALS` of src/skin-package.ts, each naming the file; on any
 * of them nothing is written. Every vocabulary list (allow-list, known properties, licence map) is
 * read from it (built: this tool runs from dist/), never typed here.
 *
 *   node tools/modgui-import.mjs <bundle.lv2> --out <skins dir> [--plugin <uri>]
 *
 * prints one `MODGUI-IMPORT-JSON {…}` line; exit 0 on a package written, 3 on a refusal, 2 on usage.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as skinPackage from '../src/skin-package.js';
import { parseTurtle } from './turtle-read.mjs';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const LV2_PROJECT = 'http://lv2plug.in/ns/lv2core#project';

class Refusal extends Error {
  constructor(code, file, detail) {
    super(`${code}: ${file}: ${detail}`);
    this.code = code;
    this.file = file;
    this.detail = detail;
  }
}

const key = (term) => `${term.t}:${term.v}`;
const show = (term) => (term.t === 'iri' ? `<${term.v}>` : term.t === 'lit' ? JSON.stringify(term.v) : `_:${term.v}`);

/** Every `*.ttl` at the bundle's root, parsed; each triple carries the file it was read from. */
function readBundle(dir) {
  const triples = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ttl')).sort()) {
    const path = join(dir, f);
    let parsed;
    try {
      parsed = parseTurtle(readFileSync(path, 'utf8'), pathToFileURL(path).href);
    } catch (e) {
      throw new Refusal('MODGUI_TTL_INVALID', path, e.message);
    }
    // Blank nodes are local to their file.
    const local = (t) => (t.t === 'bnode' ? { t: 'bnode', v: `${f}#${t.v}` } : t);
    for (const t of parsed) triples.push({ s: local(t.s), p: t.p, o: local(t.o), file: path });
  }
  return triples;
}

/** A path inside the bundle, or a PATH_ESCAPE refusal; a missing file is MODGUI_NOT_FOUND. */
function insideBundle(bundle, path, file) {
  if (!existsSync(path)) throw new Refusal('MODGUI_NOT_FOUND', file, `names ${path}, which does not exist`);
  const real = realpathSync(path);
  if (real !== bundle && !real.startsWith(bundle + sep)) throw new Refusal('MODGUI_PATH_ESCAPE', file, `${path} resolves outside the bundle, to ${real}`);
  return real;
}

/** Every entry under `dir`, each checked to resolve inside the bundle (a symlink out is refused). */
function checkTree(bundle, dir, file) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(insideBundle(bundle, p, file)).isDirectory()) checkTree(bundle, p, file);
  }
}

/**
 * Import one bundle into `<out>/<skinPackageDirName(plugin)>/`. Returns the written package or
 * throws a {@link Refusal}; on a refusal nothing exists under `out` that was not there before.
 */
export function importModgui({ bundle, out, plugin }, core) {
  core ??= skinPackage;
  const NS = core.MODGUI_NS;
  const LV2 = core.LV2_NS;
  if (!existsSync(bundle) || !statSync(bundle).isDirectory()) throw new Refusal('MODGUI_NOT_FOUND', bundle, 'is not a bundle directory');
  const dir = realpathSync(bundle);
  const triples = readBundle(dir);
  const about = (s) => triples.filter((t) => key(t.s) === key(s));
  const one = (s, p) => about(s).filter((t) => t.p.v === p);

  // The plugin that carries the modgui.
  const guis = triples.filter((t) => t.p.v === `${NS}gui` && (plugin === undefined || t.s.v === plugin));
  if (guis.length === 0) throw new Refusal('MODGUI_NOT_FOUND', dir, plugin ? `no modgui:gui on <${plugin}>` : 'no modgui:gui in any TTL of the bundle');
  if (new Set(guis.map((t) => t.s.v)).size > 1 || guis.length > 1) {
    throw new Refusal('MODGUI_NOT_FOUND', dir, `${guis.length} modgui:gui nodes (${guis.map((t) => show(t.s)).join(', ')}); name one with --plugin`);
  }
  const [{ s: pluginTerm, o: gui, file: guiFile }] = guis;
  if (pluginTerm.t !== 'iri') throw new Refusal('MODGUI_TTL_INVALID', guiFile, 'the modgui:gui subject is not a plugin IRI');

  // Every modgui property it does not know is refused (§6.6), on the gui node, its ports, or anywhere.
  const knownGui = new Set(core.MODGUI_GUI_PROPERTIES.map((p) => `${NS}${p}`));
  const knownPort = new Set(core.MODGUI_PORT_PROPERTIES.map((p) => `${LV2}${p}`));
  for (const t of about(gui)) if (!knownGui.has(t.p.v)) throw new Refusal('MODGUI_UNKNOWN_PROPERTY', t.file, `modgui:gui carries ${show(t.p)}`);
  for (const t of triples) {
    if (t.p.v.startsWith(NS) && t.p.v !== `${NS}gui` && !knownGui.has(t.p.v)) throw new Refusal('MODGUI_UNKNOWN_PROPERTY', t.file, `${show(t.p)} is not a modgui property this importer knows`);
    if (t.p.v === RDF_TYPE && t.o.t === 'iri' && t.o.v.startsWith(NS)) throw new Refusal('MODGUI_UNKNOWN_PROPERTY', t.file, `a node is typed ${show(t.o)}`);
  }
  const ports = one(gui, `${NS}port`).map((t) => {
    for (const q of about(t.o)) if (!knownPort.has(q.p.v)) throw new Refusal('MODGUI_UNKNOWN_PROPERTY', q.file, `a modgui:port carries ${show(q.p)}`);
    const val = (p) => one(t.o, `${LV2}${p}`)[0]?.o.v;
    const index = Number(val('index'));
    const symbol = val('symbol');
    if (!Number.isInteger(index) || typeof symbol !== 'string' || symbol === '') throw new Refusal('MODGUI_TTL_INVALID', t.file, 'a modgui:port has no integer lv2:index or no lv2:symbol');
    return { index, symbol, name: val('name') ?? symbol };
  });
  ports.sort((a, b) => a.index - b.index);
  const lit = (p) => one(gui, `${NS}${p}`)[0]?.o.v;
  const res = (p) => {
    const t = one(gui, `${NS}${p}`)[0];
    if (!t) return undefined;
    if (t.o.t !== 'iri' || !t.o.v.startsWith('file:')) throw new Refusal('MODGUI_PATH_ESCAPE', t.file, `modgui:${p} ${show(t.o)} is not a file of the bundle`);
    return insideBundle(dir, fileURLToPath(t.o.v), t.file);
  };

  // The licence: the plugin's doap:license, else its lv2:project's (§6.6; a modgui carries none).
  let licTriples = one(pluginTerm, `${core.DOAP_NS}license`);
  if (licTriples.length === 0) for (const pr of one(pluginTerm, LV2_PROJECT)) licTriples = licTriples.concat(one(pr.o, `${core.DOAP_NS}license`));
  const pluginFile = triples.find((t) => key(t.s) === key(pluginTerm) && t.p.v === RDF_TYPE)?.file ?? guiFile;
  if (licTriples.length === 0) throw new Refusal('MODGUI_NO_LICENCE', pluginFile, `<${pluginTerm.v}> carries no doap:license, nor does its lv2:project`);
  const licences = licTriples.map((t) => {
    const spdx = core.spdxFromDoapLicence(t.o.t === 'iri' ? { iri: t.o.v } : { literal: t.o.v });
    if (spdx === null) throw new Refusal('MODGUI_LICENCE_UNMAPPED', t.file, `doap:license ${show(t.o)} names no SPDX licence`);
    if (!core.isSkinLicenceAllowed(spdx)) throw new Refusal('MODGUI_LICENCE_REFUSED', t.file, `doap:license ${show(t.o)} is ${spdx}, outside the allow-list (${core.SKIN_LICENCE_ALLOW_LIST.join(', ')})`);
    return { spdx, evidence: `${basename(t.file)} doap:license ${show(t.o)}` };
  });

  // The files: every resource inside the bundle, every entry of the resources directory too.
  const resourcesDir = res('resourcesDirectory');
  if (resourcesDir === undefined || !statSync(resourcesDir).isDirectory()) throw new Refusal('MODGUI_NOT_FOUND', guiFile, 'modgui:resourcesDirectory names no directory');
  checkTree(dir, resourcesDir, guiFile);
  const named = ['iconTemplate', 'stylesheet', 'screenshot', 'thumbnail'].map((p) => [p, res(p)]).filter(([, f]) => f !== undefined);
  const screenshot = named.find(([p]) => p === 'screenshot')?.[1];

  const id = pluginTerm.v;
  const name = core.encodeSkinId(id);
  const outDir = resolve(out);
  const target = join(outDir, name);
  if (existsSync(target)) throw new Refusal('MODGUI_TARGET_EXISTS', target, 'the package is already there; nothing is overwritten');
  const ttlCopy = basename(guiFile);
  if (existsSync(join(resourcesDir, ttlCopy))) throw new Refusal('MODGUI_TARGET_EXISTS', join(resourcesDir, ttlCopy), `the resources directory already holds a ${ttlCopy}`);

  const label = lit('label');
  const skin = {
    schema: core.SKIN_OVERRIDE_SCHEMA,
    plugin: id,
    licence: [...new Set(licences.map((l) => l.spdx))].join(' AND '),
    source: { kind: 'modgui', bundle: dir, licenceEvidence: licences.map((l) => l.evidence).join('; ') },
    sections: [{ key: 'modgui', ...(label !== undefined ? { label } : {}), controls: ports.map((p) => p.symbol) }],
    labels: Object.fromEntries(ports.map((p) => [p.symbol, { label: p.name }])),
    ...(screenshot !== undefined ? { backdrop: `art/${basename(screenshot)}` } : {}),
  };
  const checked = core.parseSkinOverride(JSON.stringify(skin), id);
  if (!checked.ok) throw new Error(`modgui-import: the package it built fails §6.3: ${checked.refusal.args.field}`);

  // Write beside the target and rename, so a failure leaves nothing behind.
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, `.${name}.importing-${process.pid}`);
  try {
    cpSync(resourcesDir, join(tmp, 'modgui'), { recursive: true, dereference: true });
    for (const [, f] of named) {
      const rel = relative(resourcesDir, f);
      if (rel.startsWith('..')) cpSync(f, join(tmp, 'modgui', relative(dir, f)));
    }
    cpSync(guiFile, join(tmp, 'modgui', ttlCopy));
    if (screenshot !== undefined) {
      mkdirSync(join(tmp, 'art'));
      cpSync(screenshot, join(tmp, 'art', basename(screenshot)));
    }
    writeFileSync(join(tmp, core.SKIN_OVERRIDE_FILE), `${JSON.stringify(skin, null, 2)}\n`);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return {
    dir: target,
    skin,
    brand: lit('brand'),
    label,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const bundle = argv.find((a, k) => !a.startsWith('--') && !['--out', '--plugin'].includes(argv[k - 1]));
  const out = opt('--out');
  if (!bundle || !out) {
    console.error('usage: modgui-import.mjs <bundle.lv2> --out <skins dir> [--plugin <uri>]');
    process.exit(2);
  }
  try {
    const r = importModgui({ bundle, out, plugin: opt('--plugin') });
    console.log(`MODGUI-IMPORT-JSON ${JSON.stringify({ verdict: 'written', dir: r.dir, licence: r.skin.licence, brand: r.brand, label: r.label, controls: r.skin.sections[0].controls })}`);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.log(`MODGUI-IMPORT-JSON ${JSON.stringify({ verdict: 'refused', code: e.code, file: e.file, detail: e.detail })}`);
    console.error(`refused ${e.code}: ${e.file}: ${e.detail} (nothing written)`);
    process.exit(3);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
