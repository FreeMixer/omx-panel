// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The film strips are omx-panel's alone: every bundle's knob and fader strip is the same render of the look, so a
// consumer's committed tree leaves them out (`--no-films`, and `--check` then names a returning copy EXTRA) and its
// build writes them into the built bundle (`--films-only`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadLook, renderFaderFilm, renderFilm } from '../tools/modgui-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/omx-delay');
const SOURCE = 'plugins/omx-delay/omx-delay.decl.json (its panel block) and tools/look.json';
const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'tools/modgui-gen.mjs'), ...args], { encoding: 'utf8' });
const args = (out, panel = join(FIX, 'omx-delay.panel.json')) =>
  ['--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', panel, '--out', out, '--stem', 'omx-delay', '--source', SOURCE];
const KNOB = 'modgui/knobs/omx-knob.png';
const FADER = 'modgui/knobs/omx-fader.png';
const bundle = () => {
  const out = join(mkdtempSync(join(tmpdir(), 'films-')), 'omx-delay.lv2');
  cpSync(join(FIX, 'omx-delay.lv2'), out, { recursive: true });
  return out;
};

test('the committed omx-delay bundle carries no film strip and is fresh under --no-films', () => {
  assert.equal(existsSync(join(FIX, 'omx-delay.lv2', KNOB)), false);
  const r = cli('--check', '--no-films', ...args(join(FIX, 'omx-delay.lv2')));
  assert.equal(r.status, 0, r.stderr);
});

test('--no-films --check names a film strip that came back as EXTRA', () => {
  const out = bundle();
  mkdirSync(join(out, 'modgui/knobs'), { recursive: true });
  writeFileSync(join(out, KNOB), renderFilm(loadLook().tokens));
  const r = cli('--check', '--no-films', ...args(out));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /EXTRA .*omx-knob\.png/);
});

test('--films-only writes the knob strip, the render of the look, and touches nothing else', () => {
  const out = bundle();
  const css = join(out, 'modgui/stylesheet-omx-delay.css');
  const original = readFileSync(css);
  writeFileSync(css, 'a marker only --films-only leaves in place');
  const r = cli('--films-only', ...args(out));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(join(out, KNOB)).equals(renderFilm(loadLook().tokens)));
  assert.equal(existsSync(join(out, FADER)), false, 'no fader drawn, no fader strip');
  assert.equal(readFileSync(css, 'utf8'), 'a marker only --films-only leaves in place');
  writeFileSync(css, original);
  assert.equal(cli('--check', ...args(out)).status, 0, 'the built bundle is the whole generator output');
});

test('--films-only writes the fader strip when the panel draws a fader', () => {
  const out = bundle();
  const panelFile = join(dirname(out), 'panel.json');
  const panel = JSON.parse(readFileSync(join(FIX, 'omx-delay.panel.json'), 'utf8'));
  writeFileSync(panelFile, JSON.stringify({ ...panel, widgets: { mix: 'fader' } }));
  assert.equal(cli('--films-only', ...args(out, panelFile)).status, 0);
  assert.ok(readFileSync(join(out, FADER)).equals(renderFaderFilm(loadLook().tokens)));
});

test('--no-films and --films-only together are a usage error', () => {
  assert.equal(cli('--no-films', '--films-only', ...args(bundle())).status, 2);
});
