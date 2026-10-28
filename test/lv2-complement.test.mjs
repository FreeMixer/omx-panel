// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/lv2-complement.mjs (docs/lv2-complement.md; plugin-hostd#218, G2), built: over installed-shaped bundles made
 * from G1's fixtures (test/fixtures/lv2-groups, each file copied in byte for byte, beside a manifest.ttl naming it),
 * the written bundle restates every installed statement exactly, raises lv2:microVersion by one and keeps
 * lv2:minorVersion, carries the inferred groups by port symbol, and holds a marker; a second run writes nothing; a
 * bundle needing no groups gets nothing; the degenerate cases are refused, never written; the installed files are
 * never touched. With python3-lilv, lilv loads the written bundle in place of the installed one and the installed one
 * again once it is deleted; the omx-complement-sync arm runs the installed-side script.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inferGroups, pluginUris, readModguiLayout, readPluginPorts } from '../dist/tools/group-infer.mjs';
import {
  MARKER,
  VERSION_CEILING,
  markerText,
  outName,
  planBundle,
  pluginTriples,
  readInstalledBundle,
  renderBundle,
  summary,
  sync,
} from '../dist/tools/lv2-complement.mjs';
import { parseTurtle } from '../dist/tools/turtle-read.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures/lv2-groups');
const LV2 = 'http://lv2plug.in/ns/lv2core#';
const PG = 'http://lv2plug.in/ns/ext/port-groups#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SEE_ALSO = 'http://www.w3.org/2000/01/rdf-schema#seeAlso';
const lilv = spawnSync('python3', ['-I', '-c', 'import lilv'], { encoding: 'utf8' }).status === 0;
const noLilv = !lilv && 'python3-lilv is not installed';

const scratch = () => mkdtempSync(join(tmpdir(), 'omx-lv2-complement-'));

/**
 * An installed-shaped bundle `<lv2>/<name>.lv2` from fixture directories: their TTL files copied byte for byte, a
 * manifest.ttl typing each plugin they describe with its binary and its seeAlso files, and the binary itself.
 */
function installed(lv2, name, fixtureDirs, { manifestExtra = '' } = {}) {
  const dir = join(lv2, `${name}.lv2`);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const fx of fixtureDirs) {
    for (const f of readdirSync(join(FIXTURES, fx)).filter((n) => n.endsWith('.ttl'))) {
      cpSync(join(FIXTURES, fx, f), join(dir, f));
      files.push(f);
    }
  }
  const triples = files.flatMap((f) => parseTurtle(readFileSync(join(dir, f), 'utf8'), pathToFileURL(join(dir, f)).href));
  const uris = pluginUris(triples);
  // the binary the plugin's own file names (LSP's does), else one named after the bundle, given in the manifest
  const stated = triples.find((t) => t.p.v === `${LV2}binary`)?.o.v;
  const binary = stated ? fileURLToPath(stated) : join(dir, `${name}.so`);
  writeFileSync(binary, '');
  const binaryLine = stated ? '' : ` lv2:binary <${name}.so> ;`;
  writeFileSync(join(dir, 'manifest.ttl'), `@prefix lv2: <${LV2}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
${uris.map((u) => `<${u}> a lv2:Plugin ;${binaryLine} rdfs:seeAlso ${files.map((f) => `<${f}>`).join(' , ')} .`).join('\n')}
${manifestExtra}`);
  return { dir, uris, files, binary };
}

/** A tree's files and links, each with its bytes' hash (a link with its target): to show a run never touched it. */
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = lstatSync(p);
      h.update(p);
      if (st.isSymbolicLink()) h.update(`-> ${readlinkSync(p)}`);
      else if (st.isDirectory()) walk(p);
      else h.update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

const key = (t) => (t.t === 'lit' ? `"${t.v}"${t.lang ? `@${t.lang}` : `^^${t.dt}`}` : t.t === 'bnode' ? `_:${t.v}` : `<${t.v}>`);
const triple = (t) => `${key(t.s)} ${key(t.p)} ${key(t.o)}`;

/** The written bundle's file `name` and the installed one, parsed as lilv reads them (each from where it lies). */
function both(installedDir, writtenDir, name) {
  const read = (dir) => parseTurtle(readFileSync(join(dir, name), 'utf8'), pathToFileURL(join(dir, name)).href);
  return { before: read(installedDir), after: read(writtenDir) };
}

function plan(dir, options) {
  return planBundle(/** @type {any} */ (readInstalledBundle(dir)), options);
}

/** Run the writer over `lv2` (the only search directory) into `out`. */
function run(lv2, out, extra = {}) {
  const lines = [];
  const r = sync({ lv2Path: `${out}:${lv2}`, outDir: out, stateDir: join(dirname(out), 'state'), log: (l) => lines.push(l), ...extra });
  return { ...r, lines };
}

describe('the Turtle reader keeps an absolute IRI as written', () => {
  it('a host in capitals and a bare authority are not rewritten; a relative reference is resolved', () => {
    const t = parseTurtle('<https://www.ElephantDSP.com/plugins/Room_Reverb> <http://example.org/p> <https://obxd.wordpress.com> , <#in> , <x.ttl> .', 'file:///b/x.lv2/m.ttl');
    assert.equal(t[0].s.v, 'https://www.ElephantDSP.com/plugins/Room_Reverb');
    assert.deepEqual(t.map((x) => x.o.v), ['https://obxd.wordpress.com', 'file:///b/x.lv2/m.ttl#in', 'file:///b/x.lv2/x.ttl']);
  });
});

