<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> -->
# omx-panel

Panels for audio plugins, generated from what the plugin declares. Give any LV2 or CLAP plugin a panel
without drawing one: a MOD GUI for MOD and Zynthian, pages for a controller, a layout for a host, all from
the plugin's own declaration, in the omx look, vintage or modern.

`omx-modgui-sync` gives a generated MOD GUI to every installed LV2 plugin that ships none, and
`omx-complement-sync` carries the port groups an LV2 plugin lacks to lilv, for jalv on the Zynthian
touchscreen. Neither touches an installed bundle.

## Install

Fedora 44, x86_64 or aarch64:

```
sudo dnf install https://www.openmixer.org/rpm/openmixer-release.noarch.rpm
sudo dnf install omx-panel
```

Debian bookworm and trixie, amd64 or arm64 (also Raspberry Pi OS and Zynthian):

```
curl -fsSLO https://www.openmixer.org/deb/openmixer-release.deb && sudo apt install ./openmixer-release.deb
sudo apt install omx-panel
```

Also on npm: `npm install @openmixer/omx-panel`.

## Start

```
omx-modgui-sync                                   # a MOD GUI for every installed LV2 plugin without one
sudo systemctl enable omx-modgui-sync             # and again after each plugin-qualify-sync scan
omx-panel modgui --descriptor <file> --out <bundle.lv2>
```

## Documentation

<https://www.openmixer.org/projects/omx-panel>, the manual pages (`omx-panel(1)`, `omx-modgui-sync(1)`,
`omx-complement-sync(1)`), and in this repository: what each tool does and the skin package for plugin authors
([docs/overview.md](docs/overview.md)); building from source ([BUILDING.md](BUILDING.md)).

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
