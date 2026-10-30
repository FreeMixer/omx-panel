<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# Worked example: a third-party LV2 and CLAP plugin to a generated panel, adapted to Zynthian

This takes two plugins nobody here wrote, as a distribution installs them, through the whole panel path: the
scan into a descriptor, the layout, the MOD GUI and the test that holds it to the descriptor. It then follows
the LV2 one to where Zynthian looks for it.

- **LV2**: ZamComp, Damien Zammit's mono compressor (`urn:zamaudio:ZamComp`), from Fedora's `lv2-zam-plugins`.
  Section 4 reads, from Zynthian's sources, where it would look for it.
- **CLAP**: LSP Limiter Mono (`in.lsp-plug.limiter_mono`), from Fedora's `lsp-plugins-clap`.

Every command below was run as written, from the root of this repository, and its output is shown under it, or
is the committed file it writes under [`examples/worked-example/`](../examples/worked-example/). What each
command printed is also committed, one file per command, in
[`examples/worked-example/transcript/`](../examples/worked-example/transcript/), written by
[`repeat.sh`](../examples/worked-example/repeat.sh) (run it after the setup of the next section; a command that
prints nothing leaves no file). The output shown here is that transcript, line for line. A `[exit N]` line is
the command's exit status when it is not 0. The `rpm -q` and `lv2ls` lines and the package versions are those of
the container the run was made in. Nothing here was run on a Zynthian or a MOD: the last section says what
comes from Zynthian's sources and what is still to be seen on one.

## Where it ran

A Fedora 44 container (the `openmixer-worker` image, whose packages the commands below upgrade), the Fedora
repositories and the FreeMixer channel enabled. The image also carries a copr repository, which the
installs leave out so that every plugin comes from Fedora itself. As root:

```
dnf -y -q --disablerepo=copr-ycollet-audinux install lv2-zam-plugins lsp-plugins-clap omx-clap-host plugin-hostd plugin-hostd-devel omx-contract-devel
dnf -y -q --disablerepo=copr-ycollet-audinux upgrade omx-contract omx-contract-devel omx-clap-host omx-clap-core plugin-hostd plugin-hostd-devel
ln -s "$PWD/bin/omx-panel.mjs" /usr/local/bin/omx-panel
dnf -y -q --disablerepo=copr-ycollet-audinux install omx-panel
```

and, as the user, `npm ci --silent` in this checkout.

On a stock Fedora 44, the OpenMixer channel comes first, as this repository's CI adds it
(`dnf install https://www.openmixer.org/rpm/openmixer-release.noarch.rpm`; not run here, the
image carries the channel), and `python3-lilv` and `sord` are installed with the rest (the image carries them:
`python3-lilv-0.26.4`, `sord-0.16.22`, `lv2-1.18.10`).

