#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx-panel <verb> ...
 *
 *   validate <skin.json | skin package directory>...     a skin against the schema; exit 0 valid, 1 not, 2 usage or read
 *   layout --descriptor <file> [--panel <file>] [--ns <label-key namespace>] [--canonical | --pages]
 *                                                        the panel laid out from a descriptor, as JSON (or its canonical
 *                                                        serialisation, or its pages of eight)
 *   modgui ...                                           tools/modgui-gen.mjs: a plugin's MOD GUI from its descriptor
 *   import <bundle.lv2> --out <skins dir> [--plugin <uri>]  tools/modgui-import.mjs: a MOD GUI bundle into a skin package
 *   look [--check]                                       tools/look.mjs: tools/look.json from the token cascade
 *   vocabulary [<package>/<name>]...                     where each installed source is read from, read: the contract
 *                                                        directories, the meanings, the LV2 unit table, the param-contract
 *                                                        header and each descriptor named; exit 1 when one is missing
 *   descriptors --installed                              each installed plugin descriptor file, one path per line
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkin } from '../lib/validate.mjs';

// A reader that stops early (head, grep -q) closes the pipe: stop writing and exit 0, as a filter does (#42).
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const USAGE = 'usage: omx-panel validate <skin.json | skin package directory>...\n'
  + '       omx-panel layout --descriptor <file> [--panel <file>] [--ns <namespace>] [--canonical | --pages]\n'
  + '       omx-panel modgui (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--check]\n'
  + '       omx-panel import <bundle.lv2> --out <skins dir> [--plugin <uri>]\n'
  + '       omx-panel look [--check]\n'
  + '       omx-panel vocabulary [<package>/<name>]...\n'
  + '       omx-panel descriptors --installed\n';

const [command, ...args] = process.argv.slice(2);

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
    x = panelLayout(descriptor, { panel, ns: opt('--ns'), where: file });
  } catch (err) {
    process.stderr.write(`omx-panel: ${err.message}\n`);
    process.exit(1);
  }
  if (argv.includes('--canonical')) process.stdout.write(panelCanonical(x));
  else if (argv.includes('--pages')) process.stdout.write(`${JSON.stringify(pagesOf(x), null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v), 2)}\n`);
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
  line('param-contract', () => `${v.headerUnits().size} units from ${v.paramContractHeader()}`);
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
else if (command === 'modgui') tool('modgui-gen.mjs');
else if (command === 'import') tool('modgui-import.mjs');
else if (command === 'look') tool('look.mjs');
else if (command === 'vocabulary') await vocabulary(args);
else if (command === 'descriptors') await descriptors(args);
else {
  process.stderr.write(USAGE);
  process.exit(2);
}
