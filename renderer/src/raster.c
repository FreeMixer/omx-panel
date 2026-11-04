/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * raster.c — shapes and text by coverage: each pixel of a shape's box is sampled at SS x SS points and
 * blended source-over by the fraction inside. Every coordinate is snapped to 1/16 px before it is
 * sampled, so a last-bit difference in a host's sin/cos cannot reach a pixel, and the arithmetic is
 * the MOD GUI raster's (tools/raster.mjs) operation for operation: the two draw the same face to the
 * bit (renderer/test/parity.test.mjs holds that). Build with -ffp-contract=off: a fused multiply-add
 * would round differently.
 */
#include "raster.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SS 4

double omx_round(double v) {
  double r = floor(v);
  return v - r >= 0.5 ? r + 1 : r;
}

double omx_snap(double v) { return omx_round(v * 16) / 16; }

static double maxd(double a, double b) { return a > b ? a : b; }
static double mind(double a, double b) { return a < b ? a : b; }

/** Source-over of `rgb` at `coverage` (0..1) onto pixel (x, y). */
static void blend(omx_canvas *c, int x, int y, omx_rgb rgb, double coverage) {
  if (coverage <= 0 || x < 0 || y < 0 || x >= c->w || y >= c->h) return;
  uint8_t *p = c->px + (size_t)y * c->stride + (size_t)x * 4;
  int a = (int)omx_round(coverage * 255);
  if (a == 255) { /* what the arithmetic below gives for full coverage: the colour, opaque */
    p[c->bgra ? 2 : 0] = rgb.c[0], p[1] = rgb.c[1], p[c->bgra ? 0 : 2] = rgb.c[2], p[3] = 255;
    return;
  }
  int da = p[3];
  int oa = a + (int)omx_round((double)(da * (255 - a)) / 255);
  for (int k = 0; k < 3; k++) {
    int at = c->bgra ? 2 - k : k;
    double src = (double)(rgb.c[k] * a);
    double dst = omx_round((double)(p[at] * da * (255 - a)) / 255);
    p[at] = oa == 0 ? 0 : (uint8_t)omx_round((src + dst) / oa);
  }
  p[3] = (uint8_t)oa;
}

typedef int (*inside_fn)(const void *ctx, double px, double py);
/* Whether the whole pixel at (x, y) is inside a convex shape, so every sample is: then it is not sampled. A shortcut
 * only, never a different answer: a pixel it does not vouch for is sampled. */
typedef int (*whole_fn)(const void *ctx, int x, int y);

