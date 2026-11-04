/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * window.c — the panel in a window: pugl's OpenGL 3.3 view, NanoVG drawing the view's primitives (draw.h). The layout,
 * the widgets and where each text is cut are view.c's, shared with the CPU buffer; only the rasterisation differs, so
 * a window is held to the buffer by structure (where each control is, what it shows), not pixel for pixel.
 */
#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>
#include <nanovg.h>
#define NANOVG_GL3_IMPLEMENTATION
#include <nanovg_gl.h>
#include <pugl/gl.h>
#include <pugl/pugl.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "draw.h"
#include "omx_panel_window.h"

struct omx_panel_window {
  omx_panel_view_t *view;
  PuglWorld *world;
  PuglView *pv;
  NVGcontext *vg;
  int font;
  double scale;
  uint32_t w, h;
  uint8_t *read; /* a frame to read back into, RGBA premultiplied, top row first; NULL when none is asked */
  int frames;
};

static NVGcolor colour(omx_rgb c) { return nvgRGB(c.c[0], c.c[1], c.c[2]); }

static void nvg_round_rect(void *ctx, double x, double y, double w, double h, double r, omx_rgb rgb) {
  if (!(w > 0 && h > 0)) return;
  NVGcontext *vg = ((struct omx_panel_window *)ctx)->vg;
  nvgBeginPath(vg);
  nvgRoundedRect(vg, (float)x, (float)y, (float)w, (float)h, (float)fmax(0, r));
  nvgFillColor(vg, colour(rgb));
  nvgFill(vg);
}

static void nvg_disc(void *ctx, double cx, double cy, double r, omx_rgb rgb) {
  if (!(r > 0)) return;
  NVGcontext *vg = ((struct omx_panel_window *)ctx)->vg;
  nvgBeginPath(vg);
  nvgCircle(vg, (float)cx, (float)cy, (float)r);
  nvgFillColor(vg, colour(rgb));
  nvgFill(vg);
}

static void nvg_segment(void *ctx, double ax, double ay, double bx, double by, double hw, omx_rgb rgb) {
  NVGcontext *vg = ((struct omx_panel_window *)ctx)->vg;
  nvgBeginPath(vg);
  nvgMoveTo(vg, (float)ax, (float)ay);
  nvgLineTo(vg, (float)bx, (float)by);
  nvgLineCap(vg, NVG_ROUND);
  nvgStrokeWidth(vg, (float)(2 * hw));
  nvgStrokeColor(vg, colour(rgb));
  nvgStroke(vg);
}

static void nvg_text(void *ctx, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb, omx_align a) {
  NVGcontext *vg = ((struct omx_panel_window *)ctx)->vg;
  if (!n) return;
  /* placed by the font's own advances, as the raster places it, so a line starts and ends where the buffer's does */
  double tw = omx_text_width(f, cps, n, px);
  double left = a == OMX_ALIGN_CENTRE ? x - tw / 2 : a == OMX_ALIGN_RIGHT ? x - tw : x;
  char *s = malloc(n * 4 + 1), *o = s;
  for (size_t i = 0; i < n; i++) {
    uint32_t c = cps[i];
    if (c < 0x80) *o++ = (char)c;
    else if (c < 0x800) *o++ = (char)(0xc0 | c >> 6), *o++ = (char)(0x80 | (c & 0x3f));
    else if (c < 0x10000) *o++ = (char)(0xe0 | c >> 12), *o++ = (char)(0x80 | ((c >> 6) & 0x3f)), *o++ = (char)(0x80 | (c & 0x3f));
    else *o++ = (char)(0xf0 | c >> 18), *o++ = (char)(0x80 | ((c >> 12) & 0x3f)), *o++ = (char)(0x80 | ((c >> 6) & 0x3f)), *o++ = (char)(0x80 | (c & 0x3f));
  }
  *o = 0;
  const struct omx_panel_window *w = ctx;
  nvgFontFaceId(vg, w->font);
  nvgFontSize(vg, (float)px); /* by the em, as the raster sizes it (fontstash maps the em to the size) */
  nvgTextAlign(vg, NVG_ALIGN_LEFT | NVG_ALIGN_BASELINE);
  nvgFillColor(vg, colour(rgb));
  nvgText(vg, (float)left, (float)y, s, o);
  free(s);
}

