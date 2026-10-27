# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
Name: omx-panel
Version: 0.3.1
Release: 1%{?dist}
License: GPL-3.0-or-later
Summary: Panels for LV2 and CLAP plugins, generated from what each plugin declares
URL: https://github.com/FreeMixer/omx-panel
BuildArch: noarch

Source0: %{url}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildRequires: make
BuildRequires: sed
BuildRequires: nodejs >= 18
# npm ci fetches typescript (the build) and ajv (the validator, bundled below) from the registry
BuildRequires: npm
# %%check reads the installed vocabulary: omx-contract's schema, plugin-hostd's LV2 table, and the param-contract
# header, which only omx-plugins-devel ships
BuildRequires: omx-contract-data >= 3.3.0
BuildRequires: plugin-hostd-contract >= 0.12.0
BuildRequires: omx-plugins-devel

Requires: nodejs >= 18
# the layout reads omx-contract's meanings and plugin-hostd's unit table from the contract directory these install
Requires: omx-contract-data >= 3.3.0
Requires: plugin-hostd-contract >= 0.12.0
# the descriptors of omx-plugins' plugins, for modgui --installed
Recommends: omx-plugins-contract
# the param-contract header the unit tokens are judged by; $OMX_PARAM_CONTRACT_H names another
Suggests: omx-plugins-devel
Provides: bundled(nodejs-ajv)

%description
omx-panel makes panels for LV2 and CLAP plugins from what each plugin
declares. It lays a panel out from a plugin's descriptor (sections, controls,
roles, the pages of eight a controller shows), writes a MOD GUI for MOD and
Zynthian in the omx look, imports a plugin's own MOD GUI into a skin package,
and carries the skin package schema, its validator and the directory skin
packages are installed into. The omx-panel command runs each; the tools are
under /usr/share/omx-panel for a build that calls them.

%prep
%autosetup

%build
npm ci --no-audit --no-fund
%make_build

%install
%make_install PREFIX=%{_prefix} BINDIR=%{_bindir} DATADIR=%{_datadir}

%check
make test

%files
%license LICENSE
%doc README.md docs/
%{_bindir}/omx-panel
%{_mandir}/man1/omx-panel.1*
%{_datadir}/omx-panel/
%dir %{_datadir}/omx/
%dir %{_datadir}/omx/skins/

%changelog
* Tue Oct 27 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.1-1
- `omx-panel descriptors --installed` lists the installed descriptor files, one
  path per line (#37).

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.3.0-1
- The MOD GUI importer reads mod-ui's whole modgui:gui property list, refuses
  MODGUI_PORT_UNKNOWN and MODGUI_IMAGE_NOT_FOUND (ten refusal codes), and reads
  a template reference as mod-ui reads it (#33).

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.6-1
- A readout is drawn as a display, never looked up as a control input; 0.2.5
  stopped on a readout. The worked example, with its documents and examples.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.5-1
- A man page for omx-panel; shipped declarations carry no shebang. 0.2.4
  shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.4-1
- The Debian package no longer carries the vendored modules' dotfiles; 0.2.3
  shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.3-1
- The Debian package depends on pkgconf, which the vocabulary reader runs;
  0.2.2 shipped no DEB either.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.2-1
- The Debian build depends on node, npm and the dev packages its suite reads;
  0.2.1 shipped no DEB.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.1-1
- The npm package is @openmixer/omx-panel; 0.2.0 named a scope that does not
  exist on the registry and never reached npm.

* Sun Oct 25 2026 Pau Aliagas <linuxnow@gmail.com> - 0.2.0-1
- The panel toolkit: the layout from a descriptor, the MOD GUI generator and
  its images, the omx look, the skin package at schema 1 with its facts, and
  the MOD GUI importer.
* Sat Oct 17 2026 Pau Aliagas <linuxnow@gmail.com> - 0.1.0-1
- First package: the skin package schema and the skins directory.
- The package was named omx-skins until 2026-10-25.
