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
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkin } from '../lib/validate.mjs';

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const USAGE = 'usage: omx-panel validate <skin.json | skin package directory>...\n'
  + '       omx-panel layout --descriptor <file> [--panel <file>] [--ns <namespace>] [--canonical | --pages]\n'
  + '       omx-panel modgui (--descriptor <file> | --installed <package>/<name>) [--panel <file>] --out <bundle.lv2> [--check]\n'
  + '       omx-panel import <bundle.lv2> --out <skins dir> [--plugin <uri>]\n'
  + '       omx-panel look [--check]\n';

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

if (command === 'validate') validate(args);
else if (command === 'layout') await layout(args);
else if (command === 'modgui') tool('modgui-gen.mjs');
else if (command === 'import') tool('modgui-import.mjs');
else if (command === 'look') tool('look.mjs');
else {
  process.stderr.write(USAGE);
  process.exit(2);
}