describe('the written bundle restates the installed one exactly', () => {
  for (const [name, fixtures] of [['triple_para-swh', ['swh-triplepara']], ['lsp-plugins', ['lsp-graph-eq-x16']], ['mda', ['mda-rezfilter']], ['fil4', ['x42-fil4']], ['mod-caps-Eq4p', ['caps-eq4p']]]) {
    it(`${name}: every installed statement is in the written file, byte for byte; only the versions, seeAlso and groups differ`, () => {
      const root = scratch();
      const lv2 = join(root, 'lv2');
      const out = join(root, 'out');
      const { dir, files, uris, binary } = installed(lv2, name, fixtures);
      const r = run(lv2, out);
      assert.equal(r.counts.written, 1, r.lines.join('\n'));
      const written = join(out, outName(dir));
      const versionPreds = new Set([`${LV2}minorVersion`, `${LV2}microVersion`]);
      const ours = pathToFileURL(`${written}/`).href;
      const theirs = pathToFileURL(`${dir}/`).href;
      const groupPreds = new Set([RDF_TYPE, `${LV2}symbol`, `${LV2}name`, `${LV2}displayPriority`]);
      for (const f of ['manifest.ttl', ...files]) {
        const { before, after } = both(dir, written, f);
        // ours carries each blank node under its file's prefix (f<n>_<label>), and seeAlso names the restated file
        // beside it: map both back to what the installed file says
        const unprefix = (t) => (t.t === 'bnode' ? { t: 'bnode', v: t.v.replace(/^_f\d+_/, '') } : t);
        const back = (t) => ({ s: unprefix(t.s), p: t.p, o: t.p.v === SEE_ALSO && t.o.t === 'iri' ? { t: 'iri', v: t.o.v.replace(ours, theirs) } : unprefix(t.o) });
        const isVersion = (t) => t.s.t === 'iri' && uris.includes(t.s.v) && versionPreds.has(t.p.v);
        const installedSet = new Set(before.filter((t) => !isVersion(t)).map(triple));
        const writtenSet = new Set(after.filter((t) => !isVersion(t)).map((t) => triple(back(t))));
        // (a) every installed statement but the versions is written, its terms byte for byte
        for (const t of installedSet) assert.ok(writtenSet.has(t), `${f}: ${t} is restated`);
        // (b) what is added is only group statements: pg:group on a port, and on a group node its type, lv2:symbol,
        // lv2:name and lv2:displayPriority, each one the installed files did not already state for that node
        const groupNodes = new Set(after.filter((t) => t.p.v === `${PG}group`).map((t) => key(back(t).o)));
        for (const t of after.filter((x) => !isVersion(x) && !installedSet.has(triple(back(x))))) {
          const b = back(t);
          const ok = t.p.v === `${PG}group` || (groupNodes.has(key(b.s)) && groupPreds.has(t.p.v) && !before.some((x) => key(x.s) === key(b.s) && x.p.v === t.p.v));
          assert.ok(ok, `${f}: ${triple(b)} is a group statement`);
        }
      }
      // the lexical forms are the plugin's own: "+30", "0.0" and "1e-05" come back as written, never re-typed
      const text = readFileSync(join(written, files[0]), 'utf8');
      const literals = both(dir, written, files[0]).before.filter((t) => t.o.t === 'lit' && /^[+-]?[\d.]/.test(t.o.v) && !versionPreds.has(t.p.v)).map((t) => t.o.v);
      for (const v of new Set(literals)) assert.ok(text.includes(v), `${files[0]} holds the literal ${v} as written`);
      // lv2:binary is the installed library, reachable from the written bundle; every other installed file is linked in
      const m = parseTurtle(readFileSync(join(written, 'manifest.ttl'), 'utf8'), pathToFileURL(join(written, 'manifest.ttl')).href);
      const all = readdirSync(written).filter((x) => x.endsWith('.ttl')).flatMap((x) => parseTurtle(readFileSync(join(written, x), 'utf8'), pathToFileURL(join(written, x)).href));
      for (const u of uris) assert.deepEqual(all.filter((t) => t.s.v === u && t.p.v === `${LV2}binary`).map((t) => t.o.v), [pathToFileURL(binary).href]);
      assert.ok(m.length > 0);
      assert.equal(readlinkSync(join(written, binary.slice(dir.length + 1))), binary);
    });
  }

  it('the installed bundle is never written: its tree hashes the same before and after two runs', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara']);
    const before = treeHash(dir);
    run(join(root, 'lv2'), join(root, 'out'));
    run(join(root, 'lv2'), join(root, 'out'));
    assert.equal(treeHash(dir), before);
  });
});

