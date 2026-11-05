/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * omx_panel_render.h — the panel renderer: one C library that draws a panel description (what
 * `omx-panel layout` writes, tools/panel-description.mjs) in the omx look, into a plain CPU pixel
 * buffer. Every surface that shows a plugin's panel draws through it: a plugin window (the buffer is
 * blitted into it), a host-embedded inline view at the size the host gives, and a buffer another
 * process ships to the console. docs/renderer.md has the design.
 *
 * The description says what is on the panel; the host says what each control currently reads: its
 * position along its travel (0..1) and the text its plugin formats for that value. The renderer
 * formats no value and reads no travel, so the panel of any plugin, ours or a third party's, is drawn
 * the same way.
 *
 * Nothing here is thread-safe on one view; two views share nothing.
 */
#ifndef OMX_PANEL_RENDER_H
#define OMX_PANEL_RENDER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** A pixel in a buffer: four 8-bit channels in the order named, the colour premultiplied by its alpha (the default,
 * what a compositor blends) or straight (what a PNG holds). */
typedef enum omx_panel_pixel_format {
  OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED = 0,
  OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED = 1,
  OMX_PANEL_PIXEL_RGBA8_STRAIGHT = 2,
  OMX_PANEL_PIXEL_BGRA8_STRAIGHT = 3,
} omx_panel_pixel_format_t;

/** A buffer the caller owns: `height` rows of `stride` bytes, each row's first `width` pixels drawn.
 * `scale` is device pixels per logical pixel (1, 2, 1.5 ...): the panel's geometry is in logical px. */
typedef struct omx_panel_buffer {
  uint8_t *pixels;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  double scale;
  omx_panel_pixel_format_t format;
} omx_panel_buffer_t;

/** What a view is made from, as bytes in memory (nothing is read from disk):
 *  - `description_json`: the panel description, `omx-panel layout` output;
 *  - `look_json`: the look's resolved tokens, tools/look.json;
 *  - `geometry_json`: the face's geometry and text sizes, tools/look/geometry.json;
 *  - `font`, `font_size`: the TrueType file the look names (`--font-file`).
 * Each is copied or parsed at create; the caller may free them afterwards. */
typedef struct omx_panel_sources {
  const char *description_json;
  const char *look_json;
  const char *geometry_json;
  const uint8_t *font;
  size_t font_size;
} omx_panel_sources_t;

typedef struct omx_panel_view omx_panel_view_t;

/** A view of one panel, or NULL with the reason in `err` (NUL-terminated, cut to `err_size`). */
omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *sources, char *err, size_t err_size);

/** The same, reading the description from `description_path` and the look, geometry and font from
 * `data_dir`: omx-panel's tools directory (the source tree's tools/, or the installed
 * share/omx-panel/tools). */
omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir, char *err,
                                                   size_t err_size);

void omx_panel_view_destroy(omx_panel_view_t *view);

/** The controls, in the description's order: their count, and the index of the one named `symbol`
 * (-1 when there is none). */
uint32_t omx_panel_view_count(const omx_panel_view_t *view);
int32_t omx_panel_view_find(const omx_panel_view_t *view, const char *symbol);

/** The head: the maker and the plugin's name, both UTF-8. NULL leaves one empty. */
void omx_panel_view_set_title(omx_panel_view_t *view, const char *brand, const char *name);

/** A control's current reading: `fraction` its place along its travel (0 the minimum, 1 the
 * maximum, clamped), `text` what its plugin shows for the value (NULL for none). A switch is on from
 * 0.5; a meter fills to the fraction. */
bool omx_panel_view_set_value(omx_panel_view_t *view, uint32_t index, double fraction, const char *text);

/** A selector's reading: option `at` of `count`, and its label. */
bool omx_panel_view_set_choice(omx_panel_view_t *view, uint32_t index, uint32_t at, uint32_t count, const char *text);

/** A governing control's integer value. A control the description shows only for certain values of another (its
 * `visibleWhen` and `mask`, a declared panel's visibleWhen) is shown while bit `value` of its mask is set: a hidden
 * control takes no cell and is not drawn, and a section left with none takes no space. Until it is set, each reads the
 * governing control's come-up value (`visibleWhen.default`). False when no control of the panel is governed by `symbol`. */
bool omx_panel_view_set_integer(omx_panel_view_t *view, const char *symbol, int64_t value);

/** Whether control `index` is shown at the current governing values. */
bool omx_panel_view_visible(const omx_panel_view_t *view, uint32_t index);

/** The size, in logical px, the panel is laid out at with nothing to fit: what a window opens at. */
void omx_panel_view_natural_size(const omx_panel_view_t *view, uint32_t *width, uint32_t *height);

/** Where control `index` sits when the panel is drawn into a buffer of width x height device px at `scale`: its cell,
 * as x, y, width and height in device px. What a pointer event is hit-tested against. False for a hidden control. */
bool omx_panel_view_control_rect(const omx_panel_view_t *view, uint32_t width, uint32_t height, double scale, uint32_t index,
                                 double rect[4]);

/** Draw the panel into `buffer`, every pixel of it: what the panel does not cover is transparent.
 * A buffer smaller than the natural size (times its scale) gets the panel reflowed to fewer controls
 * a row and, if it still does not fit, drawn smaller; a larger one gets it at its natural size in
 * the top-left corner. False, drawing nothing, for a buffer that is not one (no pixels, a zero
 * size, a stride under four bytes a pixel, a scale that is not positive, a format that is not one). */
bool omx_panel_view_draw(omx_panel_view_t *view, const omx_panel_buffer_t *buffer);

#ifdef __cplusplus
}
#endif

#endif
