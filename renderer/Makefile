# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The panel renderer (docs/renderer.md): libomx-panel-render.a (static, PIC), its header, its pkg-config file and the
# omx-panel-render command. Needs a C11 compiler, cJSON (libcjson) and omx-contract's C headers (omx-contract-devel,
# pkg-config omx-contract). `make check` draws the fixtures and holds them to the golden images and to the MOD GUI
# face (node, the parent tree's `npm ci` and the installed vocabulary its layout reads).
#
#   make [-C renderer] [WINDOW=1] build/ : the library, the command (and the window: pugl-devel, nanovg-devel, GL)
#   make check                    the golden images and the parity with the MOD GUI face; with WINDOW=1 and a display
#                                 (xvfb-run make WINDOW=1 check) the window held to the buffer by structure too
#   make install PREFIX=... DESTDIR=...

PREFIX ?= /usr/local
LIBDIR ?= $(PREFIX)/lib
INCLUDEDIR ?= $(PREFIX)/include
BINDIR ?= $(PREFIX)/bin
DATADIR ?= $(PREFIX)/share
PKG_CONFIG ?= pkg-config
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' ../package.json)

DEPS := libcjson omx-contract
# -ffp-contract=off: a fused multiply-add rounds differently, and the drawing is held to the bit
CFLAGS ?= -O2 -g
CFLAGS += -std=c11 -D_DEFAULT_SOURCE -fPIC -ffp-contract=off -Wall -Wextra -Werror -Iinclude $(shell $(PKG_CONFIG) --cflags $(DEPS))
LDLIBS += $(shell $(PKG_CONFIG) --libs libcjson) -lm

B := build
LIB_OBJ := $(B)/view.o $(B)/raster.o

# WINDOW=1 adds the window (pugl and NanoVG on OpenGL): libomx-panel-window.a, its header and pkg-config file, and
# --window in the command. Off by default: the buffer path links no window system.
WINDOW ?= 0
WINDOW_DEPS := pugl-0 pugl-gl-0 nanovg gl
ifeq ($(WINDOW),1)
CLI_CFLAGS := -DOMX_PANEL_WINDOW $(shell $(PKG_CONFIG) --cflags $(WINDOW_DEPS))
CLI_LIBS := $(B)/libomx-panel-window.a $(shell $(PKG_CONFIG) --libs $(WINDOW_DEPS))
WINDOW_TARGETS := $(B)/libomx-panel-window.a $(B)/omx-panel-window.pc
endif

.PHONY: all check install clean
all: $(B)/libomx-panel-render.a $(B)/omx-panel-render $(B)/omx-panel-render.pc $(WINDOW_TARGETS)

$(B):
	mkdir -p $@
$(B)/%.o: src/%.c src/raster.h src/draw.h include/omx_panel_render.h | $(B)
	$(CC) $(CFLAGS) -c -o $@ $<
$(B)/libomx-panel-render.a: $(LIB_OBJ)
	$(AR) rcs $@ $^
$(B)/window.o: src/window.c src/draw.h src/raster.h include/omx_panel_render.h include/omx_panel_window.h | $(B)
	$(CC) $(CFLAGS) $(shell $(PKG_CONFIG) --cflags $(WINDOW_DEPS)) -c -o $@ $<
$(B)/libomx-panel-window.a: $(B)/window.o
	$(AR) rcs $@ $^
$(B)/omx-panel-render: $(B)/cli.o $(B)/libomx-panel-render.a $(WINDOW_TARGETS)
	$(CC) $(LDFLAGS) -o $@ $(B)/cli.o $(CLI_LIBS) $(B)/libomx-panel-render.a $(LDLIBS)
# the command is built anew when WINDOW changes: build/window-option holds the last one
$(B)/window-option: FORCE | $(B)
	@echo $(WINDOW) | cmp -s - $@ || echo $(WINDOW) > $@
$(B)/cli.o: CFLAGS += -DOMX_PANEL_DATA_DIR='"$(DATADIR)/omx-panel/tools"' $(CLI_CFLAGS)
$(B)/cli.o: $(B)/window-option
$(B)/omx-panel-window.pc: omx-panel-window.pc.in | $(B)
	sed -e 's|@PREFIX@|$(PREFIX)|' -e 's|@LIBDIR@|$(LIBDIR)|' -e 's|@INCLUDEDIR@|$(INCLUDEDIR)|' -e 's|@VERSION@|$(VERSION)|' $< > $@
.PHONY: FORCE
FORCE:
$(B)/omx-panel-render.pc: omx-panel-render.pc.in | $(B)
	sed -e 's|@PREFIX@|$(PREFIX)|' -e 's|@LIBDIR@|$(LIBDIR)|' -e 's|@INCLUDEDIR@|$(INCLUDEDIR)|' \
	    -e 's|@DATADIR@|$(DATADIR)|' -e 's|@VERSION@|$(VERSION)|' $< > $@

check: all
	node --test test/*.test.mjs

install: all
	install -d $(DESTDIR)$(LIBDIR)/pkgconfig $(DESTDIR)$(INCLUDEDIR) $(DESTDIR)$(BINDIR)
	install -m 0644 $(B)/libomx-panel-render.a $(DESTDIR)$(LIBDIR)/
	install -m 0644 include/omx_panel_render.h $(DESTDIR)$(INCLUDEDIR)/
	install -m 0644 $(B)/omx-panel-render.pc $(DESTDIR)$(LIBDIR)/pkgconfig/
	install -m 0755 $(B)/omx-panel-render $(DESTDIR)$(BINDIR)/
ifeq ($(WINDOW),1)
	install -m 0644 $(B)/libomx-panel-window.a $(DESTDIR)$(LIBDIR)/
	install -m 0644 include/omx_panel_window.h $(DESTDIR)$(INCLUDEDIR)/
	install -m 0644 $(B)/omx-panel-window.pc $(DESTDIR)$(LIBDIR)/pkgconfig/
endif

clean:
	rm -rf $(B)
