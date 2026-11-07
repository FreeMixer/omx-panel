/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * omx-panel-render — draws a panel description into a pixel buffer and writes it out: the library's
 * own front door, for the tests and for a tool that wants a picture of a panel.
 *
 *   omx-panel-render --description <layout.json> [--data <tools dir>] [--state <state.json>]
 *                    [--width W --height H] [--scale S] [--format rgba|bgra] [--alpha premultiplied|straight]
 *                    [--raw <file>] [--png <file>] [--rects] [--window]
 *
 * The size is the panel's natural size times the scale unless --width and --height give one. The
 * state is the host's side: {"brand", "name", "values": {"<symbol>": {"fraction", "text"} |
 * {"at", "count", "text"}}, "integers": {"<symbol>": n}, "curves": {"<display>": {"x": [...], "y": [...]}}}, the integers the governing values a visibility rule reads, the curves the points of each display. --raw writes the buffer's bytes as they are (rows of width * 4, premultiplied
 * unless --alpha straight); --png an RGBA PNG (straight alpha, as PNG holds it), its image data in stored
 * (uncompressed) deflate blocks, so it needs no zlib; --rects one line per control, its cell as
 * "x y width height" in device px, or "hidden". --window (a build with the window, WINDOW=1) draws the panel in a window of its
 * own at its natural size, NanoVG on OpenGL, and reads the window's frame back instead of drawing the buffer.
 * Prints "<width> <height>" on stdout first. Exit 0 drawn, 1 refused (the reason on stderr), 2 usage.
 */
#include <cjson/cJSON.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "omx_panel_render.h"
#ifdef OMX_PANEL_WINDOW
#include "omx_panel_window.h"
#endif

#ifndef OMX_PANEL_DATA_DIR
#define OMX_PANEL_DATA_DIR "/usr/share/omx-panel/tools"
#endif

static const char *USAGE =
    "usage: omx-panel-render --description <layout.json> [--data <tools dir>] [--state <state.json>]\n"
    "                        [--width W --height H] [--scale S] [--format rgba|bgra] [--alpha premultiplied|straight]\n"
    "                        [--raw <file>] [--png <file>] [--rects] [--window]\n";

static uint32_t crc_table[256];
static void crc_init(void) {
  for (uint32_t n = 0; n < 256; n++) {
    uint32_t c = n;
    for (int k = 0; k < 8; k++) c = c & 1 ? 0xedb88320u ^ (c >> 1) : c >> 1;
    crc_table[n] = c;
  }
}
static uint32_t crc(uint32_t c, const uint8_t *b, size_t n) {
  for (size_t i = 0; i < n; i++) c = crc_table[(c ^ b[i]) & 255] ^ (c >> 8);
  return c;
}
static void be32(uint8_t *p, uint32_t v) { p[0] = v >> 24, p[1] = v >> 16, p[2] = v >> 8, p[3] = v; }

static void chunk(FILE *f, const char *type, const uint8_t *body, size_t n) {
  uint8_t h[8];
  be32(h, (uint32_t)n);
  memcpy(h + 4, type, 4);
  fwrite(h, 1, 8, f);
  if (n) fwrite(body, 1, n, f);
  uint32_t c = crc(0xffffffffu, (const uint8_t *)type, 4);
  c = crc(c, body, n) ^ 0xffffffffu;
  be32(h, c);
  fwrite(h, 1, 4, f);
}

