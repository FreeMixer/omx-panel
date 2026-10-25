# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
Name: omx-panel
Version: 0.1.0
Release: 1%{?dist}
License: GPL-3.0-or-later
Summary: Panels for LV2 and CLAP plugins: the skin package schema
URL: https://github.com/FreeMixer/omx-panel
BuildArch: noarch

Source0: %{url}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildRequires: make
BuildRequires: sed

%description
This release of omx-panel, the panel toolkit for LV2 and CLAP plugins,
carries the schema of a skin package's skin.json, the file that says how one
plugin's panel is arranged and named and which art it brings, and the
directory skin packages are installed into.

%prep
%autosetup

%build
%make_build

%install
%make_install PREFIX=%{_prefix} DATADIR=%{_datadir}

%files
%license LICENSE
%doc README.md
%{_datadir}/omx-panel/
%dir %{_datadir}/omx/
%dir %{_datadir}/omx/skins/

%changelog
* Sat Oct 17 2026 Pau Aliagas <linuxnow@gmail.com> - 0.1.0-1
- First package: the skin package schema and the skins directory.
- The package was named omx-skins until 2026-10-25.
