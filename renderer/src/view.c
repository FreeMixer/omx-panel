/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * view.c — a panel description laid out and drawn: the head, each section in order, each control in
 * its cell by its standard widget, its label and the text its plugin gives for its value. The layout
 * and the widgets are the MOD GUI face's (tools/modgui-gen.mjs: layout, renderFace, drawKnob ...), the
 * numbers tools/look/geometry.json's and the colours tools/look.json's; nothing here types a size or
 * a colour. The widget names are omx-contract's (PANEL_STANDARD_WIDGETS).
 */
#include "omx_panel_render.h"

#include <cjson/cJSON.h>
#include <math.h>
#include <omxcontract/omx_vocabulary.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "draw.h"

typedef enum { W_KNOB, W_FADER, W_SWITCH, W_SELECTOR, W_METER, W_CURVE, W_XY, W_DISPLAY } widget;

/* The standard widgets by omx-contract's names (PANEL_STANDARD_WIDGETS): a widget it adds is drawn
 * here before the count below lets this file build. */
static const struct { const char *name; widget w; } WIDGET_NAMES[] = {
    {OMX_PANEL_STANDARD_WIDGETS_KNOB, W_KNOB},       {OMX_PANEL_STANDARD_WIDGETS_FADER, W_FADER},
    {OMX_PANEL_STANDARD_WIDGETS_SWITCH, W_SWITCH},   {OMX_PANEL_STANDARD_WIDGETS_SELECTOR, W_SELECTOR},
    {OMX_PANEL_STANDARD_WIDGETS_METER, W_METER},     {OMX_PANEL_STANDARD_WIDGETS_CURVE, W_CURVE},
    {OMX_PANEL_STANDARD_WIDGETS_XY, W_XY},           {OMX_PANEL_STANDARD_WIDGETS_DISPLAY, W_DISPLAY},
};
_Static_assert(sizeof WIDGET_NAMES / sizeof *WIDGET_NAMES == OMX_PANEL_STANDARD_WIDGETS_COUNT,
               "every standard widget of omx-contract is drawn");

typedef struct {
  char *symbol, *label;
  int section;
  widget w;
  double fraction;
  char *text;
  uint32_t at, count;
  /* visibility (the description's visibleWhen and mask): shown while bit `value` of `mask` is set, `value` the
   * governing control's current integer; `gov` NULL for a control always shown */
  char *gov;
  uint64_t mask;
  int64_t value;
} control;

typedef struct {
  double pad, headH, sectionTop, sectionGap, sectionPad, sectionTitleH, cellW, cellH, knob, knobTop, switchW, switchH,
      switchTop, selectorW, selectorH, selectorTop, faderW, faderCap, radius, sectionRadius;
} geometry;

typedef struct {
  double brand, brandBase, title, titleBase, small, sectionBase, nameBase, valueBase;
} textsizes;

typedef struct {
  omx_rgb surface, section, body, rim, ink, inkDim, accent;
} palette;

struct omx_panel_view {
  char **sections;
  size_t nsections;
  control *controls;
  size_t ncontrols;
  char *brand, *name;
  int row_controls;
  geometry g;
  textsizes t;
  palette col;
  omx_font *font;
};

static void fail(char *err, size_t n, const char *fmt, const char *a, const char *b) {
  if (err && n) snprintf(err, n, fmt, a ? a : "", b ? b : "");
}

static char *dup(const char *s) {
  size_t n = strlen(s ? s : "");
  char *d = malloc(n + 1);
  if (d) memcpy(d, s ? s : "", n + 1);
  return d;
}

static int hex_colour(const char *s, omx_rgb *out) {
  if (!s || strlen(s) != 7 || s[0] != '#') return 0;
  unsigned v;
  char *end;
  v = (unsigned)strtoul(s + 1, &end, 16);
  if (*end) return 0;
  out->c[0] = (v >> 16) & 255, out->c[1] = (v >> 8) & 255, out->c[2] = v & 255;
  return 1;
}