static int write_png(const char *path, const uint8_t *px, uint32_t w, uint32_t h, uint32_t stride, int bgra) {
  FILE *f = fopen(path, "wb");
  if (!f) return 0;
  size_t row = (size_t)w * 4 + 1, raw_n = row * h;
  uint8_t *raw = malloc(raw_n);
  for (uint32_t y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (uint32_t x = 0; x < w; x++) {
      const uint8_t *p = px + (size_t)y * stride + (size_t)x * 4;
      uint8_t *q = raw + y * row + 1 + (size_t)x * 4;
      q[0] = bgra ? p[2] : p[0], q[1] = p[1], q[2] = bgra ? p[0] : p[2], q[3] = p[3];
    }
  }
  size_t blocks = raw_n / 65535 + 1, z_n = 2 + raw_n + blocks * 5 + 4;
  uint8_t *z = malloc(z_n), *o = z;
  *o++ = 0x78, *o++ = 0x01;
  uint32_t a = 1, b = 0;
  for (size_t i = 0; i < raw_n; i++) a = (a + raw[i]) % 65521, b = (b + a) % 65521;
  size_t at = 0;
  do {
    size_t len = raw_n - at > 65535 ? 65535 : raw_n - at;
    *o++ = at + len == raw_n;
    *o++ = len & 255, *o++ = len >> 8, *o++ = ~len & 255, *o++ = (~len >> 8) & 255;
    memcpy(o, raw + at, len);
    o += len, at += len;
  } while (at < raw_n);
  be32(o, (b << 16) | a);
  o += 4;
  static const uint8_t sig[8] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
  fwrite(sig, 1, 8, f);
  uint8_t ihdr[13];
  be32(ihdr, w), be32(ihdr + 4, h);
  ihdr[8] = 8, ihdr[9] = 6, ihdr[10] = ihdr[11] = ihdr[12] = 0;
  chunk(f, "IHDR", ihdr, 13);
  chunk(f, "IDAT", z, (size_t)(o - z));
  chunk(f, "IEND", NULL, 0);
  free(raw), free(z);
  return fclose(f) == 0;
}

static char *slurp(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *b = malloc((size_t)n + 1);
  if (fread(b, 1, (size_t)n, f) != (size_t)n) n = 0;
  b[n] = 0;
  fclose(f);
  return b;
}