static void fill_shape(omx_canvas *c, double bx0, double by0, double bx1, double by1, inside_fn inside, whole_fn whole,
                       const void *ctx, omx_rgb rgb) {
  int x0 = (int)maxd(0, floor(bx0)), y0 = (int)maxd(0, floor(by0));
  int x1 = (int)mind(c->w, ceil(bx1)), y1 = (int)mind(c->h, ceil(by1));
  for (int y = y0; y < y1; y++) {
    for (int x = x0; x < x1; x++) {
      int n = 0;
      if (whole && whole(ctx, x, y)) n = SS * SS;
      else
        for (int sy = 0; sy < SS; sy++)
          for (int sx = 0; sx < SS; sx++)
            if (inside(ctx, x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) n++;
      blend(c, x, y, rgb, (double)n / (SS * SS));
    }
  }
}

struct rr { double x, y, w, h, r; };
static int in_rr(const void *v, double px, double py) {
  const struct rr *s = v;
  double qx = maxd(maxd(s->x + s->r - px, 0), px - (s->x + s->w - s->r));
  double qy = maxd(maxd(s->y + s->r - py, 0), py - (s->y + s->h - s->r));
  return px >= s->x && px <= s->x + s->w && py >= s->y && py <= s->y + s->h && qx * qx + qy * qy <= s->r * s->r;
}

/* inside the rectangle less its corners: the band clear of the corners across, or the one down */
static int whole_rr(const void *v, int x, int y) {
  const struct rr *s = v;
  if (s->r < 0) return 0;
  int across = x >= s->x + s->r && x + 1 <= s->x + s->w - s->r && y >= s->y && y + 1 <= s->y + s->h;
  int down = x >= s->x && x + 1 <= s->x + s->w && y >= s->y + s->r && y + 1 <= s->y + s->h - s->r;
  return across || down;
}

void omx_round_rect(omx_canvas *c, double x, double y, double w, double h, double r, omx_rgb rgb) {
  struct rr s = {omx_snap(x), omx_snap(y), omx_snap(w), omx_snap(h), omx_snap(r)};
  fill_shape(c, s.x, s.y, s.x + s.w, s.y + s.h, in_rr, whole_rr, &s, rgb);
}

struct dc { double cx, cy, r; };
static int in_disc(const void *v, double px, double py) {
  const struct dc *s = v;
  return (px - s->cx) * (px - s->cx) + (py - s->cy) * (py - s->cy) <= s->r * s->r;
}

/* every corner of the pixel inside: the disc is convex, so every sample is */
static int whole_disc(const void *v, int x, int y) {
  return in_disc(v, x, y) && in_disc(v, x + 1, y) && in_disc(v, x, y + 1) && in_disc(v, x + 1, y + 1);
}

void omx_disc(omx_canvas *c, double cx, double cy, double r, omx_rgb rgb) {
  struct dc s = {omx_snap(cx), omx_snap(cy), omx_snap(r)};
  fill_shape(c, s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r, in_disc, whole_disc, &s, rgb);
}

struct sg { double ax, ay, dx, dy, len2, hw; };
static int in_seg(const void *v, double px, double py) {
  const struct sg *s = v;
  double t = s->len2 == 0 ? 0 : maxd(0, mind(1, ((px - s->ax) * s->dx + (py - s->ay) * s->dy) / s->len2));
  double ex = px - s->ax - t * s->dx, ey = py - s->ay - t * s->dy;
  return ex * ex + ey * ey <= s->hw * s->hw;
}

void omx_segment(omx_canvas *c, double ax, double ay, double bx, double by, double hw, omx_rgb rgb) {
  ax = omx_snap(ax), ay = omx_snap(ay), bx = omx_snap(bx), by = omx_snap(by), hw = omx_snap(hw);
  double dx = bx - ax, dy = by - ay;
  struct sg s = {ax, ay, dx, dy, dx * dx + dy * dy, hw};
  fill_shape(c, mind(ax, bx) - hw, mind(ay, by) - hw, maxd(ax, bx) + hw, maxd(ay, by) + hw, in_seg, NULL, &s, rgb);
}

/* ------------------------------------------------------------------------------------- text */

/* The TrueType reader: head, maxp, hhea, hmtx, cmap (format 4 and 12), loca and glyf, composites
 * included; quadratic curves flattened by CURVE_STEPS straight segments, in plain +, -, *, / on
 * doubles, as tools/font.mjs does, so the same file gives the same outline everywhere. */

#define CURVE_STEPS 8

typedef struct { double x, y; } pt;
typedef struct { pt *p; size_t n; } poly;

typedef struct glyph {
  uint32_t cp;
  int advance;
  poly *polys;
  size_t npolys;
} glyph;

struct omx_font {
  uint8_t *b;
  size_t size;
  uint32_t head, maxp, hhea, hmtx, cmap, loca, glyf, cmap_at;
  int units_per_em, long_loca, num_glyphs, num_hmetrics;
  glyph *cache;
  size_t ncache, capcache;
};

static unsigned u8(const omx_font *f, size_t o) { return o < f->size ? f->b[o] : 0; }
static unsigned u16(const omx_font *f, size_t o) { return (u8(f, o) << 8) | u8(f, o + 1); }
static int s16(const omx_font *f, size_t o) { return (int16_t)u16(f, o); }
static uint32_t u32(const omx_font *f, size_t o) { return ((uint32_t)u16(f, o) << 16) | u16(f, o + 2); }
static int s8(const omx_font *f, size_t o) { return (int8_t)u8(f, o); }

static void set_err(char *err, size_t n, const char *msg) {
  if (err && n) {
    strncpy(err, msg, n - 1);
    err[n - 1] = 0;
  }
}

omx_font *omx_font_load(const uint8_t *bytes, size_t size, char *err, size_t err_size) {
  omx_font *f = calloc(1, sizeof *f);
  if (!f) return NULL;
  f->b = malloc(size ? size : 1);
  if (!f->b) { free(f); return NULL; }
  memcpy(f->b, bytes, size);
  f->size = size;
  if (size < 12 || (u32(f, 0) != 0x00010000 && memcmp(f->b, "true", 4) != 0)) {
    set_err(err, err_size, "font: not a TrueType (glyf) font file");
    omx_font_free(f);
    return NULL;
  }
  uint32_t *slot[] = {&f->head, &f->maxp, &f->hhea, &f->hmtx, &f->cmap, &f->loca, &f->glyf};
  const char *names[] = {"head", "maxp", "hhea", "hmtx", "cmap", "loca", "glyf"};
  int found[7] = {0};
  for (unsigned i = 0, n = u16(f, 4); i < n; i++) {
    size_t rec = 12 + (size_t)i * 16;
    for (int t = 0; t < 7; t++)
      if (rec + 4 <= size && memcmp(f->b + rec, names[t], 4) == 0) *slot[t] = u32(f, rec + 8), found[t] = 1;
  }
  for (int t = 0; t < 7; t++)
    if (!found[t]) {
      char m[64];
      snprintf(m, sizeof m, "font: no '%s' table", names[t]);
      set_err(err, err_size, m);
      omx_font_free(f);
      return NULL;
    }
  f->units_per_em = u16(f, f->head + 18);
  f->long_loca = s16(f, f->head + 50) == 1;
  f->num_glyphs = u16(f, f->maxp + 4);
  f->num_hmetrics = u16(f, f->hhea + 34);
  long at = -1;
  for (unsigned i = 0, n = u16(f, f->cmap + 2); i < n; i++) {
    size_t rec = f->cmap + 4 + (size_t)i * 8;
    unsigned pid = u16(f, rec), eid = u16(f, rec + 2);
    size_t off = f->cmap + u32(f, rec + 4);
    unsigned fmt = u16(f, off);
    if (pid == 3 && eid == 10 && fmt == 12) { at = (long)off; break; }
    if (((pid == 3 && eid == 1) || pid == 0) && (fmt == 4 || fmt == 12) && at < 0) at = (long)off;
  }
  if (at < 0 || f->units_per_em == 0) {
    set_err(err, err_size, "font: no Unicode cmap");
    omx_font_free(f);
    return NULL;
  }
  f->cmap_at = (uint32_t)at;
  return f;
}

void omx_font_free(omx_font *f) {
  if (!f) return;
  for (size_t i = 0; i < f->ncache; i++) {
    for (size_t k = 0; k < f->cache[i].npolys; k++) free(f->cache[i].polys[k].p);
    free(f->cache[i].polys);
  }
  free(f->cache);
  free(f->b);
  free(f);
}

static unsigned glyph_of(const omx_font *f, uint32_t cp) {
  size_t c = f->cmap_at;
  if (u16(f, c) == 12) {
    for (uint32_t i = 0, n = u32(f, c + 12); i < n; i++) {
      size_t o = c + 16 + (size_t)i * 12;
      uint32_t lo = u32(f, o), hi = u32(f, o + 4);
      if (cp >= lo && cp <= hi) return u32(f, o + 8) + cp - lo;
    }
    return 0;
  }
  unsigned segs = u16(f, c + 6) / 2;
  size_t ends = c + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
  for (unsigned i = 0; i < segs; i++) {
    if (cp > u16(f, ends + i * 2)) continue;
    if (cp < u16(f, starts + i * 2)) return 0;
    unsigned ro = u16(f, ranges + i * 2);
    int delta = s16(f, deltas + i * 2);
    if (ro == 0) return (cp + delta) & 0xffff;
    unsigned g = u16(f, ranges + i * 2 + ro + (cp - u16(f, starts + i * 2)) * 2);
    return g == 0 ? 0 : (g + delta) & 0xffff;
  }
  return 0;
}

static long glyph_at(const omx_font *f, unsigned g) {
  size_t a = f->long_loca ? u32(f, f->loca + 4 * (size_t)g) : (size_t)u16(f, f->loca + 2 * (size_t)g) * 2;
  size_t b = f->long_loca ? u32(f, f->loca + 4 * (size_t)g + 4) : (size_t)u16(f, f->loca + 2 * (size_t)g + 2) * 2;
  return b > a ? (long)(f->glyf + a) : -1;
}

/* A contour of points, each with its on-curve flag. */
typedef struct { double x, y; int on; } cpt;
typedef struct { cpt *p; size_t n; } contour;
typedef struct { contour *c; size_t n, cap; } contours;

static void push_contour(contours *cs, contour c) {
  if (cs->n == cs->cap) {
    cs->cap = cs->cap ? cs->cap * 2 : 8;
    cs->c = realloc(cs->c, cs->cap * sizeof *cs->c);
  }
  cs->c[cs->n++] = c;
}

static void points(const omx_font *f, unsigned g, const double m[6], int depth, contours *out) {
  if ((int)g >= f->num_glyphs || depth > 6) return;
  long at = glyph_at(f, g);
  if (at < 0) return;
  int ncontours = s16(f, at);
  if (ncontours < 0) {
    size_t o = at + 10;
    int more = 1;
    while (more) {
      unsigned flags = u16(f, o), sub = u16(f, o + 2);
      o += 4;
      double dx, dy;
      if (flags & 1) { dx = s16(f, o); dy = s16(f, o + 2); o += 4; } else { dx = s8(f, o); dy = s8(f, o + 1); o += 2; }
      if (!(flags & 2)) dx = dy = 0;
      double a = 1, b = 0, c = 0, d = 1;
      if (flags & 8) { a = d = s16(f, o) / 16384.0; o += 2; }
      else if (flags & 0x40) { a = s16(f, o) / 16384.0; d = s16(f, o + 2) / 16384.0; o += 4; }
      else if (flags & 0x80) { a = s16(f, o) / 16384.0; b = s16(f, o + 2) / 16384.0; c = s16(f, o + 4) / 16384.0; d = s16(f, o + 6) / 16384.0; o += 8; }
      double child[6] = {a * m[0] + b * m[2], a * m[1] + b * m[3], c * m[0] + d * m[2], c * m[1] + d * m[3],
                         dx * m[0] + dy * m[2] + m[4], dx * m[1] + dy * m[3] + m[5]};
      points(f, sub, child, depth + 1, out);
      more = (flags & 0x20) != 0;
    }
    return;
  }
  if (ncontours == 0) return;
  unsigned *ends = malloc(sizeof *ends * ncontours);
  size_t o = at + 10;
  for (int i = 0; i < ncontours; i++, o += 2) ends[i] = u16(f, o);
  size_t n = ends[ncontours - 1] + 1;
  o += 2 + u16(f, o);
  uint8_t *flags = malloc(n);
  size_t k = 0;
  while (k < n) {
    uint8_t fl = (uint8_t)u8(f, o++);
    flags[k++] = fl;
    if (fl & 8)
      for (unsigned r = u8(f, o++); r > 0 && k < n; r--) flags[k++] = fl;
  }
  double *xs = malloc(sizeof *xs * n), *ys = malloc(sizeof *ys * n);
  for (int axis = 0; axis < 2; axis++) {
    unsigned shortf = axis ? 4 : 2, same = axis ? 32 : 16;
    double *dst = axis ? ys : xs;
    long val = 0;
    for (size_t i = 0; i < n; i++) {
      uint8_t fl = flags[i];
      if (fl & shortf) { unsigned d = u8(f, o++); val += (fl & same) ? (long)d : -(long)d; }
      else if (!(fl & same)) { val += s16(f, o); o += 2; }
      dst[i] = (double)val;
    }
  }
  size_t first = 0;
  for (int c = 0; c < ncontours; c++) {
    contour ct = {NULL, 0};
    if (ends[c] + 1 > first) {
      ct.n = ends[c] + 1 - first;
      ct.p = malloc(sizeof *ct.p * ct.n);
      for (size_t i = first; i <= ends[c]; i++)
        ct.p[i - first] = (cpt){xs[i] * m[0] + ys[i] * m[2] + m[4], xs[i] * m[1] + ys[i] * m[3] + m[5], flags[i] & 1};
    }
    push_contour(out, ct);
    first = ends[c] + 1;
  }
  free(ends), free(flags), free(xs), free(ys);
}

/* A closed polygon of a contour: start on an on-curve point, an implied on-curve point between two
 * off-curve ones, each curve cut into CURVE_STEPS segments. */
static poly outline(const contour *ct) {
  poly out = {NULL, 0};
  size_t n = ct->n;
  if (!n) return out;
  cpt *ring = malloc(sizeof *ring * n * 2);
  size_t rn = 0;
  for (size_t i = 0; i < n; i++) {
    cpt p = ct->p[i], q = ct->p[(i + 1) % n];
    ring[rn++] = p;
    if (!p.on && !q.on) ring[rn++] = (cpt){(p.x + q.x) / 2, (p.y + q.y) / 2, 1};
  }
  size_t s = 0;
  while (s < rn && !ring[s].on) s++;
  if (s == rn) s = 0;
  cpt *r = malloc(sizeof *r * rn);
  for (size_t i = 0; i < rn; i++) r[i] = ring[(s + i) % rn];
  out.p = malloc(sizeof *out.p * rn * CURVE_STEPS);
  for (size_t i = 0; i < rn; i++) {
    cpt p = r[i];
    if (p.on) { out.p[out.n++] = (pt){p.x, p.y}; continue; }
    cpt a = r[(i + rn - 1) % rn], b = r[(i + 1) % rn];
    for (int k = 1; k < CURVE_STEPS; k++) {
      double t = (double)k / CURVE_STEPS, u = 1 - t;
      out.p[out.n++] = (pt){u * u * a.x + 2 * u * t * p.x + t * t * b.x, u * u * a.y + 2 * u * t * p.y + t * t * b.y};
    }
  }
  free(ring), free(r);
  return out;
}

static const glyph *glyph_get(omx_font *f, uint32_t cp) {
  for (size_t i = 0; i < f->ncache; i++)
    if (f->cache[i].cp == cp) return &f->cache[i];
  if (f->ncache == f->capcache) {
    f->capcache = f->capcache ? f->capcache * 2 : 64;
    f->cache = realloc(f->cache, f->capcache * sizeof *f->cache);
  }
  unsigned g = glyph_of(f, cp);
  glyph *gl = &f->cache[f->ncache++];
  gl->cp = cp;
  gl->advance = (int)u16(f, f->hmtx + 4 * (size_t)((int)g < f->num_hmetrics ? (int)g : f->num_hmetrics - 1));
  contours cs = {NULL, 0, 0};
  const double id[6] = {1, 0, 0, 1, 0, 0};
  points(f, g, id, 0, &cs);
  gl->npolys = cs.n;
  gl->polys = malloc(sizeof *gl->polys * (cs.n ? cs.n : 1));
  for (size_t i = 0; i < cs.n; i++) {
    gl->polys[i] = outline(&cs.c[i]);
    free(cs.c[i].p);
  }
  free(cs.c);
  return gl;
}

size_t omx_utf8_decode(const char *s, uint32_t **out) {
  size_t len = s ? strlen(s) : 0, n = 0;
  uint32_t *cps = malloc(sizeof *cps * (len + 3));
  const unsigned char *p = (const unsigned char *)(s ? s : "");
  while (*p) {
    uint32_t c = *p++;
    int more = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
    if (more) c &= 0x3f >> more;
    while (more-- > 0 && (*p & 0xc0) == 0x80) c = (c << 6) | (*p++ & 0x3f);
    cps[n++] = c;
  }
  *out = cps;
  return n;
}

double omx_text_width(omx_font *f, const uint32_t *cps, size_t n, double px) {
  double w = 0;
  for (size_t i = 0; i < n; i++) w += omx_snap((glyph_get(f, cps[i])->advance * px) / f->units_per_em);
  return w;
}

size_t omx_fit_text(omx_font *f, uint32_t *cps, size_t n, double px, double max_w) {
  if (omx_text_width(f, cps, n, px) <= max_w) return n;
  while (n > 1) {
    cps[n] = '.', cps[n + 1] = '.';
    if (omx_text_width(f, cps, n + 2, px) <= max_w) break;
    n--;
  }
  cps[n] = '.', cps[n + 1] = '.';
  return n + 2;
}

struct edges { double *e; size_t n; };
static int in_glyph(const void *v, double px, double py) {
  const struct edges *s = v;
  int wn = 0;
  for (size_t i = 0; i < s->n; i++) {
    double ax = s->e[4 * i], ay = s->e[4 * i + 1], bx = s->e[4 * i + 2], by = s->e[4 * i + 3];
    if ((ay <= py) == (by <= py)) continue;
    double cross = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py ? cross > 0 : cross < 0) wn += ay <= py ? 1 : -1;
  }
  return wn != 0;
}

