#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx-panel <verb> ...
 *
 *   validate <skin.json | skin package directory>...     a skin against the schema; exit 0 valid, 1 not, 2 usage or read
 *   layout --descriptor <file> [--panel <file>] [--ns <label-key namespace>] [--canonical | --pages [--per-page N] [--easy-first]]
 *                                                        the panel laid out from a descriptor, as JSON (or its canonical
 *                                                        serialisation, or its pages of eight, the Easy ones first)
 *   compare switch|copy --to <A..D>, compare undo|redo   tools/compare.mjs over stdin and stdout: { doc, ring, captures, values }
 *                                                        in, { doc, ring, moves, unknown } out
 *   modgui ...                                           tools/modgui-gen.mjs: a plugin's MOD GUI from its descriptor
 *   import <bundle.lv2> --out <skins dir> [--plugin <uri>]  tools/modgui-import.mjs: a MOD GUI bundle into a skin package
 *   complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose]
 *                                                        tools/lv2-complement.mjs: a replacing LV2 bundle with the inferred
 *                                                        port groups, for each installed bundle that needs one
 *   look [--check]                                       tools/look.mjs: tools/look.json from the token cascade
 *   vocabulary [<package>/<name>]...                     where each installed source is read from, read: the contract
 *                                                        directories, the meanings, the LV2 unit table, the param-contract
 *                                                        unit table and each descriptor named; exit 1 when one is missing
 *   descriptors --installed                              each installed plugin descriptor file, one path per line
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkin } from '../lib/validate.mjs';

// A reader that stops early (head, grep -q) closes the pipe: stop writing and exit 0, as a filter does (#42).
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, '..', 'tools');
const USAGE = 'usage: omx-panel validate <skin.json | skin package directory>...\n'
  + '       omx-panel layout --descriptor <file> [--panel <file>] [--ns <namespace>] [--canonical | --pages [--per-page N] [--easy-first]]\n'
  + '       omx-panel compare (switch | copy) --to <A..D> | undo | redo   (JSON on stdin and stdout)\n'
  + '       omx-panel modgui (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--easy-first] [--check]\n'
  + '       omx-panel import <bundle.lv2> --out <skins dir> [--plugin <uri>]\n'
  + '       omx-panel complement --out <dir> [--lv2-path <list>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose]\n'
  + '       omx-panel look [--check]\n'
  + '       omx-panel vocabulary [<package>/<name>]...\n'
  + '       omx-panel descriptors --installed\n'
  + '       omx-panel --version\n';

const [command, ...args] = process.argv.slice(2);

/** package.json sits beside bin/ in the tree and the installed package, and two up from dist/bin in the npm one. */
const packageVersion = () => JSON.parse(readFileSync(['..', '../..'].map((up) => join(HERE, up, 'package.json')).find(existsSync), 'utf8')).version;

/** A verb that is a tool of its own: run it with the same node, its exit status this command's. */
const tool = (file) => process.exit(spawnSync(process.execPath, [join(TOOLS, file), ...args], { stdio: 'inherit' }).status ?? 1);

function validate(targets) {
  if (targets.length === 0) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  let failed = 0;
  for (const target of targets) {
    let file = target;
    try {
      if (statSync(target).isDirectory()) file = join(target, 'skin.json');
      const result = validateSkin(JSON.parse(readFileSync(file, 'utf8')));
      if (result.ok) {
        process.stdout.write(`ok   ${file}\n`);
      } else {
        failed++;
        for (const e of result.errors) process.stdout.write(`FAIL ${file} ${e.code} ${e.path} ${e.message}\n`);
      }
    } catch (err) {
      process.stderr.write(`omx-panel: ${file}: ${err.message}\n`);
      process.exit(2);
    }
  }
  process.exit(failed ? 1 : 0);
}

