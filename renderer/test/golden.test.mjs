// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The golden images: each fixture (one of our plugins, one third-party LV2 plugin as scanned and under a declared
 * panel) drawn at its natural size and at a compact size a host gives for an inline view, each at scale 1 and 2, held
 * to renderer/test/golden/<fixture>-<size>@<scale>x.png. A pixel counts as drawn the same when no channel moves by
 * more than TOLERANCE; at most OFF_SHARE of an image's pixels may move further.
 *
 * After a change that is meant to move the pixels: OMX_PANEL_RENDER_UPDATE=1 node --test test/golden.test.mjs, look
 * at every image it rewrote, and commit them.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, RENDERER, compare, decodePng, descriptionFile, encodePng, render, scratch, stateFile } from './harness.mjs';

const GOLDEN = join(RENDERER, 'test', 'golden');
const UPDATE = process.env.OMX_PANEL_RENDER_UPDATE === '1';
const TOLERANCE = 2;
const OFF_SHARE = 0.001;

/** The sizes, in logical px: the natural one, and the box a host might give an inline view. */
const SIZES = [['natural', null], ['compact', [320, 200]]];
const SCALES = [1, 2];
/** Readings a host would give the meters, so a filled meter is drawn too. */
const READINGS = { gr: { fraction: 0.4, text: '8 dB' }, outlevel: { fraction: 0.75, text: '3.8 dB' } };

for (const fx of FIXTURES) {
  for (const [sizeName, size] of SIZES) {
    for (const scale of SCALES) {
      const file = join(GOLDEN, `${fx.name}-${sizeName}@${scale}x.png`);
      test(`${fx.name}, ${sizeName}, ${scale}x: the golden image`, () => {
        const dir = scratch();
        const readings = Object.fromEntries(Object.entries(READINGS).filter(([sym]) => fx.descriptor.includes('zamcomp') && sym));
        const drawn = render(descriptionFile(fx, dir), stateFile(fx, dir, readings), { scale, ...(size ? { size: size.map((n) => n * scale) } : {}) });
        if (UPDATE || !existsSync(file)) {
          assert.ok(UPDATE, `no golden image ${file}: write it with OMX_PANEL_RENDER_UPDATE=1`);
          mkdirSync(GOLDEN, { recursive: true });
          writeFileSync(file, encodePng(drawn));
          return;
        }
        const d = compare(drawn, decodePng(readFileSync(file)), TOLERANCE);
        assert.ok(d.sameSize, `the image is ${drawn.w}x${drawn.h}, not the golden size`);
        assert.ok(d.off <= OFF_SHARE * drawn.w * drawn.h, `${d.off} of ${drawn.w * drawn.h} pixels moved by more than ${TOLERANCE} (up to ${d.worst})`);
      });
    }
  }
}

test('a compact size reflows the panel and keeps it inside the box', () => {
  const dir = scratch();
  const fx = FIXTURES.find((f) => f.name === 'zamcomp');
  const drawn = render(descriptionFile(fx, dir), stateFile(fx, dir), { size: [320, 200] });
  assert.equal(drawn.w, 320);
  assert.equal(drawn.h, 200);
  // the panel reaches the right half and the foot of the box: it was drawn to fit it, not cut at its natural size
  let right = 0, foot = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (drawn.data[(y * 320 + x) * 4 + 3]) { right = Math.max(right, x); foot = Math.max(foot, y); }
  assert.ok(right > 160 && foot > 150, `the panel ends at x ${right}, y ${foot}`);
});
