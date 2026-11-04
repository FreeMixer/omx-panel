# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The panel renderer (docs/renderer.md): libomx-panel-render.a (static, PIC), its header, its pkg-config file and the
# omx-panel-render command. Needs a C11 compiler, cJSON (libcjson) and omx-contract's C headers (omx-contract-devel,
# pkg-config omx-contract). `make check` draws the fixtures and holds them to the golden images and to the MOD GUI
# face (node, the parent tree's `npm ci` and the installed vocabulary its layout reads).
#
#   make [-C renderer]            build/ : the library, the command
#   make check                    the golden images and the parity with the MOD GUI face
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

.PHONY: all check install clean
all: $(B)/libomx-panel-render.a $(B)/omx-panel-render $(B)/omx-panel-render.pc

$(B):
	mkdir -p $@
$(B)/%.o: src/%.c src/raster.h include/omx_panel_render.h | $(B)
	$(CC) $(CFLAGS) -c -o $@ $<
$(B)/libomx-panel-render.a: $(LIB_OBJ)
	$(AR) rcs $@ $^
$(B)/omx-panel-render: $(B)/cli.o $(B)/libomx-panel-render.a
	$(CC) $(LDFLAGS) -o $@ $^ $(LDLIBS)
$(B)/cli.o: CFLAGS += -DOMX_PANEL_DATA_DIR='"$(DATADIR)/omx-panel/tools"'
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

clean:
	rm -rf $(B)