describe('the version', () => {
  const versions = (written, uri) => {
    const m = parseTurtle(readFileSync(join(written, 'manifest.ttl'), 'utf8'), 'file:///x/');
    const all = readdirSync(written).filter((f) => f.endsWith('.ttl')).flatMap((f) => parseTurtle(readFileSync(join(written, f), 'utf8'), pathToFileURL(join(written, f)).href));
    const get = (p) => all.filter((t) => t.s.v === uri && t.p.v === `${LV2}${p}`).map((t) => t.o.v);
    assert.ok(m.some((t) => t.s.v === uri && t.p.v === `${LV2}microVersion`), 'the manifest states the version');
    return { minor: get('minorVersion'), micro: get('microVersion') };
  };
  for (const [name, fx, uri, want] of [
    ['mda', 'mda-rezfilter', 'http://drobilla.net/plugins/mda/RezFilter', { minor: ['2'], micro: ['1'] }],
    ['lsp-plugins', 'lsp-graph-eq-x16', 'http://lsp-plug.in/plugins/lv2/graph_equalizer_x16_stereo', { minor: ['0'], micro: ['36'] }],
    ['fil4', 'x42-fil4', 'http://gareus.org/oss/lv2/fil4#mono', { minor: ['2068'], micro: ['1'] }],
    ['triple_para-swh', 'swh-triplepara', 'http://plugin.org.uk/swh-plugins/triplePara', { minor: ['0'], micro: ['1'] }],
  ]) {
    it(`${uri}: lv2:minorVersion kept, lv2:microVersion one above the installed (${want.minor}.${want.micro}), each stated once`, () => {
      const root = scratch();
      const { dir } = installed(join(root, 'lv2'), name, [fx]);
      run(join(root, 'lv2'), join(root, 'out'));
      assert.deepEqual(versions(join(root, 'out', outName(dir)), uri), want);
    });
  }

  it('a plugin stating only lv2:minorVersion (lilv reads 0.0) keeps its minor and gets micro 1', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara'], { manifestExtra: '<http://plugin.org.uk/swh-plugins/triplePara> lv2:minorVersion 7 .\n' });
    const p = plan(dir);
    assert.deepEqual(p.plugins[0].version.installed, { minor: 0, micro: 0 });
    assert.deepEqual(p.plugins[0].version.next, { minor: 7, micro: 1 });
  });
});

describe('the groups', () => {
  it('triplePara: one group node per inferred group with lv2:symbol, lv2:name and lv2:displayPriority, and pg:group on each port by symbol', () => {
    const root = scratch();
    const { dir, uris } = installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara']);
    run(join(root, 'lv2'), join(root, 'out'));
    const written = join(root, 'out', outName(dir));
    const t = parseTurtle(readFileSync(join(written, 'plugin.ttl'), 'utf8'), pathToFileURL(join(written, 'plugin.ttl')).href);
    const one = (s, p) => t.filter((x) => x.s.v === s && x.p.v === p).map((x) => x.o.v);
    const ports = t.filter((x) => x.s.v === uris[0] && x.p.v === `${LV2}port`).map((x) => x.o.v);
    const groups = {};
    for (const port of ports) {
      const [g] = one(port, `${PG}group`);
      if (g === undefined) continue;
      groups[g] ??= { symbol: one(g, `${LV2}symbol`), name: one(g, `${LV2}name`), displayPriority: one(g, `${LV2}displayPriority`), type: one(g, RDF_TYPE), ports: [] };
      groups[g].ports.push(one(port, `${LV2}symbol`)[0]);
    }
    const triples = readInstalledBundle(dir);
    const verdict = inferGroups(readPluginPorts(pluginTriples(triples, uris[0]), uris[0]), readModguiLayout(pluginTriples(triples, uris[0]), uris[0]));
    assert.equal(verdict.outcome, 'grouped');
    assert.deepEqual(
      Object.values(groups).map((g) => [g.symbol[0], g.name[0], Number(g.displayPriority[0]), g.ports.join(' '), g.type[0]]),
      verdict.groups.map((g) => [g.symbol, g.name, g.displayPriority, g.ports.join(' '), `${PG}Group`]),
    );
    assert.deepEqual(Object.values(groups).map((g) => g.name[0]), ['Low', 'Band 1', 'Band 2', 'Band 3', 'High']);
  });

  it('a bundle of several plugins is restated whole: each plugin bumped, only the grouped one given groups (swh phasers)', () => {
    const root = scratch();
    const { dir, uris } = installed(join(root, 'lv2'), 'phasers-swh', ['swh-phasers']);
    assert.equal(uris.length, 3);
    const r = run(join(root, 'lv2'), join(root, 'out'));
    assert.equal(r.counts.written, 1);
    const written = join(root, 'out', outName(dir));
    const marker = readFileSync(join(written, MARKER), 'utf8');
    assert.match(marker, /^plugin http:\/\/plugin\.org\.uk\/swh-plugins\/fourByFourPole 0\.0 0\.1 grouped 4$/m);
    assert.match(marker, /^plugin http:\/\/plugin\.org\.uk\/swh-plugins\/autoPhaser 0\.0 0\.1 restated no-confident-grouping$/m);
    assert.match(marker, /^plugin http:\/\/plugin\.org\.uk\/swh-plugins\/lfoPhaser 0\.0 0\.1 restated nothing-to-do$/m);
    const t = parseTurtle(readFileSync(join(written, 'plugin.ttl'), 'utf8'), pathToFileURL(join(written, 'plugin.ttl')).href);
    const grouped = (u) => t.filter((x) => x.s.v === u && x.p.v === `${LV2}port`).some((x) => t.some((y) => y.s.v === x.o.v && y.p.v === `${PG}group`));
    assert.deepEqual(uris.map(grouped), uris.map((u) => u.endsWith('fourByFourPole')));
  });
});

