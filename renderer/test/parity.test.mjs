// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer draws the MOD GUI's face to the bit. Until the MOD GUI's images come from the renderer itself, two codes
 * draw the same face (tools/modgui-gen.mjs renderFace over tools/raster.mjs, and renderer/src); this holds them equal,
 * pixel for pixel, at the generator's own scales, and against the screenshots it committed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, ROOT, compare, decodePng, descriptionFile, face, render, scratch, stateFile } from './harness.mjs';

for (const fx of FIXTURES) {
  for (const scale of [1, 0.5, 2]) {
    test(`${fx.name} at ${scale}x is the MOD GUI face, pixel for pixel`, () => {
      const dir = scratch();
      const want = face(fx, scale);
      const drawn = render(descriptionFile(fx, dir), stateFile(fx, dir), { scale });
      const d = compare(drawn, want);
      assert.ok(d.sameSize, `size ${drawn.w}x${drawn.h}, the face is ${want.w}x${want.h}`);
      assert.ok(d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
    });
  }
  if (fx.screenshot) {
    test(`${fx.name}: the committed MOD GUI screenshot is what the renderer draws`, () => {
      const dir = scratch();
      const shot = decodePng(readFileSync(join(ROOT, fx.screenshot)));
      const d = compare(render(descriptionFile(fx, dir), stateFile(fx, dir)), shot);
      assert.ok(d.sameSize && d.exact, `${d.off} pixels differ, by up to ${d.worst}`);
    });
  }
}

test('BGRA is RGBA with red and blue swapped, nothing else', () => {
  const dir = scratch();
  const fx = FIXTURES[0];
  const desc = descriptionFile(fx, dir), state = stateFile(fx, dir);
  const rgba = render(desc, state), bgra = render(desc, state, { format: 'bgra' });
  const swapped = new Uint8Array(bgra.data.length);
  for (let i = 0; i < bgra.data.length; i += 4) swapped.set([bgra.data[i + 2], bgra.data[i + 1], bgra.data[i], bgra.data[i + 3]], i);
  assert.ok(compare(rgba, { ...bgra, data: swapped }).exact);
});