static int read_look(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *tok = cJSON_GetObjectItemCaseSensitive(root, "tokens");
  struct { const char *name; omx_rgb *to; } want[] = {
      {"--surface", &v->col.surface}, {"--surface-2", &v->col.section}, {"--surface-3", &v->col.body},
      {"--border-strong", &v->col.rim}, {"--ink", &v->col.ink},       {"--ink-dim", &v->col.inkDim},
      {"--accent", &v->col.accent},
  };
  if (!cJSON_IsObject(tok)) {
    fail(err, n, "look: no tokens object%s%s", NULL, NULL);
    cJSON_Delete(root);
    return 0;
  }
  for (size_t i = 0; i < sizeof want / sizeof *want; i++) {
    const char *s = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(tok, want[i].name));
    if (!hex_colour(s, want[i].to)) {
      fail(err, n, "look: %s is not a #rrggbb colour%s", want[i].name, NULL);
      cJSON_Delete(root);
      return 0;
    }
  }
  cJSON_Delete(root);
  return 1;
}

#define NUM(obj, field, dst, what)                                                                                    \
  do {                                                                                                                \
    cJSON *x_ = cJSON_GetObjectItemCaseSensitive(obj, #field);                                                        \
    if (!cJSON_IsNumber(x_)) {                                                                                        \
      fail(err, n, "geometry: %s.%s is not a number", what, #field);                                                  \
      goto bad;                                                                                                       \
    }                                                                                                                 \
    (dst)->field = x_->valuedouble;                                                                                   \
  } while (0)

static int read_geometry(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *g = cJSON_GetObjectItemCaseSensitive(root, "geometry"), *t = cJSON_GetObjectItemCaseSensitive(root, "text");
  cJSON *row = cJSON_GetObjectItemCaseSensitive(root, "rowControls");
  if (!cJSON_IsNumber(row) || row->valueint < 1) {
    fail(err, n, "geometry: rowControls is not a whole number of at least 1%s%s", NULL, NULL);
    goto bad;
  }
  v->row_controls = row->valueint;
  NUM(g, pad, &v->g, "geometry"); NUM(g, headH, &v->g, "geometry"); NUM(g, sectionTop, &v->g, "geometry");
  NUM(g, sectionGap, &v->g, "geometry"); NUM(g, sectionPad, &v->g, "geometry"); NUM(g, sectionTitleH, &v->g, "geometry");
  NUM(g, cellW, &v->g, "geometry"); NUM(g, cellH, &v->g, "geometry"); NUM(g, knob, &v->g, "geometry");
  NUM(g, knobTop, &v->g, "geometry"); NUM(g, switchW, &v->g, "geometry"); NUM(g, switchH, &v->g, "geometry");
  NUM(g, switchTop, &v->g, "geometry"); NUM(g, selectorW, &v->g, "geometry"); NUM(g, selectorH, &v->g, "geometry");
  NUM(g, selectorTop, &v->g, "geometry"); NUM(g, faderW, &v->g, "geometry"); NUM(g, faderCap, &v->g, "geometry");
  NUM(g, radius, &v->g, "geometry"); NUM(g, sectionRadius, &v->g, "geometry");
  NUM(t, brand, &v->t, "text"); NUM(t, brandBase, &v->t, "text"); NUM(t, title, &v->t, "text");
  NUM(t, titleBase, &v->t, "text"); NUM(t, small, &v->t, "text"); NUM(t, sectionBase, &v->t, "text");
  NUM(t, nameBase, &v->t, "text"); NUM(t, valueBase, &v->t, "text");
  cJSON_Delete(root);
  return 1;
bad:
  cJSON_Delete(root);
  return 0;
}

static int read_description(omx_panel_view_t *v, const char *json, char *err, size_t n) {
  cJSON *root = cJSON_Parse(json);
  cJSON *secs = cJSON_GetObjectItemCaseSensitive(root, "sections"), *ctls = cJSON_GetObjectItemCaseSensitive(root, "controls");
  if (!cJSON_IsArray(secs) || !cJSON_IsArray(ctls)) {
    fail(err, n, "description: not a panel description (no sections and controls arrays)%s%s", NULL, NULL);
    goto bad;
  }
  v->nsections = (size_t)cJSON_GetArraySize(secs);
  v->sections = calloc(v->nsections ? v->nsections : 1, sizeof *v->sections);
  size_t i = 0;
  cJSON *it;
  cJSON_ArrayForEach(it, secs) {
    const char *label = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "label"));
    if (!label) {
      fail(err, n, "description: a section has no label%s%s", NULL, NULL);
      goto bad;
    }
    v->sections[i++] = dup(label);
  }
  v->ncontrols = (size_t)cJSON_GetArraySize(ctls);
  v->controls = calloc(v->ncontrols ? v->ncontrols : 1, sizeof *v->controls);
  i = 0;
  cJSON_ArrayForEach(it, ctls) {
    control *c = &v->controls[i++];
    const char *sym = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "symbol"));
    const char *label = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "label"));
    cJSON *sec = cJSON_GetObjectItemCaseSensitive(it, "section");
    const char *w = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(it, "standard"), "widget"));
    if (!sym || !label || !cJSON_IsNumber(sec) || sec->valueint < 0 || (size_t)sec->valueint >= v->nsections || !w) {
      fail(err, n, "description: control '%s' lacks a symbol, a label, a section or a standard widget%s", sym, NULL);
      goto bad;
    }
    int found = -1;
    for (size_t k = 0; k < sizeof WIDGET_NAMES / sizeof *WIDGET_NAMES; k++)
      if (strcmp(w, WIDGET_NAMES[k].name) == 0) found = (int)WIDGET_NAMES[k].w;
    if (found < 0) {
      fail(err, n, "description: control '%s' names the widget '%s', which is not a standard widget", sym, w);
      goto bad;
    }
    c->symbol = dup(sym), c->label = dup(label), c->section = sec->valueint, c->w = (widget)found;
    c->text = dup(""), c->at = 0, c->count = 1, c->fraction = 0;
    cJSON *vis = cJSON_GetObjectItemCaseSensitive(it, "visibleWhen");
    if (vis && !cJSON_IsNull(vis)) {
      const char *gov = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(vis, "symbol"));
      cJSON *def = cJSON_GetObjectItemCaseSensitive(vis, "default");
      const char *mask = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(it, "mask"));
      char *end = NULL;
      unsigned long long m = mask ? strtoull(mask, &end, 16) : 0;
      if (!gov || !cJSON_IsNumber(def) || !mask || !*mask || *end) {
        fail(err, n, "description: control '%s' has a visibleWhen without its symbol, default or hex mask%s", sym, NULL);
        goto bad;
      }
      c->gov = dup(gov), c->mask = (uint64_t)m, c->value = (int64_t)def->valuedouble;
    }
  }
  cJSON_Delete(root);
  return 1;