describe('a generated group node never merges into a node already there', () => {
  // synthetic, ours (test/fixtures/lv2-complement): a nine-control equaliser that already states <#collide-band_1>,
  // the node the writer would generate for its first group; and two such plugins in one file whose URIs end alike
  const COMPLEMENT_FIXTURES = '../lv2-complement';

  it('a node the plugin already declares under the generated fragment (resolved as the reader does): refused, with the reason', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir, uris } = installed(lv2, 'collide', [`${COMPLEMENT_FIXTURES}/collision`]);
    const p = plan(dir);
    assert.equal(p.plugins[0].verdict.outcome, 'grouped', 'the rules group it: only the node stops it');
    assert.deepEqual(p.plugins[0].verdict.groups.map((g) => g.symbol), ['band_1', 'band_2', 'band_3']);
    const own = pathToFileURL(join(dir, 'plugin.ttl')).href;
    assert.ok(readInstalledBundle(dir).files.get('plugin.ttl').triples.some((t) => t.s.v === `${own}#collide-band_1`), 'the fixture states the node');
    assert.throws(() => renderBundle(p), (e) => e.reason === 'group-iri-collision' && e.message.includes(`${uris[0]}: group band_1's node <#collide-band_1>`));
    const r = run(lv2, out);
    assert.equal(r.counts.written, 0, r.lines.join('\n'));
    assert.equal(r.refusals['group-iri-collision'], 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /^refused .*collide\.lv2: group-iri-collision: .*<#collide-band_1> in plugin\.ttl is .*plugin\.ttl#collide-band_1, which the bundle already states/m);
    assert.deepEqual(existsSync(out) ? readdirSync(out) : [], []);
  });

  it('the same node written by the bundle itself (resolved against the written file) is a collision too', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    // the absolute IRI the generated <#collide-band_2> takes once written at its target
    const target = join(out, 'omx-complement-collide.lv2');
    const { dir } = installed(lv2, 'collide', [`${COMPLEMENT_FIXTURES}/collision`], {
      manifestExtra: `<${pathToFileURL(join(target, 'plugin.ttl')).href}#collide-band_2> <http://www.w3.org/2000/01/rdf-schema#comment> "ours, by accident" .\n`,
    });
    writeFileSync(join(dir, 'plugin.ttl'), readFileSync(join(dir, 'plugin.ttl'), 'utf8').replace(/^<#collide-band_1>/m, '<#unrelated>'));
    assert.doesNotThrow(() => renderBundle(plan(dir)), 'without the target, nothing resolves there');
    assert.throws(() => renderBundle(plan(dir), target), (e) => e.reason === 'group-iri-collision' && e.message.includes('<#collide-band_2>'));
  });

  it('two grouped plugins in one file whose nodes would be the same: refused, never one group node for both', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir, uris } = installed(lv2, 'twins', [`${COMPLEMENT_FIXTURES}/twins`]);
    assert.equal(uris.length, 2);
    const p = plan(dir);
    assert.ok(p.plugins.every((x) => x.verdict.outcome === 'grouped'));
    assert.throws(() => renderBundle(p), (e) => e.reason === 'group-iri-collision' && /<#twin-band_1> in plugin\.ttl is also http:\/\/example\.org\/omx-panel\/test\/a\/twin's/.test(e.message));
    const r = run(lv2, out);
    assert.deepEqual([r.counts.written, r.refusals['group-iri-collision']], [0, 1], r.lines.join('\n'));
  });

  it('a fragment the plugin does not use is written as before (the guard does not refuse what does not collide)', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'collide', [`${COMPLEMENT_FIXTURES}/collision`]);
    writeFileSync(join(dir, 'plugin.ttl'), readFileSync(join(dir, 'plugin.ttl'), 'utf8').replace(/^<#collide-band_1>/m, '<#collide-band_1-own>'));
    const r = run(join(root, 'lv2'), join(root, 'out'));
    assert.equal(r.counts.written, 1, r.lines.join('\n'));
  });
});

describe('the marker, and a second run', () => {
  it('names the installed bundle, the writer, the content hash, each plugin and each file', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'mda', ['mda-rezfilter']);
    const p = plan(dir);
    const text = markerText(p, 'w1');
    const lines = text.trimEnd().split('\n');
    assert.equal(lines[0], dir);
    assert.equal(lines[1], 'writer w1');
    assert.match(lines[2], /^source-sha256 [0-9a-f]{64}$/);
    assert.equal(lines[3], 'plugin http://drobilla.net/plugins/mda/RezFilter 2.0 2.1 grouped 5');
    assert.deepEqual(lines.slice(4).map((l) => l.split(' ').slice(0, 2).join(' ')), ['file RezFilter.ttl', 'file manifest.ttl']);
  });

  it('is idempotent: the second run writes nothing and the bundle is byte for byte the first; a changed source or writer rewrites', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir } = installed(lv2, 'triple_para-swh', ['swh-triplepara']);
    assert.equal(run(lv2, out).counts.written, 1);
    const first = treeHash(out);
    const again = run(lv2, out);
    assert.deepEqual([again.counts.written, again.counts.fresh], [0, 1]);
    assert.equal(treeHash(out), first);
    assert.equal(run(lv2, out, { writer: 'another writer' }).counts.written, 1, 'a changed writer rewrites');
    assert.equal(run(lv2, out).counts.written, 1, 'and back');
    assert.equal(treeHash(out), first, 'the same rules over the same files write the same bytes');
    writeFileSync(join(dir, 'plugin.ttl'), `${readFileSync(join(dir, 'plugin.ttl'), 'utf8')}\n# upgraded\n`);
    const upgraded = run(lv2, out);
    assert.deepEqual([upgraded.counts.written, upgraded.counts.replaced], [1, 1], 'a changed installed file rewrites');
    assert.match(upgraded.lines.join('\n'), new RegExp(`^replaced .*${outName(dir)} for .* \\(the installed files changed\\)`, 'm'));
  });

  it('a bundle of our name without our marker is never written', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir } = installed(lv2, 'triple_para-swh', ['swh-triplepara']);
    mkdirSync(join(out, outName(dir)), { recursive: true });
    writeFileSync(join(out, outName(dir), 'manifest.ttl'), '# someone else\'s\n');
    const r = run(lv2, out);
    assert.deepEqual([r.counts.written, r.counts.notOurs], [0, 1]);
    assert.equal(readFileSync(join(out, outName(dir), 'manifest.ttl'), 'utf8'), '# someone else\'s\n');
  });

  it('dry-run says what it would write and writes nothing', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara']);
    const r = run(join(root, 'lv2'), join(root, 'out'), { dryRun: true });
    assert.equal(r.counts.written, 1);
    assert.match(r.lines.join('\n'), new RegExp(`would write .*${outName(dir)}`));
    assert.ok(!existsSync(join(root, 'out', outName(dir))));
  });
});

