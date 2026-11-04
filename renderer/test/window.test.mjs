// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The window draws what the buffer draws. The two share the layout, the widget code and where every text is cut; NanoVG
 * on OpenGL rasterises differently from the CPU, so the window is held to the buffer by structure, not pixel for pixel:
 * the same size; in every control's cell the accent (a knob's pointer, a fader's line, a switch, a meter's fill) in the
 * same place and of about the same amount; its text over the same extent and of about the same amount; and the image,
 * block by block, the same within a tolerance.
 *
 * Needs the command built with the window (make WINDOW=1) and a display (xvfb-run). Without them each test is skipped,
 * unless OMX_PANEL_WINDOW_REQUIRED=1, as CI sets it, makes a missing window a failure.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, descriptionFile, rects, render, scratch, stateFile } from './harness.mjs';

const REQUIRED = process.env.OMX_PANEL_WINDOW_REQUIRED === '1';
/** The accent as a pixel is near it: within this much in every channel, and opaque. */
const ACCENT_NEAR = 60;
/** The accent's centre in a cell may move this far, in logical px; its amount by this ratio either way. */
const CENTRE_PX = 1;
const AMOUNT_RATIO = 1.6;
/** A block of BLOCK x BLOCK logical px is the same when its mean colour moves by at most BLOCK_MEAN; this share must be. */
const BLOCK = 8;
/** Text is the pixels lighter than INK_LEVEL in every channel and greyer than INK_GREY between channels; its extent in a
 * cell may move INK_PX logical px at each edge, its amount by AMOUNT_RATIO. */
const INK_LEVEL = 100;
const INK_GREY = 40;
const INK_PX = 2;
const BLOCK_MEAN = 20;
const BLOCKS_SAME = 0.97;

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const ACCENT = hex(JSON.parse(readFileSync(join(DATA, 'look.json'), 'utf8')).tokens['--accent']);

/** Why a window cannot be drawn here, or null. */
function unavailable() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return 'no display';
  try {
    execFileSync(CLI, ['--description', '/dev/null', '--window', '--rects'], { stdio: 'pipe' });
  } catch (e) {
    if (String(e.stderr).includes('built without the window')) return 'the command is built without the window';
  }
  return null;
}
const why = unavailable();

/** The accent in `img` inside `r` ([x, y, w, h], device px): how many pixels, and their centre. */
function accentIn(img, r) {
  let n = 0, sx = 0, sy = 0;
  for (let y = Math.max(0, Math.floor(r[1])); y < Math.min(img.h, Math.ceil(r[1] + r[3])); y++) {
    for (let x = Math.max(0, Math.floor(r[0])); x < Math.min(img.w, Math.ceil(r[0] + r[2])); x++) {
      const i = (y * img.w + x) * 4;
      if (img.data[i + 3] > 200 && [0, 1, 2].every((k) => Math.abs(img.data[i + k] - ACCENT[k]) <= ACCENT_NEAR)) n++, sx += x, sy += y;
    }
  }
  return { n, x: n ? sx / n : 0, y: n ? sy / n : 0 };
}

/** The text in `img` inside `r`: the light grey pixels (the ink and the dim ink, never the accent or the surfaces), how
 * many and their extent. A label set at another size or in another place moves its extent. */
function inkIn(img, r) {
  let n = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = Math.max(0, Math.floor(r[1])); y < Math.min(img.h, Math.ceil(r[1] + r[3])); y++) {
    for (let x = Math.max(0, Math.floor(r[0])); x < Math.min(img.w, Math.ceil(r[0] + r[2])); x++) {
      const i = (y * img.w + x) * 4, c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (img.data[i + 3] > 200 && Math.min(...c) > INK_LEVEL && Math.max(...c) - Math.min(...c) < INK_GREY) {
        n++, x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y);
      }
    }
  }
  return { n, box: [x0, y0, x1, y1] };
}

/** The share of BLOCK-px blocks whose mean colour is the same in both, within BLOCK_MEAN. */
function blocksSame(a, b, scale) {
  const size = Math.round(BLOCK * scale);
  let same = 0, all = 0;
  for (let by = 0; by < a.h; by += size) {
    for (let bx = 0; bx < a.w; bx += size) {
      const mean = (img) => {
        const m = [0, 0, 0, 0];
        let n = 0;
        for (let y = by; y < Math.min(a.h, by + size); y++) for (let x = bx; x < Math.min(a.w, bx + size); x++, n++) for (let k = 0; k < 4; k++) m[k] += img.data[(y * a.w + x) * 4 + k];
        return m.map((v) => v / n);
      };
      const ma = mean(a), mb = mean(b);
      all++;
      if (ma.every((v, k) => Math.abs(v - mb[k]) <= BLOCK_MEAN)) same++;
    }
  }
  return same / all;
}

for (const fx of FIXTURES) {
  for (const scale of [1, 2]) {
    test(`${fx.name} at ${scale}x: the window draws the buffer's panel`, { skip: !REQUIRED && why ? why : false }, () => {
      assert.equal(why, null, `no window can be drawn: ${why}`);
      const dir = scratch();
      const desc = descriptionFile(fx, dir), state = stateFile(fx, dir, fx.descriptor.includes('zamcomp') ? { gr: { fraction: 0.4, text: '8 dB' } } : {});
      const buffer = render(desc, state, { scale });
      const window = render(desc, state, { scale, window: true });
      assert.equal(`${window.w}x${window.h}`, `${buffer.w}x${buffer.h}`);
      rects(desc, { scale, size: [buffer.w, buffer.h] }).forEach((r, i) => {
        const a = accentIn(buffer, r), b = accentIn(window, r);
        assert.equal(a.n > 0, b.n > 0, `control ${i}: the accent is ${a.n ? '' : 'not '}in the buffer's cell and ${b.n ? '' : 'not '}in the window's`);
        if (!a.n) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y) / scale;
        assert.ok(d <= CENTRE_PX, `control ${i}: the accent's centre moved ${d.toFixed(2)} px`);
        assert.ok(b.n / a.n <= AMOUNT_RATIO && a.n / b.n <= AMOUNT_RATIO, `control ${i}: ${a.n} accent pixels in the buffer, ${b.n} in the window`);
      });
      rects(desc, { scale, size: [buffer.w, buffer.h] }).forEach((r, i) => {
        const a = inkIn(buffer, r), b = inkIn(window, r);
        assert.equal(a.n > 0, b.n > 0, `control ${i}: text in one cell and not the other`);
        if (!a.n) return;
        const moved = Math.max(...a.box.map((v, k) => Math.abs(v - b.box[k]))) / scale;
        assert.ok(moved <= INK_PX, `control ${i}: the text's extent moved ${moved.toFixed(1)} px`);
        assert.ok(b.n / a.n <= AMOUNT_RATIO && a.n / b.n <= AMOUNT_RATIO, `control ${i}: ${a.n} text pixels in the buffer, ${b.n} in the window`);
      });
      const same = blocksSame(buffer, window, scale);
      assert.ok(same >= BLOCKS_SAME, `${(100 * same).toFixed(1)}% of the blocks are the same`);
    });
  }
}
