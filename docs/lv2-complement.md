<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# The LV2 complement: a replacing bundle with the inferred port groups

`tools/group-infer.mjs` ([group-inference.md](group-inference.md)) infers the port groups an LV2 plugin lacks.
`tools/lv2-complement.mjs` (`omx-panel complement`, run at install time by `omx-complement-sync`) carries them to
the programs that read plugins through lilv, the Zynthian touchscreen's jalv first: plugin-hostd#218, lane G2.

```
omx-panel complement --out <dir> [--lv2-path <a:b:...>] [--state <dir>] [--only <bundle.lv2>]... [--dry-run | --check] [--verbose]
omx-complement-sync [--dry-run] [--verbose] | --check
```

## Why a replacing bundle

A second bundle that only adds `pg:group` to a plugin cannot work: a plugin's ports are blank nodes, local to the file
that states them, so another file has nothing to attach a group to. What lilv does offer is its duplicate rule: a
bundle that declares a plugin already loaded **replaces** it when its `lv2:minorVersion`/`lv2:microVersion` is newer,
and is dropped when it is equal or older (lilv `world.c`, `lilv_world_load_bundle`; the order of the search list does
not change which bundle wins, it is a comparison; it changes what the load costs, [below](#the-search-order-the-same-result-not-the-same-cost)). lilv reads a version only when both values are stated, with `atoi`; otherwise it is
0.0.

lilv drops the **whole** old bundle when one of its plugins is replaced ("Dropping old bundle"): replacing MDA's
RezFilter alone left one of MDA's 36 plugins listed. So the unit the writer works on is the installed bundle, not the
plugin. For a bundle with one plugin to group it writes a bundle that restates every plugin of it, each one bumped;
the groups go to the grouped plugins only, the others are restated unchanged.

## What is written

For an installed bundle `<dir>/<name>.lv2` holding at least one plugin whose verdict is `grouped`, the bundle
`<out>/omx-complement-<name>.lv2` holds:

- **every TTL file lilv reads for it**, restated: `manifest.ttl` and each file a plugin's `rdfs:seeAlso` names there
  (what lilv's `load_plugin_model` reads). Each file is parsed by `tools/turtle-read.mjs` and written back statement
  for statement: every IRI as the reader resolved it (absolute), every literal with its own lexical form and datatype
  or language (`+30`, `0.0`, `1e-05` stay as written; a number is written as a number only when the reader would read
  it back as the same lexical form and type), every blank node under a label prefixed by its file (`_:f1_b12`): lilv
  keeps each file's blank nodes apart, a tool that reads all the files into one graph (sord_validate) does not.
  Nothing is retyped and nothing is left out; comments are not statements and are not carried.
- **`rdfs:seeAlso` pointing at the restated files** (written relative, `<plugin.ttl>`), so lilv reads ours; any other
  `rdfs:seeAlso` (a preset, a UI) still names the installed file.
- **`lv2:binary` unchanged**: the reader resolved it to the installed library's absolute `file:` IRI, which resolves
  from anywhere. Every other entry of the installed bundle (the library, presets, a MOD GUI, resources) is linked in
  by a symbolic link, because lilv hands a plugin its bundle path (ours now) and some plugins read their own files
  from there.
- **the version**: each plugin's `lv2:minorVersion` and `lv2:microVersion` statements are dropped and `manifest.ttl`
  states `lv2:minorVersion` = the installed value (0 when none) and `lv2:microVersion` = the installed value + 1 (1
  when none). A plugin stating only a minor version (lilv reads 0.0) keeps its minor.
- **the groups**: for each group of the verdict, a node `<#<plugin>-<symbol>>` in the file that states the plugin's
  ports, typed `pg:Group`, with `lv2:symbol`, `lv2:name` and `lv2:displayPriority`, and `pg:group` on each of its
  ports, found by `lv2:symbol` in that file. A group the plugin states itself (rule 1) keeps its own node: only what
  that node lacks of `lv2:symbol`, `lv2:name` and `lv2:displayPriority` is added, and a port that already carries a
  `pg:group` keeps it. A generated node never merges into one already there: `<#<plugin>-<symbol>>` is resolved as the
  Turtle reader resolves it, against the installed file (what the plugin's own `<#…>` of that fragment means) and
  against the written file at its target (what lilv will read), and when either IRI is one the bundle already states,
  or another grouped plugin of the same file would take the same node (two plugin URIs ending in the same word), the
  bundle is refused (`group-iri-collision`). Refused rather than given a suffix: a node whose name cannot be predicted
  from the plugin and the group symbol would surprise whoever looks it up, and over the 979 plugins on the desk the
  guard refuses none (37 bundles, 84 grouped plugins, as before), so the conservative choice costs nothing measured.
- **the marker** `.omx-complement-sync`, in the bundle, as omx-modgui-sync marks its own with `.omx-modgui-sync`:

  ```
  /usr/lib64/lv2/triple_para-swh.lv2
  writer <sha256 of lv2-complement.mjs, group-infer.mjs and turtle-read.mjs>
  source-sha256 <sha256 of the installed TTL files read, name and bytes>
  plugin http://plugin.org.uk/swh-plugins/triplePara 0.0 0.1 grouped 5
  file manifest.ttl <sha256>
  file plugin.ttl <sha256>
  ```

  The first three lines decide: a bundle whose marker names the same installed bundle, writer and content hash is up
  to date and is not written again (a second run writes nothing, byte for byte the same tree). A changed installed
  file (an upgrade) or a changed rule rewrites it (`replaced …`, the line saying which changed). A directory of our
  name **without** the marker is never written. Deleting the bundle is the whole removal; lilv loads the installed
  bundle again.

`lv2:displayPriority` is what zynthian-ui reads on a group node (`zyngine/zynthian_lv2.py`). It is not in the LV2
vocabulary (the port-props extension defines `pprops:displayPriority`, for a port), so `sord_validate` reports it as an
undefined property: over the 37 bundles written on the desk, those are the only messages it gives on ours that it does
not give on the installed files.

## What is not written

- A bundle none of whose plugins is `grouped`: a plugin that carries its own groups (our omx-plugins, synthv1, x42
  matrixmixer), fits one screen, or has no confident grouping is left exactly as it is, no bundle and no marker.
- The installed files: never opened for writing.
- A bundle the restatement cannot carry is **refused**, named on its own line with the reason, counted in the summary,
  and never written (lane G4 decides what the proxy fallback does with these):
  - `ttl-unreadable`: a file the reader cannot parse (`ttl-missing`: a `rdfs:seeAlso` file that does not exist);
  - `version-ceiling`: a version past lilv's `int` (2147483647), or a micro version a bump would take past it;
    `version-unreadable`: a version that is not an integer; `version-not-newer`: a bump that would still not be newer;
  - more than one subject for the URI: `version-ambiguous` (two values of `lv2:minorVersion` or `lv2:microVersion`),
    `binary-ambiguous` (two `lv2:binary`; `no-binary` for none), `plugin-in-several-bundles` (the plugin URI declared by
    two installed bundles: lilv picks between them by version, and the restatement cannot say which it replaces),
    `port-symbol-ambiguous` (two ports of one symbol);
  - `dynamic-manifest`, `data-outside-bundle` (a plugin's `rdfs:seeAlso` outside its bundle), `ports-split-across-files`;
  - `group-iri-collision`: a generated group node whose IRI the bundle already states, or that two grouped plugins of
    one file would share (above).
## What is removed

A bundle of ours left in place past its time does harm: its bumped version keeps winning, so it would hide an upgraded
plugin behind the old restatement, or keep a removed one listed with a library that is gone. So each run, after
writing, removes every bundle of ours it did not find up to date or write again, as omx-modgui-sync removes its GUIs,
one line each naming the bundle and why (`removed <bundle>: <installed bundle>: <reason>`):

- its installed bundle is gone, or no longer on the search list (the package was removed);
- its installed bundle changed (the content hash in the marker no longer matches) into one the writer refuses (the
  reason is the refusal's), or that declares no plugin;
- none of the installed bundle's plugins comes out `grouped` on the current rules (the rules changed, or the upgrade
  brought the plugin's own groups).

An installed bundle that changed and still has a plugin to group is written again, which replaces ours whole. Ours is
a directory named `omx-complement-*.lv2` that holds the marker, and only that is ever removed: a directory without the
marker, one of another name, or a symbolic link to a marked directory is left alone. With `--only`, only the bundles
written for the bundles named are considered. Once ours is deleted lilv loads the installed bundle again (the test
proves it through python3-lilv, and `lv2info` shows it, below).

`--dry-run` prints `would remove …` for each and removes nothing. `--check` writes and removes nothing and names each
bundle of ours that is `stale` (the sync removes it) or `out of date` (the sync writes it again; a bundle not written
yet is named `missing` and is not stale); it exits 3 when there is one, 0 when there is none, 1 when it cannot run, 2
on usage.

## Where it runs, and whether lilv sees it

`omx-complement-sync` (`bin/`) is omx-modgui-sync's twin and runs beside it: the same shell shape calling omx-panel,
the same `/etc/omx/modgui-sync.conf`, the same directories, the same opt-in unit (`omx-complement-sync.service`,
installed and never enabled) queued by the same drop-in on `plugin-qualify-sync.service` after each scan, the same
`--dry-run` and `--check`.

What triggers a run, once the unit is enabled: plugin-qualify's package triggers (rpm `%transfiletriggerin` and
`%transfiletriggerpostun`, dpkg `interest-noawait`) on `/usr/lib/lv2`, `/usr/lib64/lv2` and `/usr/local/lib/lv2` fire
once per package transaction that installs, upgrades or removes a file there, and start `plugin-qualify-sync.service`;
its path unit does the same for a change in those folders (and the ones `qualify.conf` adds) outside a package
manager; its timer runs it after boot. When that scan finishes, the drop-in
(`plugin-qualify-sync.service.d/omx-complement-sync.conf`) queues `omx-complement-sync.service` from `ExecStartPost`,
so a removal or an upgrade is followed by the removal or the rewrite of our bundle within the scan's minute of quiet
plus its run. Two limits: `ExecStartPost` runs only when the scan exits 0 (plugin-qualify-sync exits 0 whatever its
verdicts and 2 when it cannot run, and then this waits for the next scan); and in a transaction without systemd (an
image build, a chroot) the trigger runs the scan directly, with no unit and no drop-in, so the complement follows at the
next boot (the unit is `WantedBy=multi-user.target`). Our own writes and removals in `/usr/local/lib/lv2` are changes
the path unit sees too: they queue one more scan, after which the complement finds everything up to date and changes
nothing. It writes its bundles where omx-modgui-sync writes its GUIs: `MODGUI_DIR`, by default
`/usr/local/lib/lv2` for root (`~/.lv2` for a user); its work files go under `STATE_DIR` (`/var/lib/omx/modgui-sync`),
outside the LV2 path, and each bundle is moved in whole.

lilv loads the bundles only from its own `LV2_PATH`. On Zynthian, `/usr/local/lib/lv2` is on it: `zynthian_envars*.sh`
(zynthian-sys) export `LV2_PATH=/usr/lib/lv2:/usr/lib/<arch>/lv2:/usr/local/lib/lv2:...`, which zynthian-ui and the
jalv it spawns per plugin inherit, and the mod-host and mod-ui units carry the same list. zynthian-sys gives
omx-modgui-sync a drop-in that sets that `LV2_PATH`; `omx-complement-sync.service` needs the same drop-in there, so it
reads the plugins Zynthian loads. `omx-complement-sync --check` says whether `MODGUI_DIR` is on the search list. A
complemented plugin's MOD GUI from omx-modgui-sync still applies: that bundle declares no plugin, only GUI statements
about the plugin URI, which lilv merges whatever bundle the plugin itself comes from.

## The search order: the same result, not the same cost

Whether `MODGUI_DIR` comes before or after the installed folders on `LV2_PATH`, lilv ends with the same plugins, ours
in place of the installed ones (the version comparison decides, not the order). What the order changes is the work:
ours first, lilv meets the installed bundle second, finds it older and ignores it; ours last, it loads the installed
bundle, then meets ours, replaces every plugin of it, drops the old bundle and prints a line for each replacement.

Measured by the G2 review on the Fedora 44 desk with 979 plugins installed and the 37 bundles written (2026-10-28), not
on a Zynthian: `lv2ls` takes 0.01 s over the installed folders alone, 0.03 s with ours first, and 0.37 s with ours
last, when lilv also prints 1398 replace lines. Zynthian's `zynthian_envars*.sh` puts `/usr/local/lib/lv2` after the
system folders, so on the touchscreen ours comes last: the costly order. Every program that builds a lilv world pays it
at start (zynthian-ui, each jalv it spawns, mod-host, mod-ui). Lane G4 measures it on the Pi, where the figure that
matters is what it adds to jalv's start and to zynthian-ui's plugin scan. Nothing here changes the search order: it is
Zynthian's (and each distribution's) to set, and the result is the same either way.

## Measured

Over the 979 plugins installed on a Fedora 44 desk (2026-10-28), in 4.8 s: 84 grouped, 471 nothing to do, 424 without
a confident grouping (G1's figures); 37 bundles written, holding 466 plugins (84 of them grouped), none refused, 25 MB
(LSP's restated bundle is 22 MB, its installed TTL 16.9 MB). With the bundles on `LV2_PATH`, `lv2ls` lists the same 979
plugins whatever the order of the search list; `lv2info` and python3-lilv load each complemented plugin from ours, at
the bumped version, with its groups, and instantiate it from the installed library; deleting a bundle loads the
installed one again. The removal, with `lv2info` over a scratch `LV2_PATH` (ours first, a copy of the installed
`triple_para-swh.lv2` second): a copy upgraded into one the writer refuses (`lv2:microVersion "beta"`) still loads ours
at 0.1 until the sync, which names it `stale` under `--check` (exit 3) and then removes it ("it changed, and it is
refused now (version-unreadable …)"), after which `lv2info` loads the installed copy with no groups; with the copy
deleted (the package removed) `lv2ls` still lists the plugin from ours, its binary gone, until the sync removes ours
("its installed bundle … is gone") and the plugin is no longer listed. The tests (`test/lv2-complement.test.mjs`) build installed-shaped bundles from G1's fixtures
(`test/fixtures/lv2-groups`) and prove each of these points, the lilv ones through python3-lilv when it is installed.

## Open for review

- The group names are G1's: "Group N" when the names share no word, "More" / "More 2" for index runs (x42 stepseq's
  notes fall to "More").
- `lv2:displayPriority` versus the vocabulary's `pprops:displayPriority`, above: we write the term the touchscreen
  reads.
- A whole multi-plugin bundle is restated to group a few of its plugins (LSP: 30 of 194). The alternative, refusing
  such bundles, would leave most of the grouped plugins without groups.
