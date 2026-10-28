# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# The build is npm's (`npm ci` first): `make` runs tsc and the copy step into dist/, the tree a release installs.
# `make test` is the node suite over it, `make check` the checks that read the tree itself. `make install` puts dist/,
# package.json and the runtime node modules under $(DATADIR)/omx-panel (OMX_PANEL for a caller), the omx-panel command
# in $(BINDIR), and the empty skins directory.

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
DATADIR ?= $(PREFIX)/share
MANDIR ?= $(DATADIR)/man
SYSCONFDIR ?= /etc
UNITDIR ?= $(PREFIX)/lib/systemd/system
PKGDIR = $(DATADIR)/omx-panel
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json)

.PHONY: all build check test spdx public-sources look install

all: build

build:
	@test -n "$(VERSION)" || { echo "no version in package.json" >&2; exit 1; }
	@test -d node_modules || { echo "run npm ci first: the build needs typescript, the validator ajv" >&2; exit 1; }
	npm run -s build

# The example skin is valid against the schema and look.json is what the token cascade resolves to.
check: build spdx public-sources look
	node dist/bin/omx-panel.mjs validate examples/skins/org.example.plate

test:
	npm test

# Every tracked file carries the licence line and the author's copyright line, or is exempt with a reason.
spdx:
	node tools/check-spdx.mjs --self-test
	node tools/check-spdx.mjs

# No tracked file points into a private repository, branch, issue or path.
public-sources:
	node tools/check-public-sources.mjs --self-test
	node tools/check-public-sources.mjs

look:
	node tools/look.mjs --check

install: build
	install -d $(DESTDIR)$(PKGDIR) $(DESTDIR)$(BINDIR) $(DESTDIR)$(DATADIR)/omx/skins
	cp -R dist/. $(DESTDIR)$(PKGDIR)/
	install -m 0644 package.json $(DESTDIR)$(PKGDIR)/
	# the runtime modules only (ajv and what it needs), never the build's
	for m in $$(npm ls --omit=dev --all --parseable | tail -n +2); do \
	  rel=$${m#$(CURDIR)/}; install -d $(DESTDIR)$(PKGDIR)/$$(dirname $$rel); cp -R $$m $(DESTDIR)$(PKGDIR)/$$rel; \
	done
	ln -sf ../share/omx-panel/bin/omx-panel.mjs $(DESTDIR)$(BINDIR)/omx-panel
	install -d $(DESTDIR)$(MANDIR)/man1
	install -m 0644 man/omx-panel.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0644 man/omx-modgui-sync.1 $(DESTDIR)$(MANDIR)/man1/
	install -m 0755 bin/omx-modgui-sync $(DESTDIR)$(BINDIR)/
	install -d $(DESTDIR)$(UNITDIR) $(DESTDIR)$(SYSCONFDIR)/omx
	install -m 0644 systemd/omx-modgui-sync.service $(DESTDIR)$(UNITDIR)/
	install -m 0644 etc/omx/modgui-sync.conf $(DESTDIR)$(SYSCONFDIR)/omx/
