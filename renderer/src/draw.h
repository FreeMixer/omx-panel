/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * draw.h — the primitives a backend gives the view: a rounded rectangle, a disc, a round-capped segment and a line of
 * text, in device px with straight colours. The CPU raster is one backend (view.c, a buffer), NanoVG the other
 * (window.c, a window); the layout and the widgets are view.c's, once. Internal.
 */
#ifndef OMX_PANEL_DRAW_H
#define OMX_PANEL_DRAW_H

#include "omx_panel_render.h"
#include "raster.h"

typedef struct omx_draw {
  void *ctx;
  void (*round_rect)(void *ctx, double x, double y, double w, double h, double r, omx_rgb rgb);
  void (*disc)(void *ctx, double cx, double cy, double r, omx_rgb rgb);
  void (*segment)(void *ctx, double ax, double ay, double bx, double by, double hw, omx_rgb rgb);
  /* `cps` already cut to fit; `x` the left edge, the centre or the right edge by `align`, `y` the baseline */
  void (*text)(void *ctx, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb, omx_align align);
} omx_draw;

/* The panel through `d`, laid out for a box of width x height device px at `scale`. */
void omx_panel_view_paint(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, const omx_draw *d);
omx_font *omx_panel_view_font(const omx_panel_view_t *v);
/* The font file's bytes, as loaded. */
const uint8_t *omx_font_bytes(const omx_font *f, size_t *size);

#endif