bad:
  cJSON_Delete(root);
  return 0;
}

omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *src, char *err, size_t n) {
  if (!src || !src->description_json || !src->look_json || !src->geometry_json || !src->font) {
    fail(err, n, "sources: the description, the look, the geometry and the font are all needed%s%s", NULL, NULL);
    return NULL;
  }
  omx_panel_view_t *v = calloc(1, sizeof *v);
  if (!v) return NULL;
  v->brand = dup(""), v->name = dup("");
  if (!read_look(v, src->look_json, err, n) || !read_geometry(v, src->geometry_json, err, n) ||
      !read_description(v, src->description_json, err, n) || !(v->font = omx_font_load(src->font, src->font_size, err, n))) {
    omx_panel_view_destroy(v);
    return NULL;
  }
  return v;
}

static char *slurp(const char *path, size_t *size) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  char *buf = NULL;
  size_t len = 0, cap = 0, got;
  do {
    if (len + 65536 + 1 > cap) {
      cap = (len + 65536 + 1) * 2;
      char *nb = realloc(buf, cap);
      if (!nb) { free(buf); fclose(f); return NULL; }
      buf = nb;
    }
    got = fread(buf + len, 1, 65536, f);
    len += got;
  } while (got > 0);
  fclose(f);
  buf[len] = 0;
  if (size) *size = len;
  return buf;
}

omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir, char *err, size_t n) {
  char look_path[4096], geom_path[4096], font_path[4096];
  snprintf(look_path, sizeof look_path, "%s/look.json", data_dir);
  snprintf(geom_path, sizeof geom_path, "%s/look/geometry.json", data_dir);
  omx_panel_view_t *v = NULL;
  size_t font_size = 0;
  char *desc = slurp(description_path, NULL), *look = slurp(look_path, NULL), *geom = slurp(geom_path, NULL), *font = NULL;
  if (!desc) { fail(err, n, "cannot read %s%s", description_path, NULL); goto out; }
  if (!look) { fail(err, n, "cannot read %s%s", look_path, NULL); goto out; }
  if (!geom) { fail(err, n, "cannot read %s%s", geom_path, NULL); goto out; }
  {
    /* the font file is the look's --font-file, relative to the tools directory, and never leaves it */
    cJSON *root = cJSON_Parse(look);
    const char *ff = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(root, "tokens"), "--font-file"));
    if (!ff || ff[0] == '/' || strstr(ff, "..")) {
      fail(err, n, "look: --font-file is missing or leaves %s%s", data_dir, NULL);
      cJSON_Delete(root);
      goto out;
    }
    snprintf(font_path, sizeof font_path, "%s/%s", data_dir, ff);
    cJSON_Delete(root);
  }
  font = slurp(font_path, &font_size);
  if (!font) { fail(err, n, "cannot read %s%s", font_path, NULL); goto out; }
  omx_panel_sources_t s = {desc, look, geom, (const uint8_t *)font, font_size};
  v = omx_panel_view_create(&s, err, n);
out:
  free(desc), free(look), free(geom), free(font);
  return v;
}

void omx_panel_view_destroy(omx_panel_view_t *v) {
  if (!v) return;
  for (size_t i = 0; i < v->nsections; i++) free(v->sections[i]);
  for (size_t i = 0; i < v->ncontrols; i++)
    free(v->controls[i].symbol), free(v->controls[i].label), free(v->controls[i].text), free(v->controls[i].gov);
  free(v->sections), free(v->controls), free(v->brand), free(v->name);
  omx_font_free(v->font);
  free(v);
}

uint32_t omx_panel_view_count(const omx_panel_view_t *v) { return v ? (uint32_t)v->ncontrols : 0; }

int32_t omx_panel_view_find(const omx_panel_view_t *v, const char *symbol) {
  for (size_t i = 0; v && symbol && i < v->ncontrols; i++)
    if (strcmp(v->controls[i].symbol, symbol) == 0) return (int32_t)i;
  return -1;
}

void omx_panel_view_set_title(omx_panel_view_t *v, const char *brand, const char *name) {
  if (!v) return;
  free(v->brand), free(v->name);
  v->brand = dup(brand), v->name = dup(name);
}

bool omx_panel_view_set_value(omx_panel_view_t *v, uint32_t i, double fraction, const char *text) {
  if (!v || i >= v->ncontrols || fraction != fraction) return false;
  control *c = &v->controls[i];
  c->fraction = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  free(c->text);
  c->text = dup(text);
  return true;
}

