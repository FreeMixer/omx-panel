#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * lv2-complement.mjs — the complement bundle writer (docs/lv2-complement.md; plugin-hostd#218, lane G2). For an
 * installed LV2 bundle holding a plugin whose groups tools/group-infer.mjs infers (`grouped`), it writes a bundle
 * that REPLACES the installed one in lilv: the installed TTL restated statement for statement as the Turtle reader
 * (tools/turtle-read.mjs) reads it, never retyped; lv2:binary still the installed library; lv2:minorVersion kept and
 * lv2:microVersion one above what is installed, so lilv's duplicate rule loads ours; the inferred group nodes (lv2:symbol,
 * lv2:name, lv2:displayPriority) and pg:group on each port, by port symbol. A marker file, `.omx-complement-sync`, in
 * the bundle names the installed bundle, the content hash and every plugin's versions: a second run over the same
 * installed files writes nothing, and deleting the bundle is the whole removal: the sync deletes a bundle of ours whose
 * installed bundle is gone, changed into one it refuses, or needs no groups now (lane G3).
 *
 * The unit is the installed BUNDLE, not the plugin: lilv drops the whole old bundle when one of its plugins is
 * replaced ("Dropping old bundle"), so a bundle with several plugins (Calf's, LSP's, MDA's) is restated whole, every
 * plugin bumped, and the groups go to the grouped ones only.
 *
 * Nothing is written for a bundle none of whose plugins is `grouped` (`nothing-to-do`, `no-confident-grouping`), and
 * the installed files are never written. A bundle the restatement cannot carry is refused with a reason, never
 * written: TTL the reader cannot parse, a version at lilv's ceiling (an int) or not an integer, more than one
 * version, binary or bundle for a plugin URI, a dynamic manifest, a data file outside the bundle.
 *
 *   node tools/lv2-complement.mjs --out <dir> [--lv2-path <a:b:...>] [--state <dir>] [--only <bundle.lv2>]...
 *                                 [--dry-run | --check] [--verbose] [--log-prefix <name>]
 *
 * One line per bundle written, replaced, removed, refused or skipped (and with --verbose one per plugin, its verdict),
 * and a summary; exit 0 when the run finished (whatever it refused), 1 when it could not start, 2 on usage. A bundle of
 * ours (named omx-complement-*, holding the marker) that is no longer wanted is removed, with the reason; nothing
 * unmarked is ever removed. --dry-run writes and removes nothing and says what it would; --check also writes nothing
 * and exits 3 when a bundle of ours is stale (the run would remove it) or out of date (it would write it again).
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inferGroups, readModguiLayout, readPluginPorts } from './group-infer.mjs';
import { parseTurtle } from './turtle-read.mjs';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const LV2 = 'http://lv2plug.in/ns/lv2core#';
const PG = 'http://lv2plug.in/ns/ext/port-groups#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DMAN = 'http://lv2plug.in/ns/ext/dynmanifest#';

/** The marker in every bundle this writer makes, named after the command that runs it (omx-modgui-sync's model). */
export const MARKER = '.omx-complement-sync';
/** Every bundle this writer makes is omx-complement-<installed bundle's name>.lv2. */
export const PREFIX = 'omx-complement-';
/** lilv reads lv2:minorVersion and lv2:microVersion with atoi into an int: a bump past this overflows. */
export const VERSION_CEILING = 2147483647;

const TOOLS = dirname(fileURLToPath(import.meta.url));

/** A bundle the restatement cannot carry: `reason` is the code, `detail` names the file or the plugin. */
export class Refusal extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
    this.detail = detail;
  }
}

