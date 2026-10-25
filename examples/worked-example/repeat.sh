#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# repeat.sh: runs the commands of docs/worked-example.md in order, as the unprivileged user, from the root of this
# repository, and writes what each prints to examples/worked-example/transcript/<step>.txt (standard output and
# standard error together, then "[exit N]" when the status is not 0). A command that prints nothing and exits 0
# leaves no file; one whose output goes to a committed file under examples/worked-example/ leaves that file.
# The root part of the setup (the dnf installs and the omx-panel link) is the document's "Where it ran".
set -u
cd "$(dirname "$0")/../.."
T=examples/worked-example/transcript
rm -rf "$T" /tmp/stage /tmp/zamcomp-0.2.5.lv2 /tmp/limiter_mono.lv2
mkdir -p "$T"

step() {
	local name=$1 out rc
	shift
	out=$(bash -c "$*" 2>&1)
	rc=$?
	{
		[ -n "$out" ] && printf '%s\n' "$out"
		[ "$rc" -ne 0 ] && printf '[exit %s]\n' "$rc"
	} > "$T/$name.txt"
	[ -s "$T/$name.txt" ] || rm -f "$T/$name.txt"
}

E=examples/worked-example
Z=$E/zamcomp
L=$E/lsp-limiter-mono
CLAP=/usr/lib64/clap/lsp-plugins.clap

step 01-mkdir "mkdir -p $Z $L"
step 02-rpm-q-plugins "rpm -q lv2-zam-plugins lsp-plugins-clap"
step 03-rpm-ql-zamcomp "rpm -ql lv2-zam-plugins | grep '^/usr/lib64/lv2/ZamComp.lv2/'"
step 04-rpm-qf-clap "rpm -qf $CLAP"
step 05-lv2ls "lv2ls | grep -x urn:zamaudio:ZamComp"
step 06-lv2info "lv2info urn:zamaudio:ZamComp > $Z/lv2info.txt"
step 07-omx-clap-scan "omx-clap-scan $CLAP | sed -n '/^  plugin in.lsp-plug.limiter_mono /,/^    note ports/p' > $L/omx-clap-scan.txt"
step 08-rpm-q-tools "rpm -q omx-clap-host omx-clap-core plugin-hostd omx-contract"
step 09-fields-zamcomp "omx-clap-scan --fields lv2:urn:zamaudio:ZamComp > $Z/zamcomp.fields.tsv"
step 10-describe-zamcomp "plugin-hostd-probe describe lv2:urn:zamaudio:ZamComp > $Z/zamcomp.descriptor.json"
step 11-fields-limiter "omx-clap-scan --fields clap:$CLAP#in.lsp-plug.limiter_mono > $L/limiter_mono.fields.tsv"
step 12-describe-limiter "plugin-hostd-probe describe clap:$CLAP#in.lsp-plug.limiter_mono > $L/limiter_mono.descriptor.json"
step 13-layout-zamcomp "omx-panel layout --descriptor $Z/zamcomp.descriptor.json > $Z/zamcomp.layout.json"
step 14-pages-zamcomp "omx-panel layout --descriptor $Z/zamcomp.descriptor.json --pages | tee $Z/zamcomp.pages.json"
step 15-modgui-zamcomp "omx-panel modgui --descriptor $Z/zamcomp.descriptor.json --out $Z/no-panel/ZamComp.lv2"
step 16-modgui-test-no-panel "tools/modgui-test.sh $Z/no-panel/ZamComp.lv2 $Z/zamcomp.descriptor.json"
step 17-pages-zamcomp-panel "omx-panel layout --descriptor $Z/zamcomp.descriptor.json --panel $Z/zamcomp.panel.json --pages | tee $Z/zamcomp.panel.pages.json"
step 18-modgui-zamcomp-panel "omx-panel modgui --descriptor $Z/zamcomp.descriptor.json --panel $Z/zamcomp.panel.json --out $Z/with-panel/ZamComp.lv2"
step 19-modgui-test-with-panel "tools/modgui-test.sh $Z/with-panel/ZamComp.lv2 $Z/zamcomp.descriptor.json $Z/zamcomp.panel.json"
step 20-rpm-q-omx-panel "rpm -q omx-panel"
step 21-released-025 "/usr/bin/omx-panel modgui --descriptor $Z/zamcomp.descriptor.json --out /tmp/zamcomp-0.2.5.lv2 2>&1 | grep '^Error'"
step 22-layout-limiter "omx-panel layout --descriptor $L/limiter_mono.descriptor.json > $L/limiter_mono.layout.json"
step 23-pages-limiter "omx-panel layout --descriptor $L/limiter_mono.descriptor.json --pages > $L/limiter_mono.pages.json"
step 24-modgui-limiter "omx-panel modgui --descriptor $L/limiter_mono.descriptor.json --out /tmp/limiter_mono.lv2 2>&1 | grep '^Error'"
step 25-describe-filter-mono "plugin-hostd-probe describe clap:$CLAP#in.lsp-plug.filter_mono > $L/filter_mono.descriptor.json"
step 26-pages-filter-mono "omx-panel layout --descriptor $L/filter_mono.descriptor.json --pages"
step 27-survey-lsp-mono "bash $E/survey-lsp-mono.sh"
step 27a-survey-lsp-mono-all "bash $E/survey-lsp-mono.sh --all"
step 28-stage-clean "rm -rf /tmp/stage && mkdir -p /tmp/stage"
step 29-stage-copy "cp -R /usr/lib64/lv2/ZamComp.lv2 /tmp/stage/"
step 30-stage-modgui "cp -R $Z/with-panel/ZamComp.lv2/modgui.ttl $Z/with-panel/ZamComp.lv2/modgui /tmp/stage/ZamComp.lv2/"
step 31-lilv-no-manifest "LV2_PATH=/tmp/stage python3 $E/lilv-modgui.py urn:zamaudio:ZamComp"
step 32-manifest-line "printf '\n<urn:zamaudio:ZamComp> rdfs:seeAlso <modgui.ttl> .\n' >> /tmp/stage/ZamComp.lv2/manifest.ttl"
step 33-lilv-manifest "LV2_PATH=/tmp/stage python3 $E/lilv-modgui.py urn:zamaudio:ZamComp"
step 34-lilv-installed-first "LV2_PATH=/usr/lib64/lv2:/tmp/stage python3 $E/lilv-modgui.py urn:zamaudio:ZamComp"
step 35-lilv-stage-first "LV2_PATH=/tmp/stage:/usr/lib64/lv2 python3 $E/lilv-modgui.py urn:zamaudio:ZamComp | head -3"
step 36-modgui-test-staged "tools/modgui-test.sh /tmp/stage/ZamComp.lv2 $Z/zamcomp.descriptor.json $Z/zamcomp.panel.json"
step 37-sord-installed "for s in core port-props units urid atom worker ui options midi patch time log state buf-size parameters presets resize-port port-groups morph dynmanifest instance-access data-access event uri-map schemas; do set -- \"\$@\" /usr/lib64/lv2/\$s.lv2/*.ttl; done; sord_validate /usr/lib64/lv2/ZamComp.lv2/*.ttl \"\$@\" 2>&1 | grep -A1 '^error'"
step 38-grep-groups "grep -c -E 'portgroups|pg:group|displayPriority' /usr/lib64/lv2/ZamComp.lv2/ZamComp_dsp.ttl"