bool omx_panel_view_set_choice(omx_panel_view_t *v, uint32_t i, uint32_t at, uint32_t count, const char *text) {
  if (!v || i >= v->ncontrols || count == 0 || at >= count) return false;
  control *c = &v->controls[i];
  c->at = at, c->count = count;
  c->fraction = count > 1 ? (double)at / (count - 1) : 0;
  free(c->text);
  c->text = dup(text);
  return true;
}

/* Whether control `c` is shown at its governing control's current value. */
static int shown(const control *c) { return !c->gov || (c->value >= 0 && c->value <= 63 && ((c->mask >> c->value) & 1u)); }

bool omx_panel_view_set_integer(omx_panel_view_t *v, const char *symbol, int64_t value) {
  bool governs = false;
  for (size_t i = 0; v && symbol && i < v->ncontrols; i++)
    if (v->controls[i].gov && strcmp(v->controls[i].gov, symbol) == 0) v->controls[i].value = value, governs = true;
  return governs;
}

bool omx_panel_view_visible(const omx_panel_view_t *v, uint32_t i) { return v && i < v->ncontrols && shown(&v->controls[i]); }

/* ------------------------------------------------------------------------------------ layout */

typedef struct { double x, y, w, h; } box;
typedef struct {
  double w, h;
  box *sections;     /* one per section */
  double *cx, *cy;   /* each control's cell, relative to its section */
  char *drawn;       /* one per section: 0 for a section whose every control is hidden, which takes no space */
} laid;

/* Every box of the face, in logical px, with `per_row` controls a row (tools/modgui-gen.mjs layout). */
static laid lay_out(const omx_panel_view_t *v, int per_row) {
  const geometry *g = &v->g;
  laid L = {0, 0, calloc(v->nsections ? v->nsections : 1, sizeof(box)), calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)),
            calloc(v->ncontrols ? v->ncontrols : 1, sizeof(double)), calloc(v->nsections ? v->nsections : 1, 1)};
  /* a hidden control takes no cell; a section the values empty takes no space (one declared empty keeps its title) */
  size_t most = 0;
  for (size_t s = 0; s < v->nsections; s++) {
    size_t k = 0, all = 0;
    for (size_t i = 0; i < v->ncontrols; i++)
      if (v->controls[i].section == (int)s) all++, k += shown(&v->controls[i]);
    L.drawn[s] = k > 0 || all == 0;
    if (k > most) most = k;
  }
  if (most > (size_t)per_row) most = (size_t)per_row;
  double section_w = most * g->cellW + 2 * g->sectionPad, y = g->sectionTop;
  double last = -1;
  for (size_t s = 0; s < v->nsections; s++) {
    if (!L.drawn[s]) continue;
    size_t j = 0;
    for (size_t i = 0; i < v->ncontrols; i++) {
      if (v->controls[i].section != (int)s || !shown(&v->controls[i])) continue;
      L.cx[i] = g->sectionPad + (double)(j % per_row) * g->cellW;
      L.cy[i] = g->sectionTitleH + floor((double)j / per_row) * g->cellH;
      j++;
    }
    double rows = ceil((double)j / per_row), h = g->sectionTitleH + rows * g->cellH + g->sectionPad / 2;
    L.sections[s] = (box){g->pad, y, section_w, h};
    last = y + h;
    y += h + g->sectionGap;
  }
  L.w = section_w + 2 * g->pad;
  L.h = last >= 0 ? last + g->pad : g->sectionTop + g->pad;
  return L;
}

static void lay_free(laid *L) { free(L->sections), free(L->cx), free(L->cy), free(L->drawn); }

void omx_panel_view_natural_size(const omx_panel_view_t *v, uint32_t *w, uint32_t *h) {
  if (!v) return;
  laid L = lay_out(v, v->row_controls);
  if (w) *w = (uint32_t)ceil(L.w);
  if (h) *h = (uint32_t)ceil(L.h);
  lay_free(&L);
}

/* ----------------------------------------------------------------------------------- drawing */