/** The writer's identity in a marker: a hash of the modules that decide what is written. A changed rule rewrites. */
export function writerId() {
  const h = createHash('sha256');
  for (const f of ['lv2-complement.mjs', 'group-infer.mjs', 'turtle-read.mjs']) h.update(f).update('\0').update(readFileSync(join(TOOLS, f))).update('\0');
  return h.digest('hex');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const termKey = (t) => (t.t === 'bnode' ? `_:${t.v}` : t.v);
const isType = (t, cls) => t.p.v === `${RDF}type` && t.o.t === 'iri' && t.o.v === cls;

// ---------------------------------------------------------------------------------------------------------------
// Reading an installed bundle as lilv does: manifest.ttl, the plugins it types lv2:Plugin, and each plugin's
// rdfs:seeAlso files (lilv's load_plugin_model reads exactly these).

/**
 * @typedef {{ name: string, path: string, url: string, bytes: Buffer, triples: { s: any, p: any, o: any }[] }} TtlFile
 * @typedef {{ dir: string, url: string, files: Map<string, TtlFile>, plugins: string[], seeAlso: Map<string, string[]>,
 *   hash: string, dynamic: boolean }} InstalledBundle
 */

/**
 * Read the installed bundle at `dir`. Throws a Refusal for TTL the reader cannot parse or a plugin data file outside
 * the bundle; returns null for a directory with no manifest.ttl.
 * @returns {InstalledBundle | null}
 */
export function readInstalledBundle(dir) {
  dir = resolve(dir);
  const url = pathToFileURL(`${dir}/`).href;
  if (!existsSync(join(dir, 'manifest.ttl'))) return null;
  /** @type {Map<string, TtlFile>} */
  const files = new Map();
  const read = (name) => {
    const path = join(dir, name);
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch (e) {
      throw new Refusal('ttl-missing', `${path}: ${e.code ?? e.message}`);
    }
    let triples;
    try {
      triples = parseTurtle(bytes.toString('utf8'), pathToFileURL(path).href);
    } catch (e) {
      throw new Refusal('ttl-unreadable', `${path}: ${e.message}`);
    }
    files.set(name, { name, path, url: pathToFileURL(path).href, bytes, triples });
  };
  read('manifest.ttl');
  const manifest = /** @type {TtlFile} */ (files.get('manifest.ttl'));
  const plugins = [...new Set(manifest.triples.filter((t) => t.s.t === 'iri' && isType(t, `${LV2}Plugin`)).map((t) => t.s.v))].sort();
  const dynamic = manifest.triples.some((t) => isType(t, `${DMAN}DynManifest`));
  const seeAlso = new Map();
  for (const uri of plugins) {
    const names = [];
    for (const t of manifest.triples) {
      if (t.s.t !== 'iri' || t.s.v !== uri || t.p.v !== `${RDFS}seeAlso` || t.o.t !== 'iri') continue;
      if (!t.o.v.startsWith(url)) throw new Refusal('data-outside-bundle', `${uri}: rdfs:seeAlso ${t.o.v} is not in ${dir}`);
      const name = decodeURIComponent(t.o.v.slice(url.length));
      if (name === '' || name.split('/').includes('..')) throw new Refusal('data-outside-bundle', `${uri}: rdfs:seeAlso ${t.o.v}`);
      if (!files.has(name)) read(name);
      if (!names.includes(name)) names.push(name);
    }
    seeAlso.set(uri, names);
  }
  const h = createHash('sha256');
  for (const name of [...files.keys()].sort()) h.update(name).update('\0').update(/** @type {TtlFile} */ (files.get(name)).bytes).update('\0');
  return { dir, url, files, plugins, seeAlso, hash: h.digest('hex'), dynamic };
}

/** The triples lilv holds for `uri`: the manifest and its seeAlso files, each file's blank nodes local to it. */
export function pluginTriples(bundle, uri) {
  const out = [];
  for (const name of ['manifest.ttl', ...(bundle.seeAlso.get(uri) ?? [])]) {
    const f = /** @type {TtlFile} */ (bundle.files.get(name));
    const local = (t) => (t.t === 'bnode' ? { t: 'bnode', v: `${name}#${t.v}` } : t);
    for (const t of f.triples) out.push({ s: local(t.s), p: t.p, o: local(t.o) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Planning: the verdict per plugin, the versions, and whether the bundle is written or refused.

/** lilv's reading of a plugin's version: both values present, else 0.0 (lilv/src/world.c get_version). */
function versionOf(bundle, uri) {
  const values = (p) => {
    const vs = new Set();
    for (const name of ['manifest.ttl', ...(bundle.seeAlso.get(uri) ?? [])]) {
      for (const t of /** @type {TtlFile} */ (bundle.files.get(name)).triples) if (t.s.t === 'iri' && t.s.v === uri && t.p.v === p) vs.add(t.o.t === 'lit' ? t.o.v : termKey(t.o));
    }
    return [...vs];
  };
  const read = (field) => {
    const vs = values(`${LV2}${field}`);
    if (vs.length > 1) throw new Refusal('version-ambiguous', `${uri} states lv2:${field} ${vs.join(' and ')}`);
    if (vs.length === 0) return undefined;
    if (!/^[+-]?\d+$/.test(vs[0])) throw new Refusal('version-unreadable', `${uri}: lv2:${field} ${vs[0]} is not an integer`);
    const n = Number(vs[0]);
    if (Math.abs(n) > VERSION_CEILING) throw new Refusal('version-ceiling', `${uri}: lv2:${field} ${vs[0]} is past lilv's ${VERSION_CEILING}`);
    return n;
  };
  const minor = read('minorVersion');
  const micro = read('microVersion');
  const installed = minor !== undefined && micro !== undefined ? { minor, micro } : { minor: 0, micro: 0 };
  const next = { minor: minor ?? 0, micro: (micro ?? 0) + 1 };
  if (next.micro > VERSION_CEILING) throw new Refusal('version-ceiling', `${uri}: lv2:microVersion ${micro} cannot be raised past lilv's ${VERSION_CEILING}`);
  if (next.minor < installed.minor || (next.minor === installed.minor && next.micro <= installed.micro)) {
    throw new Refusal('version-not-newer', `${uri}: ${next.minor}.${next.micro} would not be newer than ${installed.minor}.${installed.micro}`);
  }
  const binaries = values(`${LV2}binary`);
  if (binaries.length === 0) throw new Refusal('no-binary', `${uri} states no lv2:binary`);
  if (binaries.length > 1) throw new Refusal('binary-ambiguous', `${uri} states lv2:binary ${binaries.join(' and ')}`);
  return { stated: { minor, micro }, installed, next, binary: binaries[0] };
}

/**
 * @typedef {{ uri: string, verdict: any, version?: any }} PlannedPlugin
 * @typedef {{ bundle: InstalledBundle, plugins: PlannedPlugin[], write: boolean, refusal?: Refusal }} Plan
 */

/**
 * What to do with an installed bundle. `elsewhere(uri)` lists the other installed bundles declaring `uri` (a plugin
 * in two bundles is one lilv picks between by version; the restatement cannot say which it replaces).
 * @param {InstalledBundle} bundle
 * @param {{ elsewhere?: (uri: string) => string[] }} [options]
 * @returns {Plan}
 */
export function planBundle(bundle, options = {}) {
  const plugins = bundle.plugins.map((uri) => {
    const triples = pluginTriples(bundle, uri);
    return { uri, verdict: inferGroups(readPluginPorts(triples, uri), readModguiLayout(triples, uri)) };
  });
  const plan = { bundle, plugins, write: false };
  if (!plugins.some((p) => p.verdict.outcome === 'grouped')) return plan;
  try {
    if (bundle.dynamic) throw new Refusal('dynamic-manifest', `${bundle.dir} has a dynamic manifest`);
    for (const p of plugins) {
      const others = options.elsewhere?.(p.uri) ?? [];
      if (others.length > 0) throw new Refusal('plugin-in-several-bundles', `${p.uri} is declared in ${bundle.dir} and ${others.join(', ')}`);
      p.version = versionOf(bundle, p.uri);
    }
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { ...plan, refusal: e };
  }
  return { ...plan, write: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Writing: every restated file as Turtle, the statements in the reader's terms.

const PREFIXES = [
  ['rdf', RDF], ['rdfs', RDFS], ['xsd', XSD], ['owl', 'http://www.w3.org/2002/07/owl#'],
  ['lv2', LV2], ['pg', PG], ['units', 'http://lv2plug.in/ns/extensions/units#'], ['ui', 'http://lv2plug.in/ns/extensions/ui#'],
  ['pprops', 'http://lv2plug.in/ns/ext/port-props#'], ['atom', 'http://lv2plug.in/ns/ext/atom#'], ['urid', 'http://lv2plug.in/ns/ext/urid#'],
  ['opts', 'http://lv2plug.in/ns/ext/options#'], ['state', 'http://lv2plug.in/ns/ext/state#'], ['time', 'http://lv2plug.in/ns/ext/time#'],
  ['midi', 'http://lv2plug.in/ns/ext/midi#'], ['patch', 'http://lv2plug.in/ns/ext/patch#'], ['param', 'http://lv2plug.in/ns/ext/parameters#'],
  ['pset', 'http://lv2plug.in/ns/ext/presets#'], ['work', 'http://lv2plug.in/ns/ext/worker#'], ['bufsz', 'http://lv2plug.in/ns/ext/buf-size#'],
  ['doap', 'http://usefulinc.com/ns/doap#'], ['foaf', 'http://xmlns.com/foaf/0.1/'], ['dct', 'http://purl.org/dc/terms/'],
  ['mod', 'http://moddevices.com/ns/mod#'], ['modgui', 'http://moddevices.com/ns/modgui#'],
];
const LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/;
// The reader's own number token (tools/turtle-read.mjs) and the datatype it gives each shape
const NUMBER = /^[+-]?(?:\d+\.\d*[eE][+-]?\d+|\.?\d+[eE][+-]?\d+|\d*\.\d+|\d+)$/;
const numberType = (s) => `${XSD}${/[eE]/.test(s) ? 'double' : s.includes('.') ? 'decimal' : 'integer'}`;

function escapeString(s) {
  return s.replace(/[\\"\n\r\t\b\f]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' })[c]);
}

function escapeIri(s) {
  // the characters an IRIREF cannot hold, as \u escapes the reader reads back
  return s.replace(/[\x00-\x20<>"{}|^`\\]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
}

/**
 * Turtle text for one file's statements; `rel` IRIs are written relative (resolved against the written file). Blank
 * node labels carry `blank`, the file's own prefix: lilv keeps each file's blank nodes apart, a tool that reads the
 * bundle's files into one graph (sord_validate) does not.
 */
function serialize(triples, header, blank) {
  const used = new Set();
  const iri = (v, rel) => {
    if (rel) return `<${escapeIri(v)}>`;
    for (const [p, ns] of PREFIXES) {
      if (v.startsWith(ns) && LOCAL.test(v.slice(ns.length))) {
        used.add(p);
        return `${p}:${v.slice(ns.length)}`;
      }
    }
    return `<${escapeIri(v)}>`;
  };
  const term = (t) => {
    if (t.t === 'iri') return iri(t.v, t.rel);
    if (t.t === 'bnode') return `_:${blank}${t.v}`;
    if (t.lang) return `"${escapeString(t.v)}"@${t.lang}`;
    if (t.dt === `${XSD}string`) return `"${escapeString(t.v)}"`;
    if (NUMBER.test(t.v) && numberType(t.v) === t.dt) return t.v;
    if (t.dt === `${XSD}boolean` && (t.v === 'true' || t.v === 'false')) return t.v;
    return `"${escapeString(t.v)}"^^${iri(t.dt)}`;
  };
  const bySubject = new Map();
  for (const t of triples) {
    const k = `${t.s.t}:${t.s.v}`;
    if (!bySubject.has(k)) bySubject.set(k, { s: t.s, pos: [] });
    bySubject.get(k).pos.push(t);
  }
  const body = [];
  for (const { s, pos } of bySubject.values()) {
    const lines = pos.map((t) => `\t${t.p.v === `${RDF}type` ? 'a' : iri(t.p.v)} ${term(t.o)}`);
    body.push(`${term(s)}\n${lines.join(' ;\n')} .\n`);
  }
  const prefixes = PREFIXES.filter(([p]) => used.has(p)).map(([p, ns]) => `@prefix ${p}: <${ns}> .\n`).join('');
  return `${header.map((l) => `# ${l}`.trimEnd()).join('\n')}\n\n${prefixes}\n${body.join('\n')}`;
}

/**
 * The bundle's files: every installed TTL file lilv reads for the bundle's plugins, restated, with the versions
 * raised, the seeAlso references pointing at the restated files, and the inferred groups added.
 * @param {Plan} plan
 * @returns {Map<string, string>} file name in the new bundle -> its text
 */
export function renderBundle(plan) {
  const { bundle } = plan;
  if (!plan.write) throw new Error(`${bundle.dir}: nothing to write`);
  const restated = new Map([...bundle.files.values()].map((f) => [f.url, f.name]));
  const pluginSet = new Set(bundle.plugins);
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const f of bundle.files.values()) {
    const triples = [];
    for (const t of f.triples) {
      if (t.s.t === 'iri' && pluginSet.has(t.s.v) && (t.p.v === `${LV2}minorVersion` || t.p.v === `${LV2}microVersion`)) continue;
      if (t.p.v === `${RDFS}seeAlso` && t.o.t === 'iri' && restated.has(t.o.v)) {
        triples.push({ s: t.s, p: t.p, o: { t: 'iri', v: encodeURI(/** @type {string} */ (restated.get(t.o.v))), rel: true } });
        continue;
      }
      triples.push(t);
    }
    out.set(f.name, triples);
  }
  const manifest = /** @type {any[]} */ (out.get('manifest.ttl'));
  const int = (n) => ({ t: 'lit', v: String(n), dt: `${XSD}integer` });
  // what each file states, by subject and predicate, kept as the groups add statements
  const stated = { inFile: new Set(), anywhere: new Set(), note: (name, t) => {} };
  stated.note = (name, t) => {
    stated.inFile.add(`${name}\0${termKey(t.s)}\0${t.p.v}`);
    stated.anywhere.add(`${termKey(t.s)}\0${t.p.v}`);
  };
  for (const [name, triples] of out) for (const t of triples) stated.note(name, t);
  for (const p of plan.plugins) {
    const s = { t: 'iri', v: p.uri };
    manifest.push({ s, p: { t: 'iri', v: `${LV2}minorVersion` }, o: int(p.version.next.minor) });
    manifest.push({ s, p: { t: 'iri', v: `${LV2}microVersion` }, o: int(p.version.next.micro) });
    if (p.verdict.outcome === 'grouped') addGroups(bundle, p, out, stated);
  }
  const texts = new Map();
  let fileIndex = 0;
  for (const [name, triples] of out) {
    const f = /** @type {TtlFile} */ (bundle.files.get(name));
    const blank = `f${fileIndex++}_`;
    texts.set(name, serialize(triples, [
      `Written by omx-complement-sync (omx-panel lv2-complement) from ${f.path}:`,
      'that file\'s statements restated as omx-panel\'s Turtle reader reads them, with lv2:microVersion raised by one',
      'so lilv loads this bundle in place of the installed one, and the port groups omx-panel inferred added.',
      `The installed files are untouched; delete this bundle (it holds ${MARKER}) to load them again.`,
    ], blank));
  }
  return texts;
}

/** The statements of the inferred groups of plugin `p`, added to the file that states its ports. */
function addGroups(bundle, p, out, stated) {
  const P = (v) => ({ t: 'iri', v });
  const lit = (v) => ({ t: 'lit', v: String(v), dt: `${XSD}string` });
  const int = (n) => ({ t: 'lit', v: String(n), dt: `${XSD}integer` });
  const has = (name, s, pred) => stated.inFile.has(`${name}\0${termKey(s)}\0${pred}`);
  const add = (name, t) => {
    /** @type {any[]} */ (out.get(name)).push(t);
    stated.note(name, t);
  };
  // each port of the plugin, by symbol: the file that states it and its node there
  const ports = new Map();
  for (const name of ['manifest.ttl', ...(bundle.seeAlso.get(p.uri) ?? [])]) {
    const f = bundle.files.get(name);
    const symbols = new Map();
    for (const t of f.triples) if (t.p.v === `${LV2}symbol` && t.o.t === 'lit') symbols.set(termKey(t.s), t.o.v);
    for (const t of f.triples) {
      if (t.s.t !== 'iri' || t.s.v !== p.uri || t.p.v !== `${LV2}port`) continue;
      const sym = symbols.get(termKey(t.o));
      if (sym === undefined) continue;
      if (ports.has(sym)) throw new Refusal('port-symbol-ambiguous', `${p.uri}: two ports with lv2:symbol ${sym}`);
      ports.set(sym, { name, node: t.o });
    }
  }
  const tail = p.uri.replace(/[/#:]+$/, '').split(/[/#:]/).pop() ?? 'plugin';
  const slug = tail.replace(/[^A-Za-z0-9_-]+/g, '_') || 'plugin';
  for (const g of p.verdict.groups) {
    const members = g.ports.map((s) => {
      const port = ports.get(s);
      if (!port) throw new Refusal('port-not-found', `${p.uri}: no port with lv2:symbol ${s}`);
      return port;
    });
    const file = members[0].name;
    // the plugin's own group node keeps its identity: a blank one is local to its file ("<file>#<label>")
    let node = { t: 'iri', v: `#${slug}-${g.symbol}`, rel: true };
    let target = file;
    if (g.node?.startsWith('_:')) {
      const k = g.node.lastIndexOf('#');
      target = g.node.slice(2, k);
      node = { t: 'bnode', v: g.node.slice(k + 1) };
    } else if (g.node !== undefined) {
      node = P(g.node);
    }
    // a blank node is stated in its own file only; an IRI may be stated in any of the bundle's files
    const known = (pred) => (node.t === 'iri' && !node.rel ? stated.anywhere.has(`${termKey(node)}\0${pred}`) : has(target, node, pred));
    if (g.node === undefined) add(target, { s: node, p: P(`${RDF}type`), o: P(`${PG}Group`) });
    if (!known(`${LV2}symbol`)) add(target, { s: node, p: P(`${LV2}symbol`), o: lit(g.symbol) });
    if (!known(`${LV2}name`)) add(target, { s: node, p: P(`${LV2}name`), o: lit(g.name) });
    if (!known(`${LV2}displayPriority`)) add(target, { s: node, p: P(`${LV2}displayPriority`), o: int(g.displayPriority) });
    for (const m of members) {
      if (has(m.name, m.node, `${PG}group`)) continue; // a port the plugin itself groups keeps its own pg:group
      if (node.rel && m.name !== file) throw new Refusal('ports-split-across-files', `${p.uri}: group ${g.symbol} has ports in ${file} and ${m.name}`);
      add(m.name, { s: m.node, p: P(`${PG}group`), o: node });
    }
  }
}

/** The marker's text: the installed bundle, the writer, the content hash, then one line per plugin. */
export function markerText(plan, writer = writerId()) {
  const v = (x) => `${x.minor}.${x.micro}`;
  const lines = [plan.bundle.dir, `writer ${writer}`, `source-sha256 ${plan.bundle.hash}`];
  for (const p of plan.plugins) {
    const what = p.verdict.outcome === 'grouped' ? `grouped ${p.verdict.groups.length}` : `restated ${p.verdict.outcome}`;
    lines.push(`plugin ${p.uri} ${v(p.version.installed)} ${v(p.version.next)} ${what}`);
  }
  for (const f of [...plan.bundle.files.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) lines.push(`file ${f.name} ${sha256(f.bytes)}`);
  return `${lines.join('\n')}\n`;
}

/** A written bundle is up to date when its marker names the same installed bundle, writer and content hash. */
export function isFresh(outBundle, plan, writer = writerId()) {
  const marker = join(outBundle, MARKER);
  if (!existsSync(marker)) return false;
  const [dir, w, h] = readFileSync(marker, 'utf8').split('\n');
  return dir === plan.bundle.dir && w === `writer ${writer}` && h === `source-sha256 ${plan.bundle.hash}`;
}

/** The name of the bundle written for an installed one. */
export function outName(bundleDir) {
  const stem = basename(bundleDir).replace(/\.lv2$/, '').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${PREFIX}${stem}.lv2`;
}

/**
 * Write `plan`'s bundle at `target`: built in a work directory under `stateDir` and moved in whole, so lilv never
 * reads half a bundle. Every other entry of the installed bundle is linked in, so a plugin that reads its own files
 * from the bundle path lilv hands it (ours now) still finds them.
 */
export function writeBundle(plan, target, stateDir, writer = writerId()) {
  const texts = renderBundle(plan);
  mkdirSync(stateDir, { recursive: true });
  const work = mkdtempSync(join(stateDir, 'complement.'));
  try {
    const tmp = join(work, basename(target));
    mkdirSync(tmp);
    for (const [name, text] of texts) {
      mkdirSync(dirname(join(tmp, name)), { recursive: true });
      writeFileSync(join(tmp, name), text);
    }
    mirror(plan.bundle.dir, tmp, new Set([...texts.keys(), MARKER]), '');
    writeFileSync(join(tmp, MARKER), markerText(plan, writer));
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    try {
      renameSync(tmp, target);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      cpSync(tmp, target, { recursive: true, verbatimSymlinks: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Link every entry of `src` into `dst` except the files written; a directory holding a written file is walked. */
function mirror(src, dst, written, rel) {
  for (const name of readdirSync(src)) {
    const r = rel ? `${rel}/${name}` : name;
    if (written.has(r)) continue;
    const inside = [...written].some((w) => w.startsWith(`${r}/`));
    if (inside) {
      mkdirSync(join(dst, name), { recursive: true });
      mirror(join(src, name), join(dst, name), written, r);
    } else {
      symlinkSync(join(src, name), join(dst, name));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The run over a search list.

/** Every bundle directory on the search list, in its order; the writer's own bundles (marked) are not installed ones. */
export function installedBundles(lv2Path) {
  const out = [];
  const seen = new Set();
  for (const root of lv2Path.split(':').filter(Boolean)) {
    let names;
    try {
      names = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = resolve(root, name);
      if (seen.has(dir)) continue;
      seen.add(dir);
      try {
        if (!statSync(dir).isDirectory() || existsSync(join(dir, MARKER))) continue;
      } catch {
        continue;
      }
      if (existsSync(join(dir, 'manifest.ttl'))) out.push(dir);
    }
  }
  return out;
}

/**
 * Plan (and, unless `dryRun` or `check`, write) a complement for every installed bundle on `lv2Path` that needs one,
 * into `outDir`, and remove every bundle of ours that is no longer wanted. Ours is a directory `omx-complement-*.lv2`
 * holding the marker; nothing else in `outDir` is ever removed or written. A bundle of ours is kept only when this run
 * finds it up to date or writes it again; any other is stale and removed, the log naming it and why: its installed
 * bundle is gone (or no longer on the search list), changed and is now refused, needs no groups now, or is refused on
 * the current rules. `check` writes and removes nothing and names each bundle of ours that is stale or out of date.
 * @returns {{ counts: Record<string, number>, refusals: Record<string, number> }}
 */
export function sync({ lv2Path, outDir, stateDir, dryRun = false, check = false, verbose = false, only = [], log = () => {}, writer = writerId() }) {
  const counts = { written: 0, replaced: 0, outOfDate: 0, fresh: 0, refused: 0, notOurs: 0, removed: 0, grouped: 0, nothingToDo: 0, noConfident: 0, unreadable: 0, plugins: 0 };
  const refusals = {};
  const noWrite = dryRun || check;
  // why an installed bundle has no complement this run: the removal names it
  const why = new Map();
  const refuse = (dir, e) => {
    counts.refused++;
    refusals[e.reason] = (refusals[e.reason] ?? 0) + 1;
    why.set(dir, `it is refused now (${e.message})`);
    log(`refused ${dir}: ${e.message}`);
  };
  const dirs = installedBundles(lv2Path);
  const read = new Map();
  const declaredIn = new Map();
  for (const dir of dirs) {
    try {
      const b = readInstalledBundle(dir);
      if (!b) continue;
      read.set(dir, b);
      for (const uri of b.plugins) declaredIn.set(uri, [...(declaredIn.get(uri) ?? []), dir]);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      read.set(dir, e);
    }
  }
  const onlySet = new Set(only.map((d) => resolve(d)));
  // the bundles of ours this run leaves in effect: up to date, or written (in a dry run, would be written)
  const kept = new Set();
  for (const [dir, b] of read) {
    if (onlySet.size > 0 && !onlySet.has(dir)) continue;
    if (b instanceof Refusal) {
      counts.unreadable++;
      refuse(dir, b);
      continue;
    }
    if (b.plugins.length === 0) {
      why.set(dir, 'it declares no plugin now');
      continue;
    }
    let plan;
    try {
      plan = planBundle(b, { elsewhere: (uri) => (declaredIn.get(uri) ?? []).filter((d) => d !== dir) });
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      refuse(dir, e);
      continue;
    }
    for (const p of plan.plugins) {
      counts.plugins++;
      if (verbose) {
        const v = p.verdict;
        log(`plugin ${p.uri}: ${v.outcome}${v.outcome === 'grouped' ? ` ${v.groups.map((g) => `${g.symbol}(${g.ports.length})`).join(' ')}` : ` ${v.reason}${v.detail ? ` (${v.detail})` : ''}`}`);
      }
      if (p.verdict.outcome === 'grouped') counts.grouped++;
      else if (p.verdict.outcome === 'nothing-to-do') counts.nothingToDo++;
      else counts.noConfident++;
    }
    if (plan.refusal) {
      refuse(dir, plan.refusal);
      continue;
    }
    if (!plan.write) {
      why.set(dir, 'none of its plugins comes out grouped on the current rules');
      continue;
    }
    const target = join(outDir, outName(dir));
    const grouped = plan.plugins.filter((p) => p.verdict.outcome === 'grouped').map((p) => p.uri);
    const ours = isOurs(target);
    if (existsSync(target) && !ours) {
      counts.notOurs++;
      log(`skip ${dir}: ${target} is not ours`);
      continue;
    }
    if (ours && isFresh(target, plan, writer)) {
      counts.fresh++;
      kept.add(target);
      continue;
    }
    // a bundle of ours there and not up to date: say what changed, it is replaced whole
    const change = ours ? staleness(target, plan, writer) : '';
    try {
      renderBundle(plan);
      const what = `${grouped.length} of ${plan.plugins.length} plugin(s) grouped (${grouped.join(', ')})`;
      if (check) {
        if (ours) {
          counts.outOfDate++;
          log(`out of date ${target}: ${change}; the sync writes it again`);
        } else log(`missing ${target} for ${dir}: ${what}; the sync writes it`);
      } else if (dryRun) {
        log(`would ${ours ? 'replace' : 'write'} ${target} for ${dir}${ours ? ` (${change})` : ''}: ${what}`);
      } else {
        writeBundle(plan, target, stateDir, writer);
        log(`${ours ? 'replaced' : 'wrote'} ${target} for ${dir}${ours ? ` (${change})` : ''}: ${what}`);
      }
      counts.written++;
      if (ours) counts.replaced++;
      kept.add(target);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      refuse(dir, e);
    }
  }
  // Ours, no longer wanted: removed. With --only, only the bundles written for the bundles named.
  if (existsSync(outDir)) {
    for (const name of readdirSync(outDir).sort()) {
      const b = join(outDir, name);
      if (!name.startsWith(PREFIX) || !isOurs(b) || kept.has(b)) continue;
      const marker = readFileSync(join(b, MARKER), 'utf8').split('\n');
      const source = marker[0];
      if (onlySet.size > 0 && !onlySet.has(source)) continue;
      const installed = read.get(source);
      let reason;
      if (installed === undefined) reason = `its installed bundle ${source} is gone, or no longer on the search list`;
      else {
        const changed = !(installed instanceof Refusal) && marker[2] !== `source-sha256 ${installed.hash}`;
        reason = `${source}: ${changed ? 'it changed, and ' : ''}${why.get(source) ?? `it is complemented by ${join(outDir, outName(source))} now`}`;
      }
      counts.removed++;
      if (check) log(`stale ${b}: ${reason}; the sync removes it`);
      else if (dryRun) log(`would remove ${b}: ${reason}`);
      else {
        rmSync(b, { recursive: true, force: true });
        log(`removed ${b}: ${reason}`);
      }
    }
  }
  return { counts, refusals };
}

/** A directory of ours: a real directory (not a link) holding the marker. The marker is the proof of ownership. */
export function isOurs(dir) {
  try {
    return lstatSync(dir).isDirectory() && lstatSync(join(dir, MARKER)).isFile();
  } catch {
    return false;
  }
}

/** Why a bundle of ours is not up to date for `plan`: its installed files changed, or the rules (the writer) did. */
function staleness(target, plan, writer) {
  const [dir, w, h] = readFileSync(join(target, MARKER), 'utf8').split('\n');
  const changes = [];
  if (dir !== plan.bundle.dir) changes.push(`it was written for ${dir}`);
  if (h !== `source-sha256 ${plan.bundle.hash}`) changes.push('the installed files changed');
  if (w !== `writer ${writer}`) changes.push('the rules changed');
  return changes.join(', ') || 'its marker is not this writer\'s';
}

/** The summary line. */
export function summary({ counts, refusals }, dryRun = false) {
  const why = Object.entries(refusals).sort().map(([r, n]) => `${n} ${r}`).join(', ');
  const would = (done, todo) => (dryRun ? todo : done);
  return `${counts.written} ${would('written', 'would be written')}${counts.replaced ? ` (${counts.replaced} ${would('replacing', 'would replace')} an out-of-date one)` : ''}, `
    + `${counts.fresh} up to date, ${counts.refused} refused${why ? ` (${why})` : ''}, `
    + `${counts.notOurs} not ours, ${counts.removed} ${would('removed', 'would be removed')}; plugins: ${counts.plugins} read, ${counts.grouped} grouped, `
    + `${counts.nothingToDo} nothing to do, ${counts.noConfident} without a confident grouping`;
}

// ---------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: lv2-complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose] [--log-prefix <name>]\n';

function main(argv) {
  const opts = { only: [], dryRun: false, check: false, verbose: false, lv2Path: process.env.LV2_PATH, prefix: 'lv2-complement' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? (process.stderr.write(USAGE), process.exit(2));
    if (a === '--out') opts.out = val();
    else if (a === '--lv2-path') opts.lv2Path = val();
    else if (a === '--state') opts.state = val();
    else if (a === '--only') opts.only.push(val());
    else if (a === '--log-prefix') opts.prefix = val();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--verbose') opts.verbose = true;
    else {
      process.stderr.write(USAGE);
      process.exit(2);
    }
  }
  if (!opts.out || !opts.lv2Path || (opts.dryRun && opts.check)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const say = (line) => process.stdout.write(`${opts.prefix}: ${line}\n`);
  const outDir = resolve(opts.out);
  if (!opts.dryRun && !opts.check) {
    try {
      mkdirSync(outDir, { recursive: true });
    } catch (e) {
      process.stderr.write(`${opts.prefix}: cannot write ${outDir}: ${e.message}\n`);
      process.exit(1);
    }
  }
  if (!opts.lv2Path.split(':').includes(outDir) && !opts.lv2Path.split(':').map((p) => resolve(p)).includes(outDir)) {
    say(`note: ${outDir} is not on the LV2 search list; lilv loads these bundles once it is`);
  }
  const result = sync({ lv2Path: opts.lv2Path, outDir, stateDir: resolve(opts.state ?? tmpdir()), dryRun: opts.dryRun, check: opts.check, verbose: opts.verbose, only: opts.only, log: say });
  say(summary(result, opts.dryRun || opts.check));
  if (opts.check) {
    const stale = result.counts.removed + result.counts.outOfDate;
    say(stale ? `${stale} bundle(s) of ours stale or out of date: ${result.counts.removed} to remove, ${result.counts.outOfDate} to write again` : 'no bundle of ours is stale');
    process.exit(stale ? 3 : 0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
