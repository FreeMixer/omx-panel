#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/vendored-source.sh <output dir>: the source tarball of HEAD with node_modules inside, the one a build with no
# registry starts from (mock, pbuilder, koji). Same prefix as the plain archive, so it stands in for the spec's Source0.
set -euo pipefail
out=$(mkdir -p "${1:?usage: vendored-source.sh <output dir>}" && cd "$1" && pwd)
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
prefix=omx-panel-$version
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive --format=tar --prefix="$prefix/" HEAD | tar -x -C "$work"
(cd "$work/$prefix" && npm ci --no-audit --no-fund --ignore-scripts >/dev/null)
tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$out/$prefix-vendored.tar.gz" -C "$work" "$prefix"
ls -l "$out/$prefix-vendored.tar.gz"
