#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# survey-lsp-mono.sh [--all]: scans every mono plugin of lsp-plugins.clap into a descriptor and lays it out. It
# prints "refused <id>: <first line of the message>" for each plugin omx-panel layout --pages refuses, then a
# count line; with --all it also prints "ok <id>" for each plugin that lays out.
clap=/usr/lib64/clap/lsp-plugins.clap
all=${1:-}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ok=0
refused=0
for id in $(omx-clap-scan "$clap" | sed -n 's/^  plugin \(in\.lsp-plug\.[a-z0-9_]*_mono\) .*/\1/p'); do
	if plugin-hostd-probe describe "clap:$clap#$id" > "$tmp/d.json" 2> "$tmp/err" &&
		omx-panel layout --descriptor "$tmp/d.json" --pages > /dev/null 2> "$tmp/err"; then
		[ "$all" = --all ] && echo "ok $id"
		ok=$((ok + 1))
	else
		echo "refused $id: $(head -1 "$tmp/err" | sed "s|$tmp/d.json|<descriptor>|")"
		refused=$((refused + 1))
	fi
done
echo "$ok laid out, $refused refused"