/* A glyph filled as fill_shape would fill it, sample for sample: for each row of samples only the edges that cross
 * it are tested, which is what the winding test keeps anyway, so the coverage is the same and costs a fraction. */
static void fill_glyph(omx_canvas *c, double bx0, double by0, double bx1, double by1, const struct edges *es, omx_rgb rgb) {
  int x0 = (int)maxd(0, floor(bx0)), y0 = (int)maxd(0, floor(by0));
  int x1 = (int)mind(c->w, ceil(bx1)), y1 = (int)mind(c->h, ceil(by1));
  if (x1 <= x0 || y1 <= y0) return;
  int *count = malloc(sizeof *count * (size_t)(x1 - x0));
  struct edges row = {malloc(sizeof(double) * 4 * es->n), 0};
  for (int y = y0; y < y1; y++) {
    memset(count, 0, sizeof *count * (size_t)(x1 - x0));
    for (int sy = 0; sy < SS; sy++) {
      double py = y + (sy + 0.5) / SS;
      row.n = 0;
      for (size_t i = 0; i < es->n; i++)
        if ((es->e[4 * i + 1] <= py) != (es->e[4 * i + 3] <= py)) memcpy(row.e + 4 * row.n++, es->e + 4 * i, sizeof(double) * 4);
      if (!row.n) continue;
      for (int x = x0; x < x1; x++)
        for (int sx = 0; sx < SS; sx++)
          if (in_glyph(&row, x + (sx + 0.5) / SS, py)) count[x - x0]++;
    }
    for (int x = x0; x < x1; x++) blend(c, x, y, rgb, (double)count[x - x0] / (SS * SS));
  }
  free(count), free(row.e);
}