static int apply_state(omx_panel_view_t *v, const char *path) {
  char *text = slurp(path);
  if (!text) { fprintf(stderr, "omx-panel-render: cannot read %s\n", path); return 0; }
  cJSON *root = cJSON_Parse(text);
  free(text);
  if (!cJSON_IsObject(root)) { fprintf(stderr, "omx-panel-render: %s is not a JSON object\n", path); cJSON_Delete(root); return 0; }
  omx_panel_view_set_title(v, cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "brand")),
                           cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "name")));
  cJSON *it;
  int ok = 1;
  cJSON_ArrayForEach(it, cJSON_GetObjectItemCaseSensitive(root, "values")) {
    int32_t i = omx_panel_view_find(v, it->string);
    const char *t = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "text"));
    cJSON *fr = cJSON_GetObjectItemCaseSensitive(it, "fraction"), *at = cJSON_GetObjectItemCaseSensitive(it, "at"),
          *count = cJSON_GetObjectItemCaseSensitive(it, "count");
    int done = i >= 0 && (cJSON_IsNumber(at) && cJSON_IsNumber(count)
                              ? omx_panel_view_set_choice(v, (uint32_t)i, (uint32_t)at->valueint, (uint32_t)count->valueint, t)
                              : cJSON_IsNumber(fr) && omx_panel_view_set_value(v, (uint32_t)i, fr->valuedouble, t));
    if (!done) {
      fprintf(stderr, "omx-panel-render: state names '%s', which is no control of the panel or has no reading\n", it->string);
      ok = 0;
    }
  }
  /* "integers": {"<symbol>": n}, the governing controls' values a visibility rule reads */
  cJSON_ArrayForEach(it, cJSON_GetObjectItemCaseSensitive(root, "integers")) {
    if (!cJSON_IsNumber(it) || !omx_panel_view_set_integer(v, it->string, (int64_t)it->valuedouble)) {
      fprintf(stderr, "omx-panel-render: state's integers name '%s', which governs no control of the panel\n", it->string);
      ok = 0;
    }
  }
  /* "curves": {"<display index>": {"x": [...], "y": [...]}}, the points a host computed for each display */
  cJSON_ArrayForEach(it, cJSON_GetObjectItemCaseSensitive(root, "curves")) {
    cJSON *xs = cJSON_GetObjectItemCaseSensitive(it, "x"), *ys = cJSON_GetObjectItemCaseSensitive(it, "y"), *e;
    int n = cJSON_IsArray(xs) ? cJSON_GetArraySize(xs) : -1;
    double *x = n > 0 ? malloc((size_t)n * sizeof *x) : NULL, *y = n > 0 ? malloc((size_t)n * sizeof *y) : NULL;
    int good = x && y && cJSON_IsArray(ys) && cJSON_GetArraySize(ys) == n;
    for (int k = 0; good && k < n; k++) {
      e = cJSON_GetArrayItem(xs, k);
      good = cJSON_IsNumber(e), x[k] = good ? e->valuedouble : 0;
      e = cJSON_GetArrayItem(ys, k);
      good = good && cJSON_IsNumber(e), y[k] = good ? e->valuedouble : 0;
    }
    if (!good || !omx_panel_view_set_curve(v, (uint32_t)strtoul(it->string, NULL, 10), x, y, (uint32_t)n)) {
      fprintf(stderr, "omx-panel-render: state's curve '%s' is no curve of the panel or its points are refused\n", it->string);
      ok = 0;
    }
    free(x), free(y);
  }
  /* "marks": {"<display index>": [{"freq", "depth", "letter"}, ...]} */
  cJSON_ArrayForEach(it, cJSON_GetObjectItemCaseSensitive(root, "marks")) {
    int n = cJSON_IsArray(it) ? cJSON_GetArraySize(it) : -1;
    double *f = malloc((size_t)(n > 0 ? n : 1) * sizeof *f), *dp = malloc((size_t)(n > 0 ? n : 1) * sizeof *dp);
    char *l = malloc((size_t)(n > 0 ? n : 1));
    int good = n >= 0 && f && dp && l;
    for (int k = 0; good && k < n; k++) {
      cJSON *m = cJSON_GetArrayItem(it, k), *fr = cJSON_GetObjectItemCaseSensitive(m, "freq"), *de = cJSON_GetObjectItemCaseSensitive(m, "depth");
      const char *le = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(m, "letter"));
      good = cJSON_IsNumber(fr) && cJSON_IsNumber(de) && le && le[0] && !le[1];
      if (good) f[k] = fr->valuedouble, dp[k] = de->valuedouble, l[k] = le[0];
    }
    if (!good || !omx_panel_view_set_marks(v, (uint32_t)strtoul(it->string, NULL, 10), f, dp, l, (uint32_t)n)) {
      fprintf(stderr, "omx-panel-render: state's marks '%s' are no marks of an eq curve of the panel\n", it->string);
      ok = 0;
    }
    free(f), free(dp), free(l);
  }
  cJSON_Delete(root);
  return ok;
}