describe('a bundle of ours no longer wanted is removed, and only ours', () => {
  /** A bundle of ours for `dir`, as an earlier run would have left it: the marker naming it, its content hash, a file. */
  const leftBehind = (out, dir, { hash = readInstalledBundle(dir)?.hash ?? 'gone' } = {}) => {
    const b = join(out, outName(dir));
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'manifest.ttl'), '# an earlier complement\n');
    writeFileSync(join(b, MARKER), `${dir}\nwriter an earlier writer\nsource-sha256 ${hash}\n`);
    return b;
  };

  it('its installed bundle is gone (the package removed): removed, the line naming it and why', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir } = installed(lv2, 'triple_para-swh', ['swh-triplepara']);
    assert.equal(run(lv2, out).counts.written, 1);
    rmSync(dir, { recursive: true });
    const r = run(lv2, out);
    assert.equal(r.counts.removed, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), new RegExp(`^removed .*${outName(dir)}: its installed bundle .*triple_para-swh\\.lv2 is gone`, 'm'));
    assert.ok(!existsSync(join(out, outName(dir))));
    assert.match(summary(r), /, 1 removed; /);
  });

  it('its installed bundle changed into one the writer refuses: removed, not left to replace the new one', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir } = installed(lv2, 'mda', ['mda-rezfilter']);
    assert.equal(run(lv2, out).counts.written, 1);
    writeFileSync(join(dir, 'RezFilter.ttl'), readFileSync(join(dir, 'RezFilter.ttl'), 'utf8').replace('lv2:microVersion 0 ;', 'lv2:microVersion "beta" ;'));
    const r = run(lv2, out);
    assert.deepEqual([r.counts.refused, r.counts.removed, r.counts.written], [1, 1, 0], r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /^removed .*omx-complement-mda\.lv2: .*mda\.lv2: it changed, and it is refused now \(version-unreadable: /m);
    assert.ok(!existsSync(join(out, outName(dir))));
  });

  it('its plugins no longer come out grouped on the current rules (same installed files): removed, and why', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir } = installed(lv2, 'omx-eq8', ['omx-eq8']);
    const b = leftBehind(out, dir);
    const r = run(lv2, out);
    assert.equal(r.counts.removed, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), new RegExp(`^removed ${b}: ${dir}: none of its plugins comes out grouped on the current rules$`, 'm'));
    assert.ok(!existsSync(b));
  });

  it('its installed bundle declares no plugin now (an upgrade emptied its manifest): removed, and why', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const dir = join(lv2, 'emptied.lv2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.ttl'), '@prefix lv2: <http://lv2plug.in/ns/lv2core#> .\n');
    const b = leftBehind(out, dir);
    const r = run(lv2, out);
    assert.equal(r.counts.removed, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), new RegExp(`^removed ${b}: ${dir}: it declares no plugin now$`, 'm'));
    assert.ok(!existsSync(b));
  });

  it('nothing without the marker is removed: an unmarked directory of our name, a marked one of another name, a link to a marked one', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    mkdirSync(out, { recursive: true });
    const { dir } = installed(lv2, 'omx-eq8', ['omx-eq8']);
    const unmarked = join(out, 'omx-complement-someone.lv2');
    mkdirSync(unmarked);
    writeFileSync(join(unmarked, 'manifest.ttl'), '# someone else\'s\n');
    const otherName = join(out, 'someone-else.lv2');
    mkdirSync(otherName);
    writeFileSync(join(otherName, MARKER), `${dir}\n`);
    const noSuffix = join(out, 'omx-complement-foo');
    mkdirSync(noSuffix);
    writeFileSync(join(noSuffix, MARKER), `${dir}\n`);
    const elsewhere = leftBehind(join(root, 'elsewhere'), dir);
    symlinkSync(elsewhere, join(out, 'omx-complement-linked.lv2'));
    const before = treeHash(out);
    const r = run(lv2, out);
    assert.equal(r.counts.removed, 0, r.lines.join('\n'));
    assert.equal(treeHash(out), before);
    assert.ok(existsSync(join(elsewhere, MARKER)));
    assert.ok(existsSync(join(noSuffix, MARKER)), 'a marked omx-complement-foo (no .lv2) is not a bundle of ours');
  });

  it('--dry-run says what it would remove and removes nothing; --only removes only what was written for the bundles named', () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const eq8 = installed(lv2, 'omx-eq8', ['omx-eq8']).dir;
    const comp = installed(lv2, 'omx-comp', ['omx-comp']).dir;
    const b8 = leftBehind(out, eq8);
    const bc = leftBehind(out, comp);
    const dry = run(lv2, out, { dryRun: true });
    assert.equal(dry.counts.removed, 2);
    assert.match(dry.lines.join('\n'), new RegExp(`^would remove ${b8}: `, 'm'));
    assert.match(summary(dry, true), /, 2 would be removed; /);
    assert.ok(existsSync(b8) && existsSync(bc));
    const one = run(lv2, out, { only: [comp] });
    assert.equal(one.counts.removed, 1);
    assert.ok(existsSync(b8) && !existsSync(bc));
  });
});