void omx_draw_text(omx_canvas *c, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb,
                   omx_align align) {
  double w = omx_text_width(f, cps, n, px);
  double pen = omx_snap(align == OMX_ALIGN_CENTRE ? x - w / 2 : align == OMX_ALIGN_RIGHT ? x - w : x);
  double k = px / f->units_per_em;
  for (size_t i = 0; i < n; i++) {
    const glyph *g = glyph_get(f, cps[i]);
    size_t total = 0;
    for (size_t p = 0; p < g->npolys; p++) total += g->polys[p].n;
    struct edges es = {malloc(sizeof(double) * 4 * (total ? total : 1)), 0};
    double x0 = INFINITY, y0 = INFINITY, x1 = -INFINITY, y1 = -INFINITY;
    for (size_t p = 0; p < g->npolys; p++) {
      const poly *pl = &g->polys[p];
      for (size_t j = 0; j < pl->n; j++) {
        const pt *a0 = &pl->p[j], *b0 = &pl->p[(j + 1) % pl->n];
        double ax = omx_snap(pen + a0->x * k), ay = omx_snap(y - a0->y * k);
        double bx = omx_snap(pen + b0->x * k), by = omx_snap(y - b0->y * k);
        x0 = mind(x0, ax), x1 = maxd(x1, ax), y0 = mind(y0, ay), y1 = maxd(y1, ay);
        if (ay != by) {
          double *e = es.e + 4 * es.n++;
          e[0] = ax, e[1] = ay, e[2] = bx, e[3] = by;
        }
      }
    }
    if (es.n) fill_glyph(c, x0, y0, x1, y1, &es, rgb);
    free(es.e);
    pen += omx_snap(g->advance * k);
  }
}
