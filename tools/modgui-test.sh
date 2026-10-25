#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/modgui-test.sh <bundle.lv2> <descriptor> [<panel>] — the plugin's MOD GUI carries its descriptor, tested on
# VALUES:
#   (a) `node tools/modgui-gen.mjs --check` is clean;
#   (b) every control the panel draws is in the template with its symbol, min, max and default, read from the
#       descriptor itself;
#   (c) sord_validate passes the bundle against the LV2 specs, tools/modgui-terms.ttl and the installed
#       omx-contract's omx-resource-hints.ttl, the terms of the omxres: hints (skipped when sord_validate is
#       not installed);
#   (d) a perturbed descriptor (the first drawn control's default moved) makes `--check` fail.
# One `PASS <what>` / `FAIL <what>` line per check; exits nonzero on any FAIL.
set -u
[ $# -eq 2 ] || [ $# -eq 3 ] || { echo "usage: $0 <bundle.lv2> <descriptor> [<panel>]" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
BUNDLE=$(cd "$1" && pwd) || exit 2
STEM=$(basename "$BUNDLE" .lv2)
DESC=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
PANEL=${3:+$(cd "$(dirname "$3")" && pwd)/$(basename "$3")}
TEMPLATE="$BUNDLE/modgui/icon-$STEM.html"
LV2DIR=${OMX_LV2_SPEC_DIR:-/usr/lib64/lv2}
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

# the generator over this descriptor and panel, writing nothing; every run names the source the written files
# name (MODGUI_SOURCE, else the generator's own default for this descriptor and panel), so a perturbed copy differs
# from them by its default alone
if [ -n "${MODGUI_SOURCE:-}" ]; then
  SRC=$MODGUI_SOURCE
else
  SRC=$(node -e 'const { relative } = require("node:path"); const [d, p] = process.argv.slice(1); console.log(`${relative(process.cwd(), d)}${p ? ` and ${relative(process.cwd(), p)}` : ""} and tools/look.json`)' "$DESC" "${PANEL:-}")
fi
gen() { node "$ROOT/tools/modgui-gen.mjs" --check --descriptor "$1" ${PANEL:+--panel "$PANEL"} --out "$BUNDLE" --stem "$STEM" --source "$SRC"; }

# (a) the committed files are the generation, byte for byte.
if gen "$DESC" >"$TMP/check.out" 2>&1; then
  pass "modgui-gen --check $STEM"
else
  fail "modgui-gen --check $STEM: $(head -1 "$TMP/check.out")"
fi

# (b) every drawn control, with its numbers, in the template. The declared rows come from the descriptor itself
# (JSON, read by node: a toggle 0 to 1, a choice from its lowest value to its highest with its default's value, a
# travel its own); the drawn rows are grepped from the template as text. The controls are the panel's, or every
# control the descriptor does not hide when there is no panel.
node --input-type=module -e '
const { readFileSync } = await import("node:fs");
const d = JSON.parse(readFileSync(process.argv[1], "utf8"));
const panel = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : null;
const drawn = panel ? panel.sections.flatMap((s) => s.controls) : d.controls.filter((c) => !c.hidden).map((c) => c.symbol ?? c.id);
for (const sym of drawn) {
  const c = d.controls.find((x) => (x.symbol ?? x.id) === sym);
  const [min, max, def] = c.kind === "toggle" ? [0, 1, c.default ? 1 : 0]
    : c.kind === "choice" ? [Math.min(...c.values), Math.max(...c.values), c.values[c.ids.indexOf(c.default)] ?? c.default]
    : [c.travel.min, c.travel.max, c.travel.default];
  console.log(`data-symbol="${sym}" data-min="${min}" data-max="${max}" data-default="${def}"`);
}
' "$DESC" "${PANEL:-}" >"$TMP/declared" || fail "read descriptor $DESC"
n=0
while IFS= read -r row; do
  n=$((n + 1))
  sym=$(printf '%s\n' "$row" | sed 's/^data-symbol="\([^"]*\)".*/\1/')
  if [ -f "$TEMPLATE" ] && grep -qF "$row" "$TEMPLATE" && grep -qF "mod-port-symbol=\"$sym\"" "$TEMPLATE"; then
    pass "template draws $sym with its declared travel and default"
  else
    fail "template draws $sym with its declared travel and default ($row)"
  fi
done <"$TMP/declared"
drawn=$(grep -c 'data-symbol="' "$TEMPLATE" 2>/dev/null); drawn=${drawn:-0}
# Positive control: the scan read the template it claims to, and it draws nothing undeclared.
if [ "$n" -gt 0 ] && [ "$drawn" -eq "$n" ]; then
  pass "template draws exactly the $n declared parameters"
else
  fail "template draws exactly the declared parameters (declared $n, drawn $drawn)"
fi

# (b2) every choice is a selector: MOD's custom-select on its port, with one enumeration option per value, each at
# the port value the TTL's scale point carries.
node --input-type=module -e '
const { readFileSync } = await import("node:fs");
const d = JSON.parse(readFileSync(process.argv[1], "utf8"));
for (const c of d.controls) if (c.kind === "choice") console.log(`${c.symbol ?? c.id} ${c.values.join(" ")}`);
' "$DESC" >"$TMP/choices" || fail "read the choices of $DESC"
while read -r sym values; do
  [ -n "$sym" ] || continue
  block=$(awk -v s="mod-port-symbol=\"$sym\" mod-widget=\"custom-select\"" 'index($0, s) { on = 1 } on { print } on && /<\/div>$/ && !/enumeration-option|input-control-value/ { n++ } on && n == 2 { exit }' "$TEMPLATE" 2>/dev/null)
  missing=""
  for v in $values; do printf '%s\n' "$block" | grep -qF "mod-role=\"enumeration-option\" mod-port-value=\"$v\"" || missing="$missing $v"; done
  if [ -n "$block" ] && [ -z "$missing" ]; then
    pass "template draws $sym as a selector with every value"
  else
    if [ -n "$block" ]; then why="missing value(s):$missing"; else why="no custom-select"; fi
    fail "template draws $sym as a selector with every value ($why)"
  fi
done <"$TMP/choices"

# (c) sord_validate over the LV2 spec bundles and schemas
# and the closed modgui term list, over the whole generated bundle (manifest, plugin TTL, modgui).
if command -v sord_validate >/dev/null 2>&1; then
  set --
  for s in core port-props units urid atom worker ui options midi patch time log state buf-size \
           parameters presets resize-port port-groups morph dynmanifest instance-access \
           data-access event uri-map schemas; do
    for f in "$LV2DIR/$s.lv2"/*.ttl; do [ -f "$f" ] && set -- "$@" "$f"; done
  done
  HINTS_TTL="$(${PKG_CONFIG:-pkg-config} --variable=datadir omx-contract 2>/dev/null)/omx-resource-hints.ttl"
  if [ $# -le 20 ]; then
    fail "sord_validate: LV2 spec bundles not found under $LV2DIR"
  elif [ ! -f "$HINTS_TTL" ]; then
    fail "sord_validate: omx-contract's omx-resource-hints.ttl not found ($HINTS_TTL; omx-contract >= 3.1.0 installs it)"
  else
    set -- "$@" "$HINTS_TTL"
    out=$(sord_validate "$BUNDLE"/*.ttl "$@" "$HERE/modgui-terms.ttl" 2>&1)
    summary=$(printf '%s\n' "$out" | tail -1)
    # omx-contract#144: 3.1.0's omx-resource-hints.ttl declares omxres:resource, omxres:unit and omxres:basis without an
    # rdfs:label, and sord_validate reports "has no label" for each use. Exactly those errors are the contract's to fix;
    # every other one counts, any about this bundle's own triples (an omxres: value out of its range among them).
    NS=$(sed -n 's/^@prefix omxres: <\(.*\)> \.$/\1/p' "$HINTS_TTL")
    own=$(printf '%s\n' "$out" | awk -v ns="$NS" '
      /^error: / { e = $0; s = ""; getline s
        if (ns != "" && (e == "error: Property <" ns "resource> has no label" || e == "error: Property <" ns "unit> has no label" || e == "error: Property <" ns "basis> has no label")) next
        print e; print s }')
    theirs=$(printf '%s\n' "$out" | grep -cE "^error: Property <$NS(resource|unit|basis)> has no label$")
    case "$summary" in
      "Found "*" errors among "*) ;;
      *) own="${own}${own:+
}sord_validate did not finish: $summary" ;;
    esac
    if [ -z "$own" ]; then
      pass "sord_validate $STEM.lv2/*.ttl against the LV2 specs, modgui terms and resource-hint terms ($summary; all $theirs the label errors of omx-contract#144)"
    else
      printf '%s\n' "$own" | head -20 >&2; fail "sord_validate $STEM.lv2/*.ttl ($summary)"
    fi
    # Red on a property outside the closed modgui vocabulary.
    mkdir -p "$TMP/sord" && cp -R "$BUNDLE" "$TMP/sord/"
    awk '{ print } /^        modgui:brand / { print "        modgui:invented \"x\" ;" }' "$BUNDLE/modgui.ttl" >"$TMP/sord/$STEM.lv2/modgui.ttl"
    out=$(sord_validate "$TMP/sord/$STEM.lv2/modgui.ttl" "$@" "$HERE/modgui-terms.ttl" 2>&1)
    case "$out" in
      *modgui#invented*) pass "sord_validate refuses a modgui property outside modgui-terms.ttl" ;;
      *) fail "sord_validate refuses a modgui property outside modgui-terms.ttl" ;;
    esac
  fi
else
  echo "SKIP sord_validate (not installed)"
fi

# (d) perturbation: a copy of the descriptor with the first drawn control's default moved inside its travel; the
# generation over it must be refused against the written files, on the template.
first=$(sed -n '1s/^data-symbol="\([^"]*\)".*/\1/p' "$TMP/declared")
if node --input-type=module -e '
const { readFileSync, writeFileSync } = await import("node:fs");
const d = JSON.parse(readFileSync(process.argv[1], "utf8"));
const c = d.controls.find((x) => (x.symbol ?? x.id) === process.argv[2]);
if (c.kind === "toggle") c.default = !c.default;
else if (c.kind === "choice") c.default = c.ids.find((id) => id !== c.default);
else c.travel.default = c.travel.default === c.travel.min ? c.travel.max : c.travel.min;
writeFileSync(process.argv[3], JSON.stringify(d));
' "$DESC" "$first" "$TMP/moved.json"; then
  if gen "$TMP/moved.json" >"$TMP/perturb.out" 2>&1; then
    fail "a moved default makes modgui-gen --check fail"
  elif grep -q "icon-$STEM.html" "$TMP/perturb.out"; then
    pass "a moved default makes modgui-gen --check fail"
  else
    fail "a moved default makes modgui-gen --check fail (not on the template: $(head -1 "$TMP/perturb.out"))"
  fi
else
  fail "move the default of $first in a copy of the descriptor"
fi

[ "$fails" -eq 0 ] || { echo "modgui-test: $fails check(s) failed" >&2; exit 1; }