static void expose(struct omx_panel_window *w) {
  glViewport(0, 0, (GLsizei)w->w, (GLsizei)w->h);
  glClearColor(0, 0, 0, 0);
  glClear(GL_COLOR_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
  if (!w->vg) return;
  nvgBeginFrame(w->vg, (float)w->w, (float)w->h, 1);
  const omx_draw d = {w, nvg_round_rect, nvg_disc, nvg_segment, nvg_text};
  omx_panel_view_paint(w->view, w->w, w->h, w->scale, &d);
  nvgEndFrame(w->vg);
  if (w->read) {
    uint8_t *up = malloc((size_t)w->w * w->h * 4);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, (GLsizei)w->w, (GLsizei)w->h, GL_RGBA, GL_UNSIGNED_BYTE, up);
    for (uint32_t y = 0; y < w->h; y++) memcpy(w->read + (size_t)y * w->w * 4, up + (size_t)(w->h - 1 - y) * w->w * 4, (size_t)w->w * 4);
    free(up);
  }
  w->frames++;
}

static PuglStatus on_event(PuglView *pv, const PuglEvent *e) {
  struct omx_panel_window *w = puglGetHandle(pv);
  switch (e->type) {
  case PUGL_REALIZE: {
    w->vg = nvgCreateGL3(NVG_ANTIALIAS | NVG_STENCIL_STROKES);
    size_t size;
    const uint8_t *bytes = omx_font_bytes(omx_panel_view_font(w->view), &size);
    /* NanoVG reads the font in place: the view keeps its bytes for as long as it lives */
    if (w->vg) w->font = nvgCreateFontMem(w->vg, "panel", (unsigned char *)bytes, (int)size, 0);
    break;
  }
  case PUGL_UNREALIZE:
    if (w->vg) nvgDeleteGL3(w->vg);
    w->vg = NULL;
    break;
  case PUGL_CONFIGURE:
    w->w = e->configure.width, w->h = e->configure.height;
    break;
  case PUGL_EXPOSE:
    expose(w);
    break;
  default:
    break;
  }
  return PUGL_SUCCESS;
}

static void fail(char *err, size_t n, const char *msg) {
  if (err && n) snprintf(err, n, "%s", msg);
}

omx_panel_window_t *omx_panel_window_create(omx_panel_view_t *view, uintptr_t parent, double scale, char *err, size_t n) {
  if (!view || !(scale > 0)) { fail(err, n, "window: no view, or a scale that is not positive"); return NULL; }
  if (!getenv("DISPLAY") && !getenv("WAYLAND_DISPLAY")) { fail(err, n, "window: there is no display (neither DISPLAY nor WAYLAND_DISPLAY is set)"); return NULL; }
  struct omx_panel_window *w = calloc(1, sizeof *w);
  if (!w) return NULL;
  w->view = view, w->scale = scale, w->font = -1;
  uint32_t nw, nh;
  omx_panel_view_natural_size(view, &nw, &nh);
  w->w = (uint32_t)lround(nw * scale), w->h = (uint32_t)lround(nh * scale);
  w->world = puglNewWorld(parent ? PUGL_MODULE : PUGL_PROGRAM, 0);
  w->pv = w->world ? puglNewView(w->world) : NULL;
  if (!w->pv) { fail(err, n, "window: pugl could not start"); omx_panel_window_destroy(w); return NULL; }
  puglSetWorldString(w->world, PUGL_CLASS_NAME, "omx-panel");
  puglSetHandle(w->pv, w);
  puglSetBackend(w->pv, puglGlBackend());
  puglSetViewHint(w->pv, PUGL_CONTEXT_API, PUGL_OPENGL_API);
  puglSetViewHint(w->pv, PUGL_CONTEXT_VERSION_MAJOR, 3);
  puglSetViewHint(w->pv, PUGL_CONTEXT_VERSION_MINOR, 3);
  puglSetViewHint(w->pv, PUGL_CONTEXT_PROFILE, PUGL_OPENGL_CORE_PROFILE);
  puglSetViewHint(w->pv, PUGL_STENCIL_BITS, 8);
  puglSetViewHint(w->pv, PUGL_ALPHA_BITS, 8);
  puglSetViewHint(w->pv, PUGL_RESIZABLE, 0);
  puglSetSizeHint(w->pv, PUGL_DEFAULT_SIZE, (PuglSpan)w->w, (PuglSpan)w->h);
  puglSetEventFunc(w->pv, on_event);
  if (parent) puglSetParent(w->pv, (PuglNativeView)parent);
  if (puglRealize(w->pv) != PUGL_SUCCESS) { fail(err, n, "window: the window or its OpenGL 3.3 context could not be made"); omx_panel_window_destroy(w); return NULL; }
  if (!w->vg) { fail(err, n, "window: NanoVG could not start on the OpenGL context"); omx_panel_window_destroy(w); return NULL; }
  return w;
}