describe('nothing is written for a plugin that needs no groups', () => {
  for (const [name, fx, outcome] of [['omx-eq8', 'omx-eq8', 'nothing-to-do'], ['omx-comp', 'omx-comp', 'nothing-to-do'], ['x42-matrixmixer', 'x42-matrixmixer', 'nothing-to-do'], ['calf-compressor', 'calf-compressor', 'no-confident-grouping'], ['swh-gate', 'swh-gate', 'no-confident-grouping'], ['juced-drumsynth', 'juced-drumsynth', 'no-confident-grouping']]) {
    it(`${fx}: ${outcome}, no bundle, no marker`, () => {
      const root = scratch();
      const { dir } = installed(join(root, 'lv2'), name, [fx]);
      const p = plan(dir);
      assert.ok(p.plugins.every((x) => x.verdict.outcome === outcome));
      assert.equal(p.write, false);
      assert.throws(() => renderBundle(p), /nothing to write/);
      const r = run(join(root, 'lv2'), join(root, 'out'));
      assert.equal(r.counts.written, 0);
      assert.deepEqual(existsSync(join(root, 'out')) ? readdirSync(join(root, 'out')) : [], []);
    });
  }
});

describe('the degenerate cases are refused with a reason and never written', () => {
  const refused = (r, reason) => {
    assert.equal(r.counts.written, 0, r.lines.join('\n'));
    assert.equal(r.refusals[reason], 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), new RegExp(`refused .*: ${reason}: `));
  };
  const empty = (out) => assert.deepEqual(existsSync(out) ? readdirSync(out) : [], []);

  it('TTL the reader cannot parse', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara']);
    writeFileSync(join(dir, 'plugin.ttl'), `${readFileSync(join(dir, 'plugin.ttl'), 'utf8')}\n<a> <b> "unterminated .\n`);
    const r = run(join(root, 'lv2'), join(root, 'out'));
    refused(r, 'ttl-unreadable');
    empty(join(root, 'out'));
  });

  it(`a version at lilv's ceiling (${VERSION_CEILING}): raising it would overflow`, () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'mda', ['mda-rezfilter']);
    writeFileSync(join(dir, 'RezFilter.ttl'), readFileSync(join(dir, 'RezFilter.ttl'), 'utf8').replace('lv2:microVersion 0 ;', `lv2:microVersion ${VERSION_CEILING} ;`));
    refused(run(join(root, 'lv2'), join(root, 'out')), 'version-ceiling');
    empty(join(root, 'out'));
  });

  it('a version that is not an integer', () => {
    const root = scratch();
    const { dir } = installed(join(root, 'lv2'), 'mda', ['mda-rezfilter']);
    writeFileSync(join(dir, 'RezFilter.ttl'), readFileSync(join(dir, 'RezFilter.ttl'), 'utf8').replace('lv2:microVersion 0 ;', 'lv2:microVersion "beta" ;'));
    refused(run(join(root, 'lv2'), join(root, 'out')), 'version-unreadable');
  });

  it('more than one subject for the URI: two versions stated', () => {
    const root = scratch();
    installed(join(root, 'lv2'), 'mda', ['mda-rezfilter'], { manifestExtra: '<http://drobilla.net/plugins/mda/RezFilter> lv2:microVersion 3 .\n' });
    refused(run(join(root, 'lv2'), join(root, 'out')), 'version-ambiguous');
    empty(join(root, 'out'));
  });

  it('more than one subject for the URI: the plugin declared by two installed bundles', () => {
    const root = scratch();
    installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara']);
    installed(join(root, 'lv2'), 'triple_para-copy', ['swh-triplepara']);
    const r = run(join(root, 'lv2'), join(root, 'out'));
    assert.equal(r.refusals['plugin-in-several-bundles'], 2);
    assert.equal(r.counts.written, 0);
    empty(join(root, 'out'));
  });

  it('two installed bundles whose complements would have one name (same basename, two roots, different plugins): both refused, never rewritten in turn', () => {
    const root = scratch();
    const lv2a = join(root, 'usr-lib-lv2');
    const lv2b = join(root, 'usr-local-lib-lv2');
    const out = join(root, 'out');
    const a = installed(lv2a, 'same', ['swh-triplepara']);
    const b = installed(lv2b, 'same', ['mda-rezfilter']);
    assert.equal(outName(a.dir), outName(b.dir));
    assert.notDeepEqual(a.uris, b.uris, 'different plugins: plugin-in-several-bundles does not see it');
    const go = () => {
      const lines = [];
      const r = sync({ lv2Path: `${out}:${lv2a}:${lv2b}`, outDir: out, stateDir: join(root, 'state'), log: (l) => lines.push(l) });
      return { ...r, lines };
    };
    // a complement written for one of them by an earlier writer: removed once both are refused
    mkdirSync(join(out, outName(a.dir)), { recursive: true });
    writeFileSync(join(out, outName(a.dir), MARKER), `${a.dir}\nwriter an earlier writer\nsource-sha256 x\n`);
    const first = go();
    assert.deepEqual([first.counts.written, first.refusals['out-name-collision'], first.counts.removed], [0, 2, 1], first.lines.join('\n'));
    assert.match(first.lines.join('\n'), /^refused .*usr-lib-lv2\/same\.lv2: out-name-collision: .* would both be complemented as omx-complement-same\.lv2$/m);
    const second = go();
    assert.deepEqual([second.counts.written, second.counts.replaced, second.counts.removed, second.refusals['out-name-collision']], [0, 0, 0, 2], second.lines.join('\n'));
    assert.deepEqual(readdirSync(out), []);
  });

  it('a dynamic manifest', () => {
    const root = scratch();
    installed(join(root, 'lv2'), 'triple_para-swh', ['swh-triplepara'], { manifestExtra: '<dyn> a <http://lv2plug.in/ns/ext/dynmanifest#DynManifest> .\n' });
    refused(run(join(root, 'lv2'), join(root, 'out')), 'dynamic-manifest');
  });
});