`omx-panel` is this checkout, run as `omx-panel` through the link above (`/usr/local/bin` comes before
`/usr/bin` on the path). The commands ran at `3ebf9b7`, the commit that adds `repeat.sh`; its omx-panel is
`origin/main` at `15cc25bb9` (pull request 26 merged, so the readout fix of omx-panel#25 is in), and the branch
adds only the example, this document, a line of the README and the exemption of the example's output files in
`tools/check-spdx.mjs`. The released omx-panel 0.2.5, installed last, is run as `/usr/bin/omx-panel`
once: it stops on ZamComp ([section 3](#the-released-025-on-zamcomp)). Every other
command runs as an unprivileged user.

## 1. The plugins as installed

```
$ mkdir -p examples/worked-example/zamcomp examples/worked-example/lsp-limiter-mono

$ rpm -q lv2-zam-plugins lsp-plugins-clap
lv2-zam-plugins-4.4-7.fc44.x86_64
lsp-plugins-clap-1.2.29-1.fc44.x86_64

$ rpm -ql lv2-zam-plugins | grep '^/usr/lib64/lv2/ZamComp.lv2/'
/usr/lib64/lv2/ZamComp.lv2/ZamComp_dsp.so
/usr/lib64/lv2/ZamComp.lv2/ZamComp_dsp.ttl
/usr/lib64/lv2/ZamComp.lv2/ZamComp_ui.so
/usr/lib64/lv2/ZamComp.lv2/ZamComp_ui.ttl
/usr/lib64/lv2/ZamComp.lv2/manifest.ttl
/usr/lib64/lv2/ZamComp.lv2/presets.ttl

$ rpm -qf /usr/lib64/clap/lsp-plugins.clap
lsp-plugins-clap-1.2.29-1.fc44.x86_64

$ lv2ls | grep -x urn:zamaudio:ZamComp
urn:zamaudio:ZamComp

$ lv2info urn:zamaudio:ZamComp > examples/worked-example/zamcomp/lv2info.txt

$ omx-clap-scan /usr/lib64/clap/lsp-plugins.clap | sed -n '/^  plugin in.lsp-plug.limiter_mono /,/^    note ports/p' > examples/worked-example/lsp-limiter-mono/omx-clap-scan.txt
```

[`zamcomp/lv2info.txt`](../examples/worked-example/zamcomp/lv2info.txt) is ZamComp as lilv reads it: three
audio ports, eight input controls (`att`, `rel`, `kn`, `rat`, `thr`, `mak`, `slew`, `sidech`, ports 3 to 10)
and two output controls, the readouts `gr` (gain reduction) and `outlevel` (ports 11 and 12). lilv lists the
three presets in an order that changes from run to run, so a repeat can differ from the committed file in those
three lines and nowhere else.
[`lsp-limiter-mono/omx-clap-scan.txt`](../examples/worked-example/lsp-limiter-mono/omx-clap-scan.txt) is the
limiter as omx-clap-scan lists it, version 1.0.33, 28 parameters; the scan of the whole `lsp-plugins.clap`
lists every plugin the file holds, and `sed` keeps this one.

## 2. The scan into a descriptor

One step writes a `scanned` descriptor (omx-contract `docs/descriptors.md`) for either format:
`plugin-hostd-probe describe` (plugin-hostd 0.7.0 and later, its `docs/formats.md`). It runs omx-clap-core's
`omx-clap-scan --fields`, the dump of every field one CLAP or LV2 plugin states, read as a host reads it (for
LV2, through lilv), and maps each field to a descriptor word by plugin-hostd's format tables. So the LV2 scan
to a descriptor exists, and it is the same step as the CLAP one.

```
$ rpm -q omx-clap-host omx-clap-core plugin-hostd omx-contract
omx-clap-host-0.20.1-1.fc44.x86_64
omx-clap-core-0.20.1-1.fc44.x86_64
plugin-hostd-0.10.0-1.fc44.x86_64
omx-contract-3.1.0-1.fc44.noarch

$ omx-clap-scan --fields lv2:urn:zamaudio:ZamComp > examples/worked-example/zamcomp/zamcomp.fields.tsv

$ plugin-hostd-probe describe lv2:urn:zamaudio:ZamComp > examples/worked-example/zamcomp/zamcomp.descriptor.json

$ omx-clap-scan --fields clap:/usr/lib64/clap/lsp-plugins.clap#in.lsp-plug.limiter_mono > examples/worked-example/lsp-limiter-mono/limiter_mono.fields.tsv

$ plugin-hostd-probe describe clap:/usr/lib64/clap/lsp-plugins.clap#in.lsp-plug.limiter_mono > examples/worked-example/lsp-limiter-mono/limiter_mono.descriptor.json
```

The dumps are the committed `.fields.tsv` files, the descriptors the `.descriptor.json` beside them. What a
scan cannot know, it writes as `unknown`:

- every control's `meaning` is `unknown` (neither format states what a control means), so the layout infers no
  family and no roles: both plugins are family `none`;
- ZamComp's units are its TTL's (`ms`, `dB`), its `rat` and `slew` state none (`unknown`); `gr` and `outlevel`
  are `readonly`, with a range and no default;
- the limiter's controls are keyed by CLAP parameter id, a number; their units are `unknown` and their scales
  `unknown` or `stepped`, as CLAP states neither.

## 3. The layout and the MOD GUI

### ZamComp, with no panel file

```
$ omx-panel layout --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json > examples/worked-example/zamcomp/zamcomp.layout.json

$ omx-panel layout --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json --pages | tee examples/worked-example/zamcomp/zamcomp.pages.json
[
  {
    "section": 0,
    "sectionName": "Controls",
    "pageName": "Controls 1",
    "ids": [
      "att",
      "rel",
      "kn",
      "rat",
      "thr",
      "mak",
      "slew",
      "sidech"
    ]
  },
  {
    "section": 0,
    "sectionName": "Controls",
    "pageName": "Controls 2",
    "ids": [
      "gr",
      "outlevel",
      null,
      null,
      null,
      null,
      null,
      null
    ]
  }
]
```

ZamComp's TTL states no port groups, so every control is in the one section `Controls`, in port order, cut
into pages of eight (the page rule of `docs/panel-layout.md`). The two readouts take the second page: the
layout pages every control it lists, a readout included.

```
$ omx-panel modgui --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json --out examples/worked-example/zamcomp/no-panel/ZamComp.lv2
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui.ttl
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui/icon-ZamComp.html
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui/stylesheet-ZamComp.css
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui/screenshot-ZamComp.png
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui/thumbnail-ZamComp.png
modgui: wrote examples/worked-example/zamcomp/no-panel/ZamComp.lv2/modgui/knobs/omx-knob.png

$ tools/modgui-test.sh examples/worked-example/zamcomp/no-panel/ZamComp.lv2 examples/worked-example/zamcomp/zamcomp.descriptor.json
PASS modgui-gen --check ZamComp
PASS template draws att with its declared travel and default
PASS template draws rel with its declared travel and default
PASS template draws kn with its declared travel and default
PASS template draws rat with its declared travel and default
PASS template draws thr with its declared travel and default
PASS template draws mak with its declared travel and default
PASS template draws slew with its declared travel and default
PASS template draws sidech with its declared travel and default
PASS template draws readout gr as a display with its declared range
PASS template draws readout outlevel as a display with its declared range
PASS template draws exactly the 10 declared parameters
PASS sord_validate ZamComp.lv2/*.ttl against the LV2 specs, modgui terms and resource-hint terms (Found 21 errors among 85 files (checked 1947 restrictions); all 21 the label errors of omx-contract#144)
PASS sord_validate refuses a modgui property outside modgui-terms.ttl
PASS a moved default makes modgui-gen --check fail
```

The eight input controls are knobs (none is a toggle or a choice in the TTL), the two readouts displays
(`docs/modgui.md`); `modgui.ttl` lists the eight as `modgui:port`.

### ZamComp, with a panel file

[`zamcomp/zamcomp.panel.json`](../examples/worked-example/zamcomp/zamcomp.panel.json) is a panel written for
this example: the detector controls in one section, the makeup gain in a second as a fader, the two readouts in
a third. Its family is `none`: a declared `dynamics` would be refused, since no control of the scan carries the
meaning `threshold` or `ratio` (`docs/panel-layout.md`, the family).

```
$ omx-panel layout --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json --panel examples/worked-example/zamcomp/zamcomp.panel.json --pages | tee examples/worked-example/zamcomp/zamcomp.panel.pages.json
[
  {
    "section": 0,
    "sectionName": "Detector",
    "pageName": "Detector",
    "ids": [
      "thr",
      "rat",
      "kn",
      "att",
      "rel",
      "slew",
      "sidech",
      null
    ]
  },
  {
    "section": 1,
    "sectionName": "Output",
    "pageName": "Output",
    "ids": [
      "mak",
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ]
  },
  {
    "section": 2,
    "sectionName": "Meters",
    "pageName": "Meters",
    "ids": [
      "gr",
      "outlevel",
      null,
      null,
      null,
      null,
      null,
      null
    ]
  }
]

$ omx-panel modgui --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json --panel examples/worked-example/zamcomp/zamcomp.panel.json --out examples/worked-example/zamcomp/with-panel/ZamComp.lv2
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui.ttl
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/icon-ZamComp.html
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/stylesheet-ZamComp.css
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/screenshot-ZamComp.png
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/thumbnail-ZamComp.png
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/knobs/omx-knob.png
modgui: wrote examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui/knobs/omx-fader.png

$ tools/modgui-test.sh examples/worked-example/zamcomp/with-panel/ZamComp.lv2 examples/worked-example/zamcomp/zamcomp.descriptor.json examples/worked-example/zamcomp/zamcomp.panel.json
PASS modgui-gen --check ZamComp
PASS template draws thr with its declared travel and default
PASS template draws rat with its declared travel and default
PASS template draws kn with its declared travel and default
PASS template draws att with its declared travel and default
PASS template draws rel with its declared travel and default
PASS template draws slew with its declared travel and default
PASS template draws sidech with its declared travel and default
PASS template draws mak with its declared travel and default
PASS template draws readout gr as a display with its declared range
PASS template draws readout outlevel as a display with its declared range
PASS template draws exactly the 10 declared parameters
PASS sord_validate ZamComp.lv2/*.ttl against the LV2 specs, modgui terms and resource-hint terms (Found 21 errors among 85 files (checked 1938 restrictions); all 21 the label errors of omx-contract#144)
PASS sord_validate refuses a modgui property outside modgui-terms.ttl
PASS a moved default makes modgui-gen --check fail
```

With the panel, `modgui.ttl` lists the seven controls of the first section, `Detector`, as `modgui:port`, and
the makeup fader brings its own film strip.

### The released 0.2.5 on ZamComp

```
$ rpm -q omx-panel
omx-panel-0.2.5-1.fc44.noarch

$ /usr/bin/omx-panel modgui --descriptor examples/worked-example/zamcomp/zamcomp.descriptor.json --out /tmp/zamcomp-0.2.5.lv2 2>&1 | grep '^Error'
Error: modgui-gen: 'gr' is not a declared control input with a travel
```

That is omx-panel#25: 0.2.5 looks a travel up for a readout. This checkout carries the fix.

### LSP Limiter Mono, a CLAP plugin

```
$ omx-panel layout --descriptor examples/worked-example/lsp-limiter-mono/limiter_mono.descriptor.json > examples/worked-example/lsp-limiter-mono/limiter_mono.layout.json

$ omx-panel layout --descriptor examples/worked-example/lsp-limiter-mono/limiter_mono.descriptor.json --pages > examples/worked-example/lsp-limiter-mono/limiter_mono.pages.json

$ omx-panel modgui --descriptor examples/worked-example/lsp-limiter-mono/limiter_mono.descriptor.json --out /tmp/limiter_mono.lv2 2>&1 | grep '^Error'
Error: modgui-gen: 'in.lsp-plug.limiter_mono' states no LV2 URI; a MOD GUI belongs to an LV2 bundle
```

The limiter's 28 controls state no group, so they are one section `Controls`, four pages of eight, the last
holding four ([`limiter_mono.pages.json`](../examples/worked-example/lsp-limiter-mono/limiter_mono.pages.json),
each slot a CLAP parameter id). These are the pages a CLAP host shows through `clap.remote-controls`. A MOD GUI
belongs to an LV2 bundle, so the generator refuses a CLAP descriptor by name; lsp-plugins also ships an LV2
build, which would be scanned as `lv2:<uri>` and go the way of ZamComp.

Not every lsp CLAP plugin lays out yet. Filter Mono has two parameters named "Filter mode", and a CLAP
control, whose id is a number, is keyed by its name:

```
$ plugin-hostd-probe describe clap:/usr/lib64/clap/lsp-plugins.clap#in.lsp-plug.filter_mono > examples/worked-example/lsp-limiter-mono/filter_mono.descriptor.json

$ omx-panel layout --descriptor examples/worked-example/lsp-limiter-mono/filter_mono.descriptor.json --pages
omx-panel: examples/worked-example/lsp-limiter-mono/filter_mono.descriptor.json: 'Filter mode' is a control twice
[exit 1]
```

That is omx-panel#27. [`survey-lsp-mono.sh`](../examples/worked-example/survey-lsp-mono.sh) scans and lays out
every mono plugin of the file:

```
$ bash examples/worked-example/survey-lsp-mono.sh
refused in.lsp-plug.filter_mono: omx-panel: <descriptor>: 'Filter mode' is a control twice
refused in.lsp-plug.sampler_mono: omx-panel: <descriptor>: 'Sample pitch' is a control twice
refused in.lsp-plug.trigger_midi_mono: omx-panel: <descriptor>: 'Sample pitch' is a control twice
refused in.lsp-plug.trigger_mono: omx-panel: <descriptor>: 'Sample pitch' is a control twice
59 laid out, 4 refused
```

With `--all` it also lists the 59 plugins that lay out, one `ok` line each
([`transcript/27a-survey-lsp-mono-all.txt`](../examples/worked-example/transcript/27a-survey-lsp-mono-all.txt)).
The four refusals have the cause of Filter Mono's, a name two parameters share.

## 4. Zynthian

What follows comes from Zynthian's sources (zynthian-ui `f46b018` and zynthian-sys `0774a58`, both on their
`vangelis` branch; zynthian-plugins `648c84a`, its `master`), the omx-plugins README, and the lilv
runs shown. Each file and line cited is at those commits. None of it was seen on a Zynthian.

### Where Zynthian looks for LV2 bundles and their MOD GUIs

- `LV2_PATH` is `/usr/lib/lv2:/usr/lib/arm-linux-gnueabihf/lv2:/usr/local/lib/lv2:$ZYNTHIAN_PLUGINS_DIR/lv2:`
  `$ZYNTHIAN_DATA_DIR/presets/lv2:$ZYNTHIAN_MY_DATA_DIR/presets/lv2` (zynthian-sys
  `scripts/zynthian_envars.sh:107`), with `ZYNTHIAN_PLUGINS_DIR` `/zynthian/zynthian-plugins` (`:105`).
  zynthian-ui loads it with lilv's `world.load_all()` (`zyngine/zynthian_lv2.py:213`).
- A bundle a user adds goes to `/zynthian/zynthian-plugins/lv2` (`LV2_DIR`, `zynthian_lv2.py:197`): the
  webconf upload copies it there through `add_engine` (`zynthian_lv2.py:386`), and the omx-plugins README has a
  Zynthian without the apt channel copy its `lv2/` bundles there and rescan the LV2 plugins from the admin
  menu. A plugin the rescan finds for the first time is disabled until enabled (`zynthian_lv2.py:619`).
- The last commit of the zynthian-plugins repository (directories `dssi`, `ladspa`, `lv2`, `vst`) is
  `648c84a`, dated 2016-09-21. The image's setup script installs LV2 plugins with `apt-get`, and the list
  names `zam-plugins` (zynthian-sys `scripts/setup_plugins_rbpi.sh:42-52`, the name on line 52); the recipe
  that builds zam-plugins from source, `scripts/recipes/install_zam.sh`, is commented out at
  `setup_plugins_rbpi.sh:94`. That the Debian package carries the same ZamComp as Fedora's, and puts it in
  `/usr/lib/lv2`, is not read from these sources.
- A MOD GUI is drawn by MOD-UI, which Zynthian runs as an engine of its own (zynthian-ui
  `zyngine/zynthian_engine_modui.py`; zynthian's mod-ui fork, `scripts/recipes/install_mod-ui.sh`, run by
  `setup_system_raspioslite_64bit_trixie.sh:562`). Its service takes an `LV2_PATH`
  (`etc/systemd/mod-ui.service:11`) that `scripts/update_zynthian_sys.sh:527` fills from the value set at `:188`:
  the same directories as above plus `/usr/lib/$arch_libdir/lv2` and `$ZYNTHIAN_PLUGINS_DIR/lv2-presets`.

### How the bundle gets there

A MOD GUI is read only when the bundle's manifest names `modgui.ttl`, and only from the bundle lilv takes the
plugin from. Both are shown on a copy of the installed bundle:

```
$ rm -rf /tmp/stage && mkdir -p /tmp/stage

$ cp -R /usr/lib64/lv2/ZamComp.lv2 /tmp/stage/

$ cp -R examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui.ttl examples/worked-example/zamcomp/with-panel/ZamComp.lv2/modgui /tmp/stage/ZamComp.lv2/

$ LV2_PATH=/tmp/stage python3 examples/worked-example/lilv-modgui.py urn:zamaudio:ZamComp
plugin  urn:zamaudio:ZamComp
bundle  file:///tmp/stage/ZamComp.lv2/
modgui:gui  none
[exit 1]

$ printf '\n<urn:zamaudio:ZamComp> rdfs:seeAlso <modgui.ttl> .\n' >> /tmp/stage/ZamComp.lv2/manifest.ttl

$ LV2_PATH=/tmp/stage python3 examples/worked-example/lilv-modgui.py urn:zamaudio:ZamComp
plugin  urn:zamaudio:ZamComp
bundle  file:///tmp/stage/ZamComp.lv2/
modgui:resourcesDirectory  file:///tmp/stage/ZamComp.lv2/modgui
modgui:iconTemplate  file:///tmp/stage/ZamComp.lv2/modgui/icon-ZamComp.html
modgui:stylesheet  file:///tmp/stage/ZamComp.lv2/modgui/stylesheet-ZamComp.css
modgui:screenshot  file:///tmp/stage/ZamComp.lv2/modgui/screenshot-ZamComp.png
modgui:thumbnail  file:///tmp/stage/ZamComp.lv2/modgui/thumbnail-ZamComp.png
modgui:brand  Damien Zammit
modgui:label  ZamComp
modgui:port  0 thr
modgui:port  1 rat
modgui:port  2 kn
modgui:port  3 att
modgui:port  4 rel
modgui:port  5 slew
modgui:port  6 sidech

$ LV2_PATH=/usr/lib64/lv2:/tmp/stage python3 examples/worked-example/lilv-modgui.py urn:zamaudio:ZamComp
lilv_world_compare_versions(): warning: Ignoring duplicate version 6.0 of <urn:zamaudio:ZamComp> from <file:///tmp/stage/ZamComp.lv2/>
lilv_world_compare_versions(): note: Previously loaded from <file:///usr/lib64/lv2/ZamComp.lv2/>
plugin  urn:zamaudio:ZamComp
bundle  file:///usr/lib64/lv2/ZamComp.lv2/
modgui:gui  none
[exit 1]

$ LV2_PATH=/tmp/stage:/usr/lib64/lv2 python3 examples/worked-example/lilv-modgui.py urn:zamaudio:ZamComp | head -3
lilv_world_compare_versions(): warning: Ignoring duplicate version 6.0 of <urn:zamaudio:ZamComp> from <file:///usr/lib64/lv2/ZamComp.lv2/>
lilv_world_compare_versions(): note: Previously loaded from <file:///tmp/stage/ZamComp.lv2/>
plugin  urn:zamaudio:ZamComp
bundle  file:///tmp/stage/ZamComp.lv2/
modgui:resourcesDirectory  file:///tmp/stage/ZamComp.lv2/modgui
```

[`lilv-modgui.py`](../examples/worked-example/lilv-modgui.py) asks lilv, the library mod-ui reads LV2 data
with, for the plugin's `modgui:gui`. The manifest line is added by hand: `omx-panel modgui` leaves the manifest
as it is (omx-panel#28). Of two bundles with one plugin URI and one version, lilv keeps the first on
`LV2_PATH` and ignores the other.

The test over the whole staged bundle:

```
$ tools/modgui-test.sh /tmp/stage/ZamComp.lv2 examples/worked-example/zamcomp/zamcomp.descriptor.json examples/worked-example/zamcomp/zamcomp.panel.json
PASS modgui-gen --check ZamComp
PASS template draws thr with its declared travel and default
PASS template draws rat with its declared travel and default
PASS template draws kn with its declared travel and default
PASS template draws att with its declared travel and default
PASS template draws rel with its declared travel and default
PASS template draws slew with its declared travel and default
PASS template draws sidech with its declared travel and default
PASS template draws mak with its declared travel and default
PASS template draws readout gr as a display with its declared range
PASS template draws readout outlevel as a display with its declared range
PASS template draws exactly the 10 declared parameters
error: Object not in range <http://lv2plug.in/ns/lv2core#ExtensionData>

error: Use of undefined property
       urn:zamaudio:ZamComp
error: Property <http://moddevices.com/ns/mod#brand> has no label
       urn:zamaudio:ZamComp
error: Use of undefined property
       urn:zamaudio:ZamComp
error: Property <http://moddevices.com/ns/mod#label> has no label
       urn:zamaudio:ZamComp
error: Object not in range <http://lv2plug.in/ns/lv2core#ExtensionData>
FAIL sord_validate ZamComp.lv2/*.ttl (Found 27 errors among 89 files (checked 2194 restrictions))
PASS sord_validate refuses a modgui property outside modgui-terms.ttl
PASS a moved default makes modgui-gen --check fail
modgui-test: 1 check(s) failed
[exit 1]
```

The six errors besides the 21 of omx-contract#144 are ZamComp's own TTL's, and the installed bundle, untouched,
has the same six against the same LV2 specifications:

```
$ for s in core port-props units urid atom worker ui options midi patch time log state buf-size parameters presets resize-port port-groups morph dynmanifest instance-access data-access event uri-map schemas; do set -- "$@" /usr/lib64/lv2/$s.lv2/*.ttl; done; sord_validate /usr/lib64/lv2/ZamComp.lv2/*.ttl "$@" 2>&1 | grep -A1 '^error'
error: Object not in range <http://lv2plug.in/ns/lv2core#ExtensionData>

--
error: Use of undefined property
       urn:zamaudio:ZamComp
--
error: Property <http://moddevices.com/ns/mod#brand> has no label
       urn:zamaudio:ZamComp
--
error: Use of undefined property
       urn:zamaudio:ZamComp
--
error: Property <http://moddevices.com/ns/mod#label> has no label
       urn:zamaudio:ZamComp
--
error: Object not in range <http://lv2plug.in/ns/lv2core#ExtensionData>
```

On a Zynthian where the Debian package has put ZamComp in `/usr/lib/lv2/ZamComp.lv2` (not read from the
sources, see above), that bundle is first on `LV2_PATH`, and a copy of the bundle in
`/zynthian/zynthian-plugins/lv2` would be ignored by lilv as above. `add_engine` refuses a plugin whose engine
is already registered unless `force` is set (`zynthian_lv2.py:411-424`). The MOD GUI then goes into the bundle
lilv takes: copy `modgui.ttl` and `modgui/` from
`examples/worked-example/zamcomp/with-panel/ZamComp.lv2/` into `/usr/lib/lv2/ZamComp.lv2/`, append the same
`rdfs:seeAlso` line to its `manifest.ttl`, and restart MOD-UI. That step was not run, and a `zam-plugins`
upgrade would overwrite the manifest. The descriptor should be the scan of the Zynthian's own ZamComp, whose
Debian version may differ from Fedora's 4.4.

### What the encoder pages show

The pages of eight above are the layout's: what a CLAP host shows through `clap.remote-controls`. Zynthian's
touchscreen does not read them. For an LV2 plugin hosted by jalv it builds its own screens of four
(zynthian-ui `zyngine/zynthian_engine.py`, `generate_ctrl_screens`, lines 681 to 724):

- the controls are the plugin's input control ports, in port order (`zynthian_lv2.py:940`, `get_plugin_ports`),
  sorted by `lv2:displayPriority`, and grouped by `pg:group`; ungrouped controls are the group `Params`;
- each group is cut into screens of four, numbered from 1 when a group has more than four;
- an audio effect with no bypass port of its own gets a `bypass` control, added last
  (`zyngine/zynthian_engine_jalv.py:544`);
- output control ports are no controllers: a readout is never on a screen.

ZamComp states no port group and no display priority:

```
$ grep -c -E 'portgroups|pg:group|displayPriority' /usr/lib64/lv2/ZamComp.lv2/ZamComp_dsp.ttl
0
[exit 1]
```

So, by those rules, Zynthian shows ZamComp as `Params 1` (Attack, Release, Knee, Ratio), `Params 2`
(Threshold, Makeup, Slew, Sidechain) and `Params 3` (bypass), and neither `gr` nor `outlevel`. This is read
from the source, not seen. The layout's sections do not reach Zynthian's screens: an LV2 bundle would carry
them as `pg:group` in its TTL, which the MOD GUI generator does not write. The word `clap` appears in no file
of zynthian-ui at `f46b018` (`grep -ri clap` finds nothing), and in zynthian-sys at `0774a58` only once, in
a name misspelt "Claption" in a plugin description (`config/engine_config.json:7932`), so those sources name no
CLAP host or plugin and the limiter's pages are not shown there.

## What is verified, and what is not

Verified, by the commands above: both plugins come from Fedora 44's own packages; `plugin-hostd-probe
describe` writes a `scanned` descriptor of each; `omx-panel layout` lays out ZamComp with and without a panel
file and the limiter, and stops on Filter Mono and three more of the 63 mono lsp plugins (omx-panel#27); `omx-panel modgui` writes ZamComp's MOD GUI with
and without a panel file, each bundle passing `tools/modgui-test.sh`, and refuses the CLAP limiter by name;
omx-panel 0.2.5 stops on ZamComp's readout (omx-panel#25); lilv reads the MOD GUI from a copy of the bundle
once its manifest names `modgui.ttl`, and keeps the first of two bundles of one plugin on `LV2_PATH`.

Not verified:

- anything on a Zynthian or a MOD: the bundle's install there, MOD-UI drawing the template, the screens of
  four, the rescan;
- the template as mod-ui draws it in a browser: the tests read the template's text and its TTL, not a render;
- the readouts' displays showing a value: the generated MOD GUI draws a frame, and a live reading needs a
  `modgui:javascript`, which is not generated (`docs/modgui.md`);
- ZamComp's Debian build (Zynthian's) having the same ports as Fedora's;
- the limiter's pages on a CLAP host with a controller.