void omx_panel_window_destroy(omx_panel_window_t *w) {
  if (!w) return;
  if (w->pv) puglFreeView(w->pv);
  if (w->world) puglFreeWorld(w->world);
  free(w);
}

bool omx_panel_window_show(omx_panel_window_t *w) { return w && puglShow(w->pv, PUGL_SHOW_RAISE) == PUGL_SUCCESS; }
bool omx_panel_window_hide(omx_panel_window_t *w) { return w && puglHide(w->pv) == PUGL_SUCCESS; }

void omx_panel_window_size(const omx_panel_window_t *w, uint32_t *width, uint32_t *height) {
  if (width) *width = w ? w->w : 0;
  if (height) *height = w ? w->h : 0;
}

uintptr_t omx_panel_window_native(const omx_panel_window_t *w) { return w ? (uintptr_t)puglGetNativeView(w->pv) : 0; }

void omx_panel_window_redraw(omx_panel_window_t *w) {
  if (w) puglObscureView(w->pv);
}

void omx_panel_window_idle(omx_panel_window_t *w) {
  if (w) puglUpdate(w->world, 0);
}

bool omx_panel_window_read(omx_panel_window_t *w, const omx_panel_buffer_t *b) {
  if (!w || !b || !b->pixels || b->width != w->w || b->height != w->h || b->stride < (uint64_t)b->width * 4 ||
      (unsigned)b->format > OMX_PANEL_PIXEL_BGRA8_STRAIGHT)
    return false;
  w->read = malloc((size_t)w->w * w->h * 4);
  int before = w->frames;
  puglObscureView(w->pv);
  for (int i = 0; i < 100 && w->frames == before; i++) puglUpdate(w->world, 0.01);
  bool ok = w->frames != before;
  int bgra = b->format == OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED || b->format == OMX_PANEL_PIXEL_BGRA8_STRAIGHT;
  int straight = b->format == OMX_PANEL_PIXEL_RGBA8_STRAIGHT || b->format == OMX_PANEL_PIXEL_BGRA8_STRAIGHT;
  for (uint32_t y = 0; ok && y < b->height; y++)
    for (uint32_t x = 0; x < b->width; x++) {
      const uint8_t *p = w->read + ((size_t)y * w->w + x) * 4;
      uint8_t *q = b->pixels + (size_t)y * b->stride + (size_t)x * 4, c[3] = {p[0], p[1], p[2]};
      /* GL holds what NanoVG blends: premultiplied colour */
      if (straight)
        for (int k = 0; k < 3; k++) c[k] = p[3] ? (uint8_t)fmin(255, (c[k] * 255 + p[3] / 2) / p[3]) : 0;
      q[0] = bgra ? c[2] : c[0], q[1] = c[1], q[2] = bgra ? c[0] : c[2], q[3] = p[3];
    }
  free(w->read);
  w->read = NULL;
  return ok;
}
