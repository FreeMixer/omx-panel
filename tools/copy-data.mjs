#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * copy-data.mjs — the second half of the build. tsc (allowJs) emits src/ as JavaScript and every module's
 * declarations; it also reprints the .mjs modules, so they are put back into dist/ as the tree holds them, byte for
 * byte. The files tsc does not emit go in beside the modules that read them, at the same relative paths (the
 * schemas, the look, the modgui terms, the test script), and the commands keep their execute bit. `npm run build`
 * runs it after tsc.
 */
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** The tree's own checks, which the package does not carry. */
const NOT_SHIPPED = ['tools/copy-data.mjs', 'tools/check-spdx.mjs', 'tools/check-public-sources.mjs'];
/** Every .mjs module the package carries, as the tree holds it. */
export const MODULES = ['bin', 'lib', 'tools'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.mjs')).map((f) => `${d}/${f}`)).filter((f) => !NOT_SHIPPED.includes(f));
/** Every file dist/ carries that is not a module. */
export const DATA = ['schema/skin-package.schema.json', 'schema/panel.schema.json', 'tools/look.json', 'tools/look/tokens.css', 'tools/fonts/Inter-Regular.ttf', 'tools/fonts/Inter-LICENSE.txt', 'tools/modgui-terms.ttl', 'tools/modgui-test.sh'];
/** The files dist/ runs as commands. */
export const COMMANDS = ['bin/omx-panel.mjs', 'tools/modgui-gen.mjs', 'tools/look.mjs', 'tools/lv2-complement.mjs', 'tools/modgui-test.sh'];

for (const f of [...MODULES, ...DATA]) {
  mkdirSync(dirname(join(DIST, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(DIST, f));
}
for (const f of COMMANDS) chmodSync(join(DIST, f), 0o755);
// tsc copies a command's shebang into its declaration; a declaration never runs, so it carries none.
for (const f of COMMANDS.filter((c) => c.endsWith('.mjs'))) {
  const d = join(DIST, f.replace(/\.mjs$/, '.d.mts'));
  const text = readFileSync(d, 'utf8');
  if (text.startsWith('#!')) writeFileSync(d, text.slice(text.indexOf('\n') + 1));
}
console.log(`copy-data: ${MODULES.length} modules and ${DATA.length} data files into dist/ as the tree holds them, ${COMMANDS.length} commands executable`);
