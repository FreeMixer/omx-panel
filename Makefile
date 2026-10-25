# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# Installs the skin package schema and the directory skins are installed into. No node runs here: the
# validator (`omx-panel validate`) is the npm package; a release build (RPM, deb) installs the schema as
# the repository holds it. `make test` is the node suite, `make check` the checks that need no node
# beyond the tools themselves.

PREFIX ?= /usr/local
DATADIR ?= $(PREFIX)/share
VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json)

.PHONY: all check test spdx public-sources install

all:
	@test -n "$(VERSION)" || { echo "no version in package.json" >&2; exit 1; }

# The schema is valid JSON and the example skin is valid against it.
check: all spdx public-sources
	node bin/omx-panel.mjs validate examples/skins/org.example.plate

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

install: all
	install -d $(DESTDIR)$(DATADIR)/omx-panel $(DESTDIR)$(DATADIR)/omx/skins
	install -m 0644 schema/skin-package.schema.json $(DESTDIR)$(DATADIR)/omx-panel/