/* The widgets, each one drawing over the backend's primitives: the same calls reach the CPU raster (a buffer) and
 * NanoVG (a window), so both draw one layout with one widget code. */

static void draw_knob(const omx_draw *d, double cx, double cy, double r, double f, const palette *col) {
  d->disc(d->ctx, cx, cy, r, col->rim);
  d->disc(d->ctx, cx, cy, r - fmax(1, r * 0.08), col->body);
  double th = (-135 + 270 * fmin(1, fmax(0, f))) * (M_PI / 180);
  double sx = sin(th), sy = -cos(th);
  d->segment(d->ctx, cx + sx * r * 0.28, cy + sy * r * 0.28, cx + sx * r * 0.78, cy + sy * r * 0.78, fmax(0.75, r * 0.08), col->accent);
}

static void draw_selector(const omx_draw *d, double x, double y, double w, double h, double at, double n, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  double seg = (w - 4) / fmax(1, n);
  d->round_rect(d->ctx, x + 2 + at * seg, y + h - 4, fmax(1, seg), 2, 0, col->accent);
}

static void draw_fader(const omx_draw *d, const geometry *g, double cx, double top, double h, double f, const palette *col) {
  double slot = fmax(1, g->faderW * 0.25 * (h / g->knob));
  double cap = g->faderCap * (h / g->knob);
  d->round_rect(d->ctx, cx - slot / 2, top + cap / 2, slot, h - cap, slot / 2, col->rim);
  double y = top + (1 - fmin(1, fmax(0, f))) * (h - cap);
  d->round_rect(d->ctx, cx - (g->faderW * (h / g->knob)) / 2, y, g->faderW * (h / g->knob), cap, fmin(2, cap / 4), col->inkDim);
  d->round_rect(d->ctx, cx - (g->faderW * (h / g->knob)) / 2, y + cap / 2 - 0.5, g->faderW * (h / g->knob), 1, 0, col->accent);
}

/* A reading's frame; a meter fills it to its fraction along the foot. */
static void draw_display(const omx_draw *d, double x, double y, double w, double h, double fill, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, fmin(4, h / 4), col->rim);
  d->round_rect(d->ctx, x + 1, y + 1, w - 2, h - 2, fmin(3, h / 4), col->body);
  if (fill > 0) d->round_rect(d->ctx, x + 2, y + h - 4, (w - 4) * fill, 2, 0, col->accent);
}

static void draw_switch(const omx_draw *d, double x, double y, double w, double h, int on, const palette *col) {
  d->round_rect(d->ctx, x, y, w, h, h / 2, on ? col->accent : col->body);
  double r = h / 2 - h * 0.15;
  d->disc(d->ctx, on ? x + w - h / 2 : x + h / 2, y + h / 2, r, on ? col->ink : col->inkDim);
}

/* `s` as code points, upper-cased in ASCII (a section label and the brand are set in capitals). */
static size_t text_of(const char *s, int upper, uint32_t **out) {
  size_t n = omx_utf8_decode(s, out);
  if (upper)
    for (size_t i = 0; i < n; i++)
      if ((*out)[i] >= 'a' && (*out)[i] <= 'z') (*out)[i] -= 32;
  return n;
}

/* A line of text, cut to fit by the font's own advances whatever the backend: both cut it at the same character. */
static void text(const omx_draw *d, omx_font *f, const char *s, int upper, double fit, double x, double y, double px, omx_rgb rgb,
                 omx_align align) {
  uint32_t *cps;
  size_t n = text_of(s, upper, &cps);
  n = omx_fit_text(f, cps, n, px, fit);
  d->text(d->ctx, f, cps, n, x, y, px, rgb, align);
  free(cps);
}

/* The layout a box of width x height device px at `scale` gets, and the scale it is drawn at: the controls a row that
 * let the panel be drawn largest in the box, the most of them at a tie. At its natural size (or larger) the panel is
 * drawn as laid out; smaller than that it reflows, then shrinks. */
