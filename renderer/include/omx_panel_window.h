/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 *
 * omx_panel_window.h — a panel view in a window: pugl opens it (embedded in a host's window, or on its own) and
 * NanoVG draws it on OpenGL, with the same layout and the same widget code as the CPU buffer (omx_panel_render.h).
 * Built only with the renderer's window option (docs/renderer.md); a build that never opens a window links none of it.
 *
 * X11. One window per view; the view must outlive its window. Not thread-safe: every call from the thread that
 * created the window.
 */
#ifndef OMX_PANEL_WINDOW_H
#define OMX_PANEL_WINDOW_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "omx_panel_render.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct omx_panel_window omx_panel_window_t;

/** A window for `view`, hidden, `scale` device px a logical px, at the panel's natural size. `parent` is the native
 * window to embed it in (an X11 Window, as CLAP's clap_window and LV2's ui:parent give it), or 0 for a window of its
 * own. NULL with the reason in `err`: no display (neither DISPLAY nor WAYLAND_DISPLAY is set), or the window or its
 * OpenGL 3.3 context could not be made. */
omx_panel_window_t *omx_panel_window_create(omx_panel_view_t *view, uintptr_t parent, double scale, char *err, size_t err_size);
void omx_panel_window_destroy(omx_panel_window_t *window);

bool omx_panel_window_show(omx_panel_window_t *window);
bool omx_panel_window_hide(omx_panel_window_t *window);

/** The window's size in device px, and its native handle (an X11 Window). */
void omx_panel_window_size(const omx_panel_window_t *window, uint32_t *width, uint32_t *height);
uintptr_t omx_panel_window_native(const omx_panel_window_t *window);

/** Ask for the panel to be drawn again (after the view's readings changed), and handle the window's events: a host
 * calls idle on its GUI timer, LV2's idle interface or CLAP's timer. */
void omx_panel_window_redraw(omx_panel_window_t *window);
void omx_panel_window_idle(omx_panel_window_t *window);

/** The window's next frame, read back into `buffer` (its size must be the window's) in the buffer's format: a picture
 * of what the window shows, for a test or a screenshot. False when no frame was drawn within a second. */
bool omx_panel_window_read(omx_panel_window_t *window, const omx_panel_buffer_t *buffer);

#ifdef __cplusplus
}
#endif

#endif
