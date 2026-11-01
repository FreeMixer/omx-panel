#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/offline-build-check.sh <rpm | deb>: the package builds from the vendored tarball with no network. The tools go
# into the image with the network on, then the build runs with --network=none. The plain archive is built the same way
# first and has to fail, which proves the network is off and that the vendored modules are what made the difference.
#
#   CONTAINER=podman IMAGE=debian:trixie tools/offline-build-check.sh deb
set -euo pipefail
kind=${1:?usage: offline-build-check.sh <rpm | deb>}
engine=${CONTAINER:-docker}
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
work=$(mktemp -d)
tools=omx-panel-offline-$kind
trap 'rm -rf "$work"; "$engine" rm -f "$tools" >/dev/null 2>&1 || true; "$engine" rmi -f "$tools" >/dev/null 2>&1 || true' EXIT
tools/vendored-source.sh "$work" >/dev/null
git archive --format=tar.gz --prefix="omx-panel-$version/" -o "$work/omx-panel-$version-plain.tar.gz" HEAD

case "$kind" in
  rpm)
    image=${IMAGE:-fedora:44}
    install='dnf install -y -q --setopt=install_weak_deps=False rpm-build make sed nodejs npm systemd-rpm-macros'
    build='mkdir -p ~/rpmbuild/SOURCES && cp "$1" ~/rpmbuild/SOURCES/omx-panel-$2.tar.gz && tar -xzOf "$1" omx-panel-$2/packaging/omx-panel.spec >/tmp/omx-panel.spec && rpmbuild -bb --nocheck --nodeps /tmp/omx-panel.spec'
    ;;
  deb)
    image=${IMAGE:-debian:trixie}
    install='apt-get update -qq && apt-get install -y -qq --no-install-recommends dpkg-dev debhelper build-essential nodejs npm make'
    build='mkdir -p /b && tar -xzf "$1" -C /b && cd /b/omx-panel-$2 && DEB_BUILD_OPTIONS=nocheck dpkg-buildpackage -b -us -uc -d'
    ;;
  *) echo "usage: offline-build-check.sh <rpm | deb>" >&2; exit 2 ;;
esac

"$engine" rm -f "$tools" >/dev/null 2>&1 || true
"$engine" run --name "$tools" "$image" bash -c "$install" >/dev/null
"$engine" commit "$tools" "$tools" >/dev/null
offline() { "$engine" run --rm --network=none --security-opt label=disable -e npm_config_fetch_retries=0 -v "$work:/w:ro" "$tools" bash -euc "$build" sh "/w/$1" "$version"; }

if offline "omx-panel-$version-plain.tar.gz" >"$work/plain.log" 2>&1; then
  echo "FAIL the plain archive built with no network: the check proves nothing" >&2
  exit 1
fi
echo "PASS the plain archive does not build with no network: $(grep -m1 -E 'npm (ERR!|error) (code|network)' "$work/plain.log" || tail -1 "$work/plain.log")"
offline "omx-panel-$version-vendored.tar.gz" >"$work/vendored.log" 2>&1 || { tail -20 "$work/vendored.log" >&2; echo "FAIL the vendored tarball did not build with no network" >&2; exit 1; }
echo "PASS $kind builds from the vendored tarball with no network"
