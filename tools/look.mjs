#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * look.mjs — tools/look.json, the plain values the MOD GUI wears (tools/modgui-gen.mjs), resolved
 * from the token cascade tools/look/tokens.css at the look LOOK names: every rule whose selector the
 * root element matches at those axes, the most specific winning and, at equal specificity, the
 * later; then every var() followed to its value. Colours come out #rrggbb.
 *
 * Usage: `node tools/look.mjs [--check]` — `--check` writes nothing and fails when tools/look.json
 * is not what tools/look/tokens.css resolves to.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
export const TOKENS_CSS = join(TOOLS, 'look', 'tokens.css');
export const LOOK_JSON = join(TOOLS, 'look.json');

/** The look the plugins wear: the console's openmixer board, its axes as the root element carries them. */
export const LOOK = Object.freeze({ theme: 'dark', accent: 'cyan', finish: 'aluminium', style: 'modern' });

/** The tokens a renderer reads, in the order tools/look.json lists them. */
export const LOOK_TOKENS = Object.freeze(['--surface', '--surface-2', '--surface-3', '--border-strong', '--ink', '--ink-dim', '--accent', '--font-ui', '--font-file']);

/** The tokens that are not colours: the CSS font stack, and the font file (relative to tools/) the raster reads. */
export const NOT_COLOURS = Object.freeze(['--font-ui', '--font-file']);

/** Every rule of `css`, in order: its selectors and its declarations. Comments are dropped. */
export function parseRules(css) {
  const rules = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = [];
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at < 0) {
        if (d.trim()) throw new Error(`look: '${d.trim()}' is no declaration`);
        continue;
      }
      decls.push([d.slice(0, at).trim(), d.slice(at + 1).trim()]);
    }
    rules.push({ selectors: m[1].split(',').map((s) => s.trim()), decls });
  }
  return rules;
}

/** A selector's specificity at `axes` (one for :root, one more per attribute), or -1 when the root
 * element does not match it. Only `:root` and `[data-<axis>="<value>"]` are selectors here. */
export function specificity(selector, axes) {
  const m = selector.match(/^:root((?:\[data-[a-z]+="[a-z0-9-]+"\])*)$/);
  if (!m) throw new Error(`look: '${selector}' is not :root with [data-<axis>="<value>"] attributes`);
  const attrs = [...m[1].matchAll(/\[data-([a-z]+)="([a-z0-9-]+)"\]/g)];
  for (const [, axis] of attrs) if (!(axis in axes)) throw new Error(`look: '${selector}' names the axis '${axis}', which the look does not set`);
  return attrs.every(([, axis, value]) => axes[axis] === value) ? 1 + attrs.length : -1;
}

/** `#rgb` as `#rrggbb`, lower case; any other value as it is. */
const longHex = (v) => (/^#[0-9a-fA-F]{3}$/.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v).replace(/^#[0-9A-F]{6}$/i, (x) => x.toLowerCase());

/** Every custom property of `css` at `axes`, cascaded and its var()s followed. */
export function resolveTokens(css, axes = LOOK) {
  const won = new Map();
  parseRules(css).forEach((rule, order) => {
    const spec = Math.max(...rule.selectors.map((s) => specificity(s, axes)));
    if (spec < 0) return;
    for (const [prop, value] of rule.decls) {
      const was = won.get(prop);
      if (!was || spec >= was.spec) won.set(prop, { spec, order, value });
    }
  });
  const out = {};
  const follow = (prop, seen) => {
    if (prop in out) return out[prop];
    if (seen.includes(prop)) throw new Error(`look: ${[...seen, prop].join(' -> ')} is a cycle`);
    const w = won.get(prop);
    if (!w) throw new Error(`look: ${prop} is not set at ${JSON.stringify(axes)}`);
    const v = w.value.replace(/var\((--[A-Za-z0-9-]+)\)/g, (_x, name) => follow(name, [...seen, prop]));
    out[prop] = longHex(v);
    return out[prop];
  };
  for (const prop of won.keys()) follow(prop, []);
  return out;
}

/** tools/look.json's text: the look, and each token a renderer reads as plain values. */
export function emitLook(css, axes = LOOK) {
  const all = resolveTokens(css, axes);
  const tokens = {};
  for (const k of LOOK_TOKENS) {
    if (!(k in all)) throw new Error(`look: tools/look/tokens.css sets no ${k}`);
    if (!NOT_COLOURS.includes(k) && !/^#[0-9a-f]{6}$/.test(all[k])) throw new Error(`look: ${k} resolves to '${all[k]}', not a #rrggbb colour`);
    tokens[k] = all[k];
  }
  const look = {
    $comment: 'GENERATED — DO NOT EDIT BY HAND. The look the MOD GUI wears (tools/modgui-gen.mjs): tools/look/tokens.css resolved by tools/look.mjs at the look it names, every colour a plain #rrggbb. Regenerate: `node tools/look.mjs`, then commit the result.',
    ...axes,
    tokens,
  };
  return `${JSON.stringify(look, null, 2)}\n`;
}

function main(argv) {
  const want = emitLook(readFileSync(TOKENS_CSS, 'utf8'));
  if (argv.includes('--check')) {
    let have = '';
    try {
      have = readFileSync(LOOK_JSON, 'utf8');
    } catch {
      // missing: stale below
    }
    if (have !== want) {
      console.error('look: STALE tools/look.json (run `node tools/look.mjs`)');
      process.exit(1);
    }
    console.log('look: tools/look.json is what tools/look/tokens.css resolves to');
    return;
  }
  writeFileSync(LOOK_JSON, want);
  console.log('look: wrote tools/look.json');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
