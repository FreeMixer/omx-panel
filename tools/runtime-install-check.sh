#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# tools/runtime-install-check.sh <omx-panel.rpm | omx-panel.deb>: the package as a runtime install takes it, in a
# clean Fedora or Debian container with the FreeMixer channel configured:
#
#   1. the package's own Requires/Recommends (Depends/Recommends) name no -devel (-dev) package;
#   2. installed with weak dependencies off (install_weak_deps=False, --no-install-recommends), the transaction adds no
#      -devel (-dev) package;
#   3. omx-plugins-contract, the one recommendation, installed after it, adds none either;
#   4. `omx-panel vocabulary omx-plugins/omx-delay` reads the meanings, plugin-hostd's LV2 table and an installed
#      descriptor from /usr/share/omx-contract, with no omx-contract.pc and no variable set.
#
# A contract package the channel does not publish yet is named in $NOT_YET_PUBLISHED (a space list). The package is then
# installed without that one dependency (rpm --nodeps, dpkg --force-depends), and its owner's contract directory is
# unpacked from the -devel (-dev) package's payload at the path the contract package installs: the read is proven, the
# dependency is not, and a warning says so. A name in $NOT_YET_PUBLISHED that the channel does publish is refused, so
# the stand-in ends with the publication. Any other dependency the channel cannot satisfy fails.
set -euo pipefail

PKG=${1:?usage: runtime-install-check.sh <omx-panel.rpm | omx-panel.deb>}
NOT_YET_PUBLISHED=${NOT_YET_PUBLISHED:-}
DESCRIPTOR=${DESCRIPTOR:-omx-plugins/omx-delay}
CONTRACTDIR=/usr/share/omx-contract/contract.d
fails=0
fail() { echo "FAIL $*"; fails=$((fails + 1)); }
pass() { echo "PASS $*"; }
unverified=()
listed() { [[ " $NOT_YET_PUBLISHED " == *" $1 "* ]]; }

