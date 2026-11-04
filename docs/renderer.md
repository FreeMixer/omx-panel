<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The panel renderer

One C library draws a plugin's panel from its panel description, the document `omx-panel layout` writes
([panel-layout.md](panel-layout.md)). Every place a panel is shown draws through it:

- a plugin window in a DAW (CLAP `clap.gui`) or in omx-clap-host;
- a host-embedded inline view, at whatever size the host gives;
- a plain CPU pixel buffer (RGBA or BGRA, a width, a height, a stride and a scale): what a host that
  embeds a plugin's view hands the plugin to draw into, and what an out-of-process worker sends to the
  web console so it can show the same view.

Each of these draws the same description with the same drawing code. The source is in `renderer/`.

## What it draws

The renderer reads the description's sections and controls: each section's label, and each control's
symbol, label, section and standard widget (`knob`, `fader`, `switch`, `selector`, `meter`, `curve`, `xy`,
`display`, omx-contract's `PANEL_STANDARD_WIDGETS`). A widget name it does not know is refused by name,
and the build fails when omx-contract adds a widget the renderer does not draw yet.

The description says what is on the panel. The host says what each control reads now: its place along its
travel (0 to 1) and the text the plugin gives for that value (CLAP's `value_to_text`, or the host's own
formatting for an LV2 port). A selector gets its option and the number of options. The renderer formats no
value and reads no travel, so a third-party plugin's panel is drawn exactly as one of ours.

The face is the MOD GUI's face, drawn the same way to the bit: the head (maker and name), each section with
its label, each control in its cell with its label and value text. The look (colours, font) is
`tools/look.json`, resolved from `tools/look/tokens.css`; the geometry and text sizes are
`tools/look/geometry.json`, which `tools/modgui-gen.mjs` reads too. The renderer types no colour and no size.

A meter fills along the foot of its frame to its reading. A display, a curve and an xy pad show a frame
and their text for now; each gets its own drawing when a description carries what it needs (a curve's
points, a pair of controls).

## The C API

`renderer/include/omx_panel_render.h`:

```c
omx_panel_view_t *omx_panel_view_create(const omx_panel_sources_t *sources, char *err, size_t err_size);
omx_panel_view_t *omx_panel_view_create_from_files(const char *description_path, const char *data_dir,
                                                   char *err, size_t err_size);
void omx_panel_view_destroy(omx_panel_view_t *view);

uint32_t omx_panel_view_count(const omx_panel_view_t *view);
int32_t omx_panel_view_find(const omx_panel_view_t *view, const char *symbol);
void omx_panel_view_set_title(omx_panel_view_t *view, const char *brand, const char *name);
bool omx_panel_view_set_value(omx_panel_view_t *view, uint32_t index, double fraction, const char *text);
bool omx_panel_view_set_choice(omx_panel_view_t *view, uint32_t index, uint32_t at, uint32_t count,
                               const char *text);
bool omx_panel_view_control_rect(const omx_panel_view_t *view, uint32_t width, uint32_t height, double scale,
                                 uint32_t index, double rect[4]);

void omx_panel_view_natural_size(const omx_panel_view_t *view, uint32_t *width, uint32_t *height);
bool omx_panel_view_draw(omx_panel_view_t *view, const omx_panel_buffer_t *buffer);
```

A view is made from four inputs held in memory: the description, the look, the geometry and the font
bytes. `create_from_files` reads them from a description file and omx-panel's tools directory (the
installed `share/omx-panel/tools`, or the source tree's `tools/`). Nothing else is read from disk, so a
plugin can embed the four and draw with no file at all.

`omx_panel_view_draw` fills every pixel of the buffer, transparent where the panel does not reach. At the
natural size times the scale the panel is drawn as laid out. A smaller buffer gets the number of controls
a row that lets the panel be drawn largest, then the panel scaled down to fit; a larger one gets the panel
at its natural size in the top-left corner.

The buffer names its pixel format: RGBA or BGRA, each with its colours premultiplied by alpha (the default,
what a compositor blends) or straight. The panel is drawn with straight alpha and premultiplied at the end,
each channel times its alpha rounded to the nearest. A PNG holds straight alpha, so the command asks for
straight when it writes one: the conversion is at the edge, never inside the drawing.

`omx_panel_view_control_rect` gives a control's cell in a buffer of a given size and scale: what a pointer
event will be hit-tested against.

Still to come, in this order: input (a pointer press, drag and release on a control, a scroll, answered
with the control and the new fraction, and a gesture's begin and end), redrawing only what changed, and
the window (below).

`renderer/build/omx-panel-render` is the library's front door for tests and tools: it draws a description
with a state file (the title and each control's reading) into a raw buffer or a PNG.

## One drawing code for the buffer and the window

There were three ways to give both the CPU buffer and a window the same drawing:

1. **NanoVG on OpenGL for windows, and a software backend for buffers.** NanoVG draws well on a GPU, but
   it has no CPU backend upstream; a buffer would need a second backend, and the two would not draw the
   same pixels. A GL drawing also changes with the driver, so no test could hold an image to a reference.
   A board with no GPU would need the software path anyway. NanoVG is not packaged on Fedora or Debian.
2. **Cairo for both.** Cairo draws into an image surface and into a window. But its output changes between
   versions (antialiasing, text through FreeType and fontconfig), so Fedora and Debian would draw
   different pixels, and a plugin linking Cairo for its buffer view is a heavy dependency.
3. **One CPU rasteriser, its buffer copied into the window.** The renderer draws into memory, always; a
   window shows that memory. Every surface gets the same pixels by construction, on any machine, with or
   without a GPU, and the drawing can be tested to the bit.

The renderer takes the third. It is the only one where the inline view, the console's copy and the window
cannot disagree, and the buffer path is the one the inline-view case needs first. Its cost is speed: the
shapes are filled by supersampled coverage, which is plenty for a panel (a full redraw of ZamComp's
552 x 382 panel takes about 3.5 ms at scale 1 and 11 ms at scale 2 on a laptop core) and will be cut
further by redrawing only the cells that change.
What it gives up is GPU effects (blur, gradients on the glass); the look uses none today.

The rasteriser is the MOD GUI generator's, `tools/raster.mjs`, carried to C operation for operation:
coverage over 4 x 4 samples a pixel, coordinates snapped to 1/16 px, rounding half up, and the font read
from the TrueType outlines (`tools/font.mjs`) with the same flattening. It is built with
`-ffp-contract=off`, since a fused multiply-add rounds differently. The result is that the renderer draws
the MOD GUI face pixel for pixel: `renderer/test/parity.test.mjs` holds it equal to `modgui-gen.mjs`'s face
at three scales and to the committed MOD GUI screenshot. So the MOD GUI's images can come from the
renderer, and then `tools/raster.mjs`'s shapes and `modgui-gen.mjs`'s drawing go away: one drawing code.

### The window

A window is a pugl view whose expose handler copies the buffer in. pugl's Cairo backend does this in a few
lines (an image surface over the buffer, painted once; Cairo's ARGB32 is premultiplied BGRA on a
little-endian machine, so the renderer draws BGRA and the copy premultiplies). Cairo here only copies
pixels; it draws nothing. A probe built against pugl 0.5.9 and drawn under Xvfb read every opaque pixel of
the window back identical to the buffer. The window, `clap.gui` (embedded when the host gives a parent,
floating otherwise; X11 first, Wayland when there is a desktop to prove it on) and the input events are the
next step.

## Dependencies

| What | Used for | Fedora 44 | Debian (bookworm, trixie) | Licence |
|---|---|---|---|---|
| cJSON | reading the description, the look and the geometry | `cjson-devel` | `libcjson-dev` | MIT |
| omx-contract's C headers | the standard widget names | `omx-contract-devel` | `libomx-contract-dev` | GPL-3.0-or-later |
| libm | | glibc | libc6 | |
| node (tests only) | laying out the fixtures, the golden images, the parity with the MOD GUI | `nodejs` | `nodejs` | MIT |
| pugl (window, next) | the window and its events | not packaged | not packaged | ISC |
| Cairo (window, next) | copying the buffer into the window | `cairo-devel` | `libcairo2-dev` | LGPL-2.1 or MPL-1.1 |

The library itself needs only cJSON, omx-contract's headers and libm; the buffer path links no toolkit, so
a plugin's inline view and a headless worker pay for no window system. pugl is not packaged on Fedora or
Debian: the window needs it vendored or packaged first. All of these licences can be combined with this
repository's GPL-3.0-or-later. The font, Inter, is under the SIL Open Font Licence, as the MOD GUI already
ships it (`tools/fonts/Inter-LICENSE.txt`).

## Building and testing

```
npm ci && make                 # the tree the tests read: dist/
make -C renderer               # renderer/build/: libomx-panel-render.a, omx_panel_render.h, omx-panel-render.pc, omx-panel-render
make -C renderer check         # the golden images and the parity with the MOD GUI face
make -C renderer install PREFIX=/usr DESTDIR=...
```

The tests lay out one of our plugins (omx-delay, a declared panel) and a third-party LV2 plugin (ZamComp,
from its scan alone and under a declared panel). `renderer/test/golden.test.mjs` draws each at its natural
size and at a compact 320 x 200 box, at scale 1 and 2, and holds them to `renderer/test/golden/`: a pixel
may move by 2 in a channel, and at most one in a thousand further. The parity test holds every pixel exactly.
After a change meant to move the pixels, `OMX_PANEL_RENDER_UPDATE=1 node --test test/golden.test.mjs` in
`renderer/` rewrites the golden images; look at each before committing them.