int main(int argc, char **argv) {
  const char *desc = NULL, *data = OMX_PANEL_DATA_DIR, *state = NULL, *raw = NULL, *png = NULL;
  double scale = 1;
  long width = 0, height = 0;
  int bgra = 0, straight = 0, rects = 0, window = 0;
  for (int i = 1; i < argc; i++) {
    const char *a = argv[i], *val = i + 1 < argc ? argv[i + 1] : NULL;
    if (!strcmp(a, "--rects")) { rects = 1; continue; }
    if (!strcmp(a, "--window")) { window = 1; continue; }
    if (!val) { fputs(USAGE, stderr); return 2; }
    if (!strcmp(a, "--description")) desc = val;
    else if (!strcmp(a, "--data")) data = val;
    else if (!strcmp(a, "--state")) state = val;
    else if (!strcmp(a, "--raw")) raw = val;
    else if (!strcmp(a, "--png")) png = val;
    else if (!strcmp(a, "--scale")) scale = strtod(val, NULL);
    else if (!strcmp(a, "--width")) width = strtol(val, NULL, 10);
    else if (!strcmp(a, "--height")) height = strtol(val, NULL, 10);
    else if (!strcmp(a, "--format") && (!strcmp(val, "rgba") || !strcmp(val, "bgra"))) bgra = !strcmp(val, "bgra");
    else if (!strcmp(a, "--alpha") && (!strcmp(val, "premultiplied") || !strcmp(val, "straight"))) straight = !strcmp(val, "straight");
    else { fputs(USAGE, stderr); return 2; }
    i++;
  }
  if (!desc || (!raw && !png && !rects) || !(scale > 0) || (width != 0) != (height != 0) || width < 0 || height < 0 ||
      (window && width)) {
    fputs(USAGE, stderr);
    return 2;
  }
#ifndef OMX_PANEL_WINDOW
  if (window) {
    fputs("omx-panel-render: built without the window (make WINDOW=1)\n", stderr);
    return 1;
  }
#endif
  char err[512];
  omx_panel_view_t *v = omx_panel_view_create_from_files(desc, data, err, sizeof err);
  if (!v) { fprintf(stderr, "omx-panel-render: %s\n", err); return 1; }
  if (state && !apply_state(v, state)) { omx_panel_view_destroy(v); return 1; }
  if (!width) {
    uint32_t w, h;
    omx_panel_view_natural_size(v, &w, &h);
    width = lround(w * scale), height = lround(h * scale);
  }
#ifdef OMX_PANEL_WINDOW
  omx_panel_window_t *win = NULL;
  if (window) {
    if (!(win = omx_panel_window_create(v, 0, scale, err, sizeof err))) {
      fprintf(stderr, "omx-panel-render: %s\n", err);
      omx_panel_view_destroy(v);
      return 1;
    }
    omx_panel_window_show(win);
  }
#define DRAW(b) (win ? omx_panel_window_read(win, b) : omx_panel_view_draw(v, b))
#else
#define DRAW(b) omx_panel_view_draw(v, b)
#endif
  omx_panel_pixel_format_t format = bgra ? (straight ? OMX_PANEL_PIXEL_BGRA8_STRAIGHT : OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED)
                                          : (straight ? OMX_PANEL_PIXEL_RGBA8_STRAIGHT : OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED);
  omx_panel_buffer_t b = {malloc((size_t)width * height * 4), (uint32_t)width, (uint32_t)height, (uint32_t)width * 4, scale, format};
  int ok = b.pixels && DRAW(&b);
  if (ok && raw) {
    FILE *f = fopen(raw, "wb");
    ok = f && fwrite(b.pixels, 1, (size_t)width * height * 4, f) == (size_t)width * height * 4;
    if (f && fclose(f)) ok = 0;
  }
  if (ok && png) { /* a PNG holds straight alpha: drawn so, whatever the buffer asked for */
    crc_init();
    b.format = OMX_PANEL_PIXEL_RGBA8_STRAIGHT;
    ok = DRAW(&b) && write_png(png, b.pixels, b.width, b.height, b.stride, 0);
  }
  if (ok) printf("%ld %ld\n", width, height);
  for (uint32_t i = 0; ok && rects && i < omx_panel_view_count(v); i++) {
    double r[4];
    /* a hidden control has no cell: its line is "hidden" */
    if (omx_panel_view_control_rect(v, b.width, b.height, scale, i, r)) printf("%g %g %g %g\n", r[0], r[1], r[2], r[3]);
    else puts("hidden");
  }
  if (!ok) fprintf(stderr, "omx-panel-render: could not draw or write the image\n");
  free(b.pixels);
#ifdef OMX_PANEL_WINDOW
  omx_panel_window_destroy(win);
#endif
  omx_panel_view_destroy(v);
  return ok ? 0 : 1;
}