describe('lilv loads the written bundle in place of the installed one, and the installed one once it is deleted', () => {
  const lilvRead = (lv2Path, uris) => {
    const script = `
import json, sys, lilv
w = lilv.World(); w.load_all()
n = lambda u: w.new_uri(u)
out = {"all": sorted(str(p.get_uri()) for p in w.get_all_plugins())}
for uri in sys.argv[1:]:
    p = w.get_all_plugins()[n(uri)]
    v = lambda pred: w.get(p.get_uri(), n("${LV2}" + pred), None)
    groups = {}
    for i in range(p.get_num_ports()):
        port = p.get_port_by_index(i)
        g = port.get(n("${PG}group"))
        if g is not None:
            groups.setdefault(str(w.get(g, n("${LV2}symbol"), None)), []).append(str(port.get_symbol()))
    out[uri] = {"bundle": str(p.get_bundle_uri()), "version": "%s.%s" % (v("minorVersion"), v("microVersion")), "groups": groups}
print(json.dumps(out))
`;
    const r = spawnSync('python3', ['-I', '-c', script, ...uris], { encoding: 'utf8', env: { ...process.env, LV2_PATH: lv2Path } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  it('a bundle of three plugins (Calf): ours wins with the bumped version and its groups; deleted, the installed one loads again', { skip: noLilv }, () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const { dir, uris } = installed(lv2, 'calf', ['calf-compressor', 'calf-xover4band', 'calf-multichorus']);
    const xover = 'http://calf.sourceforge.net/plugins/XOver4Band';
    const verdict = plan(dir).plugins.find((p) => p.uri === xover).verdict;
    assert.equal(verdict.groups.length, 5);
    const before = lilvRead(`${out}:${lv2}`, uris);
    assert.equal(run(lv2, out).counts.written, 1);
    for (const path of [`${out}:${lv2}`, `${lv2}:${out}`]) {
      const after = lilvRead(path, uris);
      assert.deepEqual(after.all, before.all, `${path}: no plugin lost or added`);
      for (const u of uris) {
        assert.equal(after[u].bundle, pathToFileURL(`${join(out, outName(dir))}/`).href, `${u} loads from ours`);
        assert.equal(after[u].version, '0.1');
      }
      // the five inferred groups, each port by symbol (Calf's own groups on its audio ports stay as they were)
      for (const g of verdict.groups) assert.deepEqual(after[xover].groups[g.symbol], g.ports, g.symbol);
      // the plugins with no grouping keep exactly the groups they had (Calf's on their audio ports)
      for (const u of uris.filter((x) => x !== xover)) assert.deepEqual(after[u].groups, before[u].groups, u);
    }
    rmSync(join(out, outName(dir)), { recursive: true });
    const restored = lilvRead(`${out}:${lv2}`, uris);
    for (const u of uris) assert.equal(restored[u].bundle, pathToFileURL(`${dir}/`).href);
    assert.deepEqual(restored, before);
  });

  it('a stale bundle is removed by the sync: lilv loads the installed one again (changed), or lists the plugin no more (gone)', { skip: noLilv }, () => {
    const root = scratch();
    const lv2 = join(root, 'lv2');
    const out = join(root, 'out');
    const path = `${out}:${lv2}`;
    const mda = installed(lv2, 'mda', ['mda-rezfilter']);
    const swh = installed(lv2, 'triple_para-swh', ['swh-triplepara']);
    const [rez] = mda.uris;
    const [para] = swh.uris;
    const original = lilvRead(path, [rez])[rez];
    assert.equal(run(lv2, out).counts.written, 2);
    assert.equal(lilvRead(path, [rez])[rez].bundle, pathToFileURL(`${join(out, outName(mda.dir))}/`).href);
    // an upgrade the writer refuses (lilv reads the version "beta" as 0): until the sync, ours (2.1) still wins
    writeFileSync(join(mda.dir, 'RezFilter.ttl'), readFileSync(join(mda.dir, 'RezFilter.ttl'), 'utf8').replace('lv2:microVersion 0 ;', 'lv2:microVersion "beta" ;'));
    assert.equal(lilvRead(path, [rez])[rez].version, '2.1', 'the stale bundle replaces the upgraded one');
    // the package removed: ours still declares the plugin
    rmSync(swh.dir, { recursive: true });
    assert.ok(lilvRead(path, []).all.includes(para), 'the stale bundle keeps a removed plugin listed');
    const r = run(lv2, out);
    assert.equal(r.counts.removed, 2, r.lines.join('\n'));
    const after = lilvRead(path, [rez]);
    assert.equal(after[rez].bundle, pathToFileURL(`${mda.dir}/`).href, 'the installed bundle loads again');
    assert.deepEqual(after[rez].groups, original.groups, 'with the groups it states itself, none of ours');
    assert.ok(!after.all.includes(para), 'the removed plugin is gone from lilv');
  });
});

describe('omx-complement-sync, the installed-side entry', () => {
  const SYNC = join(ROOT, 'bin/omx-complement-sync');
  const rig = () => {
    const root = scratch();
    const r = { lv2: join(root, 'lv2'), out: join(root, 'modgui'), state: join(root, 'state'), bin: join(root, 'bin') };
    mkdirSync(r.bin, { recursive: true });
    symlinkSync(join(ROOT, 'dist/bin/omx-panel.mjs'), join(r.bin, 'omx-panel'));
    r.run = (args = []) => spawnSync(SYNC, args, {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${r.bin}:${process.env.PATH}`, LV2_PATH: `${r.lv2}:${r.out}`, MODGUI_DIR: r.out, STATE_DIR: r.state },
    });
    return r;
  };

  it('writes in MODGUI_DIR, says so, and a second run finds it up to date; --dry-run and --verbose', () => {
    const r = rig();
    const { dir } = installed(r.lv2, 'triple_para-swh', ['swh-triplepara']);
    installed(r.lv2, 'omx-eq8', ['omx-eq8']);
    const dry = r.run(['--dry-run', '--verbose']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^omx-complement-sync: plugin urn:openmixer:eq8: nothing-to-do own-groups-complete$/m);
    assert.match(dry.stdout, /^omx-complement-sync: would write .*omx-complement-triple_para-swh\.lv2 for /m);
    assert.ok(!existsSync(join(r.out, outName(dir))));
    const first = r.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^omx-complement-sync: 1 written, 0 up to date, 0 refused/m);
    assert.ok(existsSync(join(r.out, outName(dir), MARKER)));
    const again = r.run();
    assert.match(again.stdout, /^omx-complement-sync: 0 written, 1 up to date, 0 refused/m);
  });

  it('--check exits 3 naming each stale or out-of-date bundle of ours, 0 when there is none; it changes nothing', () => {
    const r = rig();
    const { dir } = installed(r.lv2, 'triple_para-swh', ['swh-triplepara']);
    const missing = r.run(['--check']);
    assert.equal(missing.status, 0, 'a bundle not written yet is not stale');
    assert.match(missing.stdout, /^omx-complement-sync: missing .*omx-complement-triple_para-swh\.lv2 for /m);
    assert.ok(!existsSync(r.out) || readdirSync(r.out).length === 0);
    assert.equal(r.run().status, 0);
    const clean = r.run(['--check']);
    assert.equal(clean.status, 0, clean.stdout);
    assert.match(clean.stdout, /^omx-complement-sync: no bundle of ours is stale$/m);
    writeFileSync(join(dir, 'plugin.ttl'), `${readFileSync(join(dir, 'plugin.ttl'), 'utf8')}\n# upgraded\n`);
    const outOfDate = r.run(['--check']);
    assert.equal(outOfDate.status, 3, outOfDate.stdout);
    assert.match(outOfDate.stdout, /^omx-complement-sync: out of date .*omx-complement-triple_para-swh\.lv2: the installed files changed; the sync writes it again$/m);
    rmSync(dir, { recursive: true });
    const before = treeHash(r.out);
    const stale = r.run(['--check']);
    assert.equal(stale.status, 3, stale.stdout);
    assert.match(stale.stdout, /^omx-complement-sync: stale .*omx-complement-triple_para-swh\.lv2: its installed bundle .* is gone, or no longer on the search list; the sync removes it$/m);
    assert.match(stale.stdout, /^omx-complement-sync: 1 bundle\(s\) of ours stale or out of date: 1 to remove, 0 to write again$/m);
    assert.equal(treeHash(r.out), before, '--check removes nothing');
    const sync = r.run();
    assert.equal(sync.status, 0);
    assert.match(sync.stdout, /^omx-complement-sync: removed .*omx-complement-triple_para-swh\.lv2: /m);
    assert.equal(r.run(['--check']).status, 0);
  });

  it('--check names the search list and whether MODGUI_DIR is on it; a bad flag is a usage error', () => {
    const r = rig();
    const check = r.run(['--check']);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /Complement bundles go to .*: it is on that list/);
    assert.equal(r.run(['--bogus']).status, 2);
  });
});
