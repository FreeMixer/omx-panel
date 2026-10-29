#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# Build the DEB from this tree and lint it the way the release build does (FreeMixer/.github build-deb.sh):
# lintian --fail-on error,warning. The suite is the test job's, so the build skips it (nocheck). #85
#
#   tools/deb-lint-check.sh [output dir]
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:-$PWD/out}
mkdir -p "$out"
name=$(dpkg-parsechangelog -S Source)
DEB_BUILD_OPTIONS=nocheck dpkg-buildpackage -b -us -uc -d
changes=$(ls ../"${name}"_*.changes)
lintian --fail-on error,warning "$changes"
cp ../"${name}"_*_all.deb "$out/"
ls "$out"/*.deb