async function layout(argv) {
  const opt = (flag) => {
    const k = argv.indexOf(flag);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const file = opt('--descriptor');
  if (!file) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { panelLayout, panelCanonical, pagesOf } = await import(join(TOOLS, 'panel-description.mjs'));
  let x;
  try {
    const descriptor = JSON.parse(readFileSync(file, 'utf8'));
    const panel = opt('--panel') ? JSON.parse(readFileSync(opt('--panel'), 'utf8')) : undefined;
    if (descriptor.easy === undefined && descriptor.origin === 'scanned' && argv.includes('--easy-first')) {
      const { easyFromInstalled } = await import(join(TOOLS, 'easy-installed.mjs'));
      const { installedDescriptorFiles } = await import(join(TOOLS, 'vocabulary.mjs'));
      const easy = easyFromInstalled(descriptor, installedDescriptorFiles().map((f) => JSON.parse(readFileSync(f, 'utf8'))));
      if (easy) descriptor.easy = easy;
    }
    x = panelLayout(descriptor, { panel, ns: opt('--ns'), where: file });
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${err.code}: ` : ''}${err.message}\n`);
    process.exit(1);
  }
  if (argv.includes('--canonical')) process.stdout.write(panelCanonical(x));
  else if (argv.includes('--pages')) {
    const raw = opt('--per-page');
    const perPage = raw === undefined ? undefined : /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    try {
      process.stdout.write(`${JSON.stringify(pagesOf(x, { perPage, easyFirst: argv.includes('--easy-first') }), null, 2)}\n`);
    } catch (err) {
      process.stderr.write(`omx-panel: ${err.message}\n`);
      process.exit(2);
    }
  }
  else process.stdout.write(`${JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v), 2)}\n`);
}

/** One step of Compare for a host that is not JavaScript (docs/compare.md): JSON in, JSON out, no state between runs. */
async function compare(argv) {
  const m = await import(join(TOOLS, 'compare.mjs'));
  const op = argv[0];
  if (!['switch', 'copy', 'undo', 'redo'].includes(op)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const k = argv.indexOf('--to');
  const to = k >= 0 ? argv[k + 1] : undefined;
  try {
    const { doc, ring, captures = [], values = {} } = JSON.parse(readFileSync(0, 'utf8'));
    const queued = captures.reduce(m.capture, ring ?? m.emptyRing());
    const out =
      op === 'switch' ? m.switchTo(doc ?? m.emptyCompare(), values, to)
      : op === 'copy' ? m.copyTo(doc ?? m.emptyCompare(), values, to)
      : m[op](queued, values);
    process.stdout.write(`${JSON.stringify({ ring: queued, ...out })}\n`);
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.code ? `${err.code}: ` : ''}${err.message}\n`);
    process.exit(1);
  }
}

/** Each source the layout and the MOD GUI read, read where it is installed: one line each, `ok` or `FAIL`. */
async function vocabulary(refs) {
  const v = await import(join(TOOLS, 'vocabulary.mjs'));
  let failed = 0;
  const line = (what, read) => {
    try {
      process.stdout.write(`ok   ${what} ${read()}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`FAIL ${what} ${err.message}\n`);
    }
  };
  line('contractdir', () => v.contractDirs().join(':'));
  line('meanings', () => `${v.meanings().length} from ${v.contractSchemaFile()}`);
  line('lv2-units', () => `${Object.keys(v.lv2UnitTable()).length} from ${v.lv2TableFile()}`);
  line('param-contract', () => `${v.paramUnits().size} units from ${v.paramUnitsFile()}`);
  for (const ref of refs) {
    line(`descriptor ${ref}`, () => {
      const file = v.installedDescriptorFile(ref);
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(d.controls)) throw new Error(`${file} has no controls`);
      return `${d.controls.length} controls from ${file}`;
    });
  }
  process.exit(failed ? 1 : 0);
}

/** The installed descriptor files, one path per line: the contract directories read for whatever majors they hold. */
async function descriptors(argv) {
  if (argv.length !== 1 || argv[0] !== '--installed') {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const { installedDescriptorFiles } = await import(join(TOOLS, 'vocabulary.mjs'));
  for (const file of installedDescriptorFiles()) process.stdout.write(`${file}\n`);
}

if (command === 'validate') validate(args);
else if (command === 'layout') await layout(args);
else if (command === 'compare') await compare(args);
else if (command === 'modgui') tool('modgui-gen.mjs');
else if (command === 'import') tool('modgui-import.mjs');
else if (command === 'complement') tool('lv2-complement.mjs');
else if (command === 'look') tool('look.mjs');
else if (command === 'vocabulary') await vocabulary(args);
else if (command === 'descriptors') await descriptors(args);
else if (command === '--version') process.stdout.write(`omx-panel ${packageVersion()}\n`);
else {
  process.stderr.write(USAGE);
  process.exit(2);
}