static laid place(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, double *s) {
  laid L = {0};
  double k = -1;
  for (int per_row = v->row_controls; per_row >= 1; per_row--) {
    laid T = lay_out(v, per_row);
    double kx = omx_round(T.w * scale) <= width ? 1 : width / (T.w * scale);
    double ky = omx_round(T.h * scale) <= height ? 1 : height / (T.h * scale);
    if (fmin(kx, ky) > k) {
      if (k >= 0) lay_free(&L);
      L = T, k = fmin(kx, ky);
    } else
      lay_free(&T);
  }
  *s = scale * k;
  return L;
}

bool omx_panel_view_control_rect(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, uint32_t index,
                                 double rect[4]) {
  if (!v || index >= v->ncontrols || !shown(&v->controls[index]) || !width || !height || !(scale > 0)) return false;
  double s;
  laid L = place(v, width, height, scale, &s);
  const box *sec = &L.sections[v->controls[index].section];
  rect[0] = (sec->x + L.cx[index]) * s, rect[1] = (sec->y + L.cy[index]) * s;
  rect[2] = v->g.cellW * s, rect[3] = v->g.cellH * s;
  lay_free(&L);
  return true;
}

void omx_panel_view_paint(const omx_panel_view_t *v, uint32_t width, uint32_t height, double scale, const omx_draw *d) {
  const geometry *g = &v->g;
  const textsizes *T = &v->t;
  const palette *col = &v->col;
  omx_font *font = v->font;
  double s;
  laid L = place(v, width, height, scale, &s);

  d->round_rect(d->ctx, 0, 0, L.w * s, L.h * s, g->radius * s, col->rim);
  d->round_rect(d->ctx, s, s, (L.w - 2) * s, (L.h - 2) * s, (g->radius - 1) * s, col->surface);
  d->round_rect(d->ctx, s, (g->headH - 2) * s, (L.w - 2) * s, 2 * s, 0, col->accent);
  d->disc(d->ctx, (L.w - g->pad - 10) * s, (g->headH / 2) * s, 5 * s, col->accent);
  double head_w = (L.w - 2 * g->pad - 24) * s;
  text(d, font, v->brand, 1, head_w, g->pad * s, T->brandBase * s, T->brand * s, col->inkDim, OMX_ALIGN_LEFT);
  text(d, font, v->name, 0, head_w, g->pad * s, T->titleBase * s, T->title * s, col->ink, OMX_ALIGN_LEFT);
  for (size_t si = 0; si < v->nsections; si++) {
    if (!L.drawn[si]) continue;
    box sec = L.sections[si];
    d->round_rect(d->ctx, sec.x * s, sec.y * s, sec.w * s, sec.h * s, g->sectionRadius * s, col->section);
    text(d, font, v->sections[si], 1, (sec.w - 2 * g->sectionPad) * s, (sec.x + g->sectionPad) * s, (sec.y + T->sectionBase) * s,
         T->small * s, col->inkDim, OMX_ALIGN_LEFT);
    for (size_t i = 0; i < v->ncontrols; i++) {
      const control *k = &v->controls[i];
      if (k->section != (int)si || !shown(k)) continue;
      double x = sec.x + L.cx[i], y = sec.y + L.cy[i];
      int reading = 0;
      switch (k->w) {
      case W_SWITCH:
        draw_switch(d, (x + (g->cellW - g->switchW) / 2) * s, (y + g->switchTop) * s, g->switchW * s, g->switchH * s, k->fraction >= 0.5, col);
        break;
      case W_SELECTOR:
        draw_selector(d, (x + (g->cellW - g->selectorW) / 2) * s, (y + g->selectorTop) * s, g->selectorW * s, g->selectorH * s, k->at, k->count, col);
        break;
      case W_FADER:
        draw_fader(d, g, (x + g->cellW / 2) * s, (y + g->knobTop) * s, g->knob * s, k->fraction, col);
        break;
      case W_KNOB:
        draw_knob(d, (x + g->cellW / 2) * s, (y + g->knobTop + g->knob / 2) * s, (g->knob / 2) * s, k->fraction, col);
        break;
      default: /* a meter fills its frame; a display, a curve and an xy pad show a frame until each has its own drawing */
        draw_display(d, (x + (g->cellW - g->selectorW) / 2) * s, (y + g->selectorTop) * s, g->selectorW * s, g->selectorH * s,
                     k->w == W_METER ? k->fraction : 0, col);
        reading = 1;
      }
      double mid = (x + g->cellW / 2) * s, w = (g->cellW - 4) * s;
      text(d, font, k->label, 0, w, mid, (y + T->nameBase) * s, T->small * s, col->inkDim, OMX_ALIGN_CENTRE);
      if (k->w == W_SELECTOR)
        text(d, font, k->text, 0, (g->selectorW - 8) * s, mid, (y + g->selectorTop + g->selectorH / 2 + T->small * 0.36) * s,
             T->small * s, col->ink, OMX_ALIGN_CENTRE);
      else if (!reading || k->text[0])
        text(d, font, k->text, 0, w, mid, (y + T->valueBase) * s, T->small * s, col->ink, OMX_ALIGN_CENTRE);
    }
  }
  lay_free(&L);
}