case "$PKG" in
  *.rpm)
    FORMAT=rpm
    DEVEL='-devel$|-static$'
    installed() { rpm -qa --qf '%{NAME}\n' | sort; }
    published() { [ -n "$(dnf -q repoquery --latest-limit=1 --whatprovides "$1" 2>/dev/null)" ]; }
    stand_in_of() { echo "${1%-contract}-devel"; }
    unpack() { (cd "$2" && dnf -q download "$1" >/dev/null 2>&1) && (cd / && rpm2cpio "$2"/*.rpm | cpio -idm --quiet "./usr/share/omx-contract/contract.d/3/$3/*"); }
    dnf install -y -q --setopt=install_weak_deps=False cpio >/dev/null 2>&1
    dnf -q makecache >/dev/null 2>&1
    reqs=$(rpm -qp --requires "$PKG" | grep -v -e '^rpmlib(' -e '^/' | sed 's/ *$//')
    weak=$(rpm -qp --recommends "$PKG")
    ;;
  *.deb)
    FORMAT=deb
    DEVEL='-dev$'
    installed() { dpkg-query -W -f '${Package}\n' | sort; }
    published() {
      local name=${1%% *} cand op ver
      cand=$(apt-cache policy "$name" 2>/dev/null | sed -n 's/^ *Candidate: //p')
      [ -n "$cand" ] && [ "$cand" != "(none)" ] || return 1
      if [[ "$1" =~ \((..?)\ (.*)\) ]]; then
        case "${BASH_REMATCH[1]}" in '>=') op=ge ;; '>>') op=gt ;; '=') op=eq ;; '<=') op=le ;; '<<') op=lt ;; esac
        ver=${BASH_REMATCH[2]}
        dpkg --compare-versions "$cand" "$op" "$ver" || { echo "the channel's $name is $cand, not ${BASH_REMATCH[1]} $ver" >&2; return 1; }
      fi
    }
    stand_in_of() { echo "${1%-contract}-dev"; }
    unpack() { (cd "$2" && apt-get download -q "$1" >/dev/null 2>&1 && dpkg-deb --fsys-tarfile ./*.deb | tar -x -C / "./usr/share/omx-contract/contract.d/3/$3"); }
    reqs=$(dpkg-deb -f "$PKG" Depends | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$')
    weak=$(dpkg-deb -f "$PKG" Recommends | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' || true)
    ;;
  *) echo "runtime-install-check: $PKG is neither an RPM nor a DEB" >&2; exit 2 ;;
esac

# 1. what the package itself asks for
bad=$(printf '%s\n' "$reqs" "$weak" | awk '{print $1}' | grep -E -- "$DEVEL" || true)
[ -z "$bad" ] && pass "$FORMAT: its dependencies and recommendations name no development package" \
  || fail "$FORMAT: it asks for a development package: $(echo $bad)"

# which requirements the channel satisfies; the rest must be named in $NOT_YET_PUBLISHED
have=() missing=()
while IFS= read -r req; do
  [ -n "$req" ] || continue
  name=$(echo "$req" | awk '{print $1}')
  if published "$req"; then
    listed "$name" && fail "$name is published: remove it from NOT_YET_PUBLISHED"
    have+=("$name")
  elif listed "$name"; then
    missing+=("$name")
  else
    fail "the channel satisfies no '$req'"
  fi
done <<< "$reqs"
[ "$fails" -eq 0 ] || { echo "runtime-install-check: $fails check(s) failed" >&2; exit 1; }

# 2. the install, weak dependencies off
before=$(installed)
if [ ${#missing[@]} -eq 0 ]; then
  if [ "$FORMAT" = rpm ]; then dnf install -y -q --setopt=install_weak_deps=False "$PKG" >/dev/null 2>&1
  else apt-get install -y -q --no-install-recommends "$PKG" >/dev/null; fi
  pass "$FORMAT: installed through the resolver, every dependency from the channel"
else
  if [ "$FORMAT" = rpm ]; then
    dnf install -y -q --setopt=install_weak_deps=False "${have[@]}" >/dev/null 2>&1
    rpm -i --nodeps "$PKG"
  else
    apt-get install -y -q --no-install-recommends "${have[@]}" >/dev/null
    dpkg -i --force-depends "$PKG" >/dev/null
  fi
  unverified+=("the dependency on ${missing[*]}: not published, so the package was installed without it")
fi
added=$(comm -13 <(echo "$before") <(installed))
echo "added: $(echo $added)"
bad=$(echo "$added" | grep -E -- "$DEVEL" || true)
[ -z "$bad" ] && pass "$FORMAT: the install adds no development package" || fail "$FORMAT: the install adds $(echo $bad)"

# the contract directories of the dependencies not yet published, from their -devel payloads
stand_in() {
  local owner=${1%-contract} from tmp
  from=$(stand_in_of "$1")
  tmp=$(mktemp -d)
  unpack "$from" "$tmp" "$owner"
  rm -rf "$tmp"
  [ -d "$CONTRACTDIR/3/$owner" ] || { fail "no $CONTRACTDIR/3/$owner in $from"; return; }
  unverified+=("$1 delivering $CONTRACTDIR/3/$owner: unpacked from $from's payload")
}
for m in "${missing[@]}"; do stand_in "$m"; done

# 3. the recommendation, on its own
for r in $(echo "$weak" | awk '{print $1}'); do
  before=$(installed)
  if published "$r"; then
    listed "$r" && fail "$r is published: remove it from NOT_YET_PUBLISHED"
    if [ "$FORMAT" = rpm ]; then dnf install -y -q --setopt=install_weak_deps=False "$r" >/dev/null 2>&1
    else apt-get install -y -q --no-install-recommends "$r" >/dev/null; fi
    bad=$(comm -13 <(echo "$before") <(installed) | grep -E -- "$DEVEL" || true)
    [ -z "$bad" ] && pass "$FORMAT: $r adds no development package" || fail "$FORMAT: $r adds $(echo $bad)"
  elif listed "$r"; then
    stand_in "$r"
  else
    fail "the channel publishes no $r"
  fi
done

# 4. the installed command reads the installed contract data, nothing set and no omx-contract.pc
[ ! -e /usr/share/pkgconfig/omx-contract.pc ] && [ ! -e /usr/lib64/pkgconfig/omx-contract.pc ] \
  && pass "no omx-contract.pc is installed" || fail "omx-contract.pc is installed: the lookup without it is not exercised"
out=$(env -u OMX_CONTRACT_PATH -u OMX_CONTRACT_SCHEMA -u PLUGIN_HOSTD_TABLES -u OMX_PARAM_CONTRACT_H omx-panel vocabulary "$DESCRIPTOR" || true)
echo "$out"
expect() { grep -qE "$2" <<< "$out" && pass "omx-panel vocabulary: $1" || fail "omx-panel vocabulary: $1"; }
expect "the contract directory is $CONTRACTDIR" "^ok   contractdir $CONTRACTDIR\$"
expect "the meanings from omx-contract-data's schema" '^ok   meanings [1-9][0-9]* from /usr/share/omx-contract/omx-contract\.schema\.json$'
expect "the LV2 table from the contract directory" "^ok   lv2-units [1-9][0-9]* from $CONTRACTDIR/3/plugin-hostd/formats/lv2\\.json\$"
expect "the descriptor $DESCRIPTOR from the contract directory" "^ok   descriptor $DESCRIPTOR [1-9][0-9]* controls from $CONTRACTDIR/3/${DESCRIPTOR%%/*}/plugins/${DESCRIPTOR#*/}\\.json\$"
grep -q '^FAIL param-contract' <<< "$out" \
  && unverified+=("a layout of a control with a unit: the param-contract header ships only in the development package")

for u in "${unverified[@]}"; do echo "::warning::not verified: $u"; done
[ "$fails" -eq 0 ] || { echo "runtime-install-check: $fails check(s) failed" >&2; exit 1; }
echo "runtime-install-check: every check passed (${#unverified[@]} not verified)"