omx_font *omx_panel_view_font(const omx_panel_view_t *v) { return v ? v->font : NULL; }

/* ------------------------------------------------------------------------------- the CPU path */

static void cpu_round_rect(void *c, double x, double y, double w, double h, double r, omx_rgb rgb) { omx_round_rect(c, x, y, w, h, r, rgb); }
static void cpu_disc(void *c, double cx, double cy, double r, omx_rgb rgb) { omx_disc(c, cx, cy, r, rgb); }
static void cpu_segment(void *c, double ax, double ay, double bx, double by, double hw, omx_rgb rgb) { omx_segment(c, ax, ay, bx, by, hw, rgb); }
static void cpu_text(void *c, omx_font *f, const uint32_t *cps, size_t n, double x, double y, double px, omx_rgb rgb, omx_align a) {
  omx_draw_text(c, f, cps, n, x, y, px, rgb, a);
}

bool omx_panel_view_draw(omx_panel_view_t *v, const omx_panel_buffer_t *b) {
  if (!v || !b || !b->pixels || !b->width || !b->height || b->stride < (uint64_t)b->width * 4 || !(b->scale > 0) ||
      (unsigned)b->format > OMX_PANEL_PIXEL_BGRA8_STRAIGHT)
    return false;
  for (uint32_t y = 0; y < b->height; y++) memset(b->pixels + (size_t)y * b->stride, 0, (size_t)b->width * 4);
  int bgra = b->format == OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED || b->format == OMX_PANEL_PIXEL_BGRA8_STRAIGHT;
  omx_canvas cv = {b->pixels, (int)b->width, (int)b->height, b->stride, bgra};
  const omx_draw d = {&cv, cpu_round_rect, cpu_disc, cpu_segment, cpu_text};
  omx_panel_view_paint(v, b->width, b->height, b->scale, &d);
  /* drawn with straight alpha; a premultiplied buffer gets each colour times its alpha, rounded to the nearest */
  if (b->format == OMX_PANEL_PIXEL_RGBA8_PREMULTIPLIED || b->format == OMX_PANEL_PIXEL_BGRA8_PREMULTIPLIED)
    for (uint32_t y = 0; y < b->height; y++) {
      uint8_t *p = b->pixels + (size_t)y * b->stride;
      for (uint32_t x = 0; x < b->width; x++, p += 4)
        if (p[3] != 255)
          for (int k = 0; k < 3; k++) p[k] = (uint8_t)((p[k] * p[3] + 127) / 255);
    }
  return true;
}
