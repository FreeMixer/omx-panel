# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
Name: omx-skins
Version: 0.1.0
Release: 1%{?dist}
License: GPL-3.0-or-later
Summary: The skin format for openmixer panels
URL: https://github.com/FreeMixer/omx-skins
BuildArch: noarch

Source0: %{url}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildRequires: make
BuildRequires: sed

%description
A skin tells a panel how to draw its standard widgets: knobs, faders, switches,
selectors, meters and curves. This package carries the schema of a skin
package's skin.json and the directory skins are installed into, so anyone can
add a skin by putting a skin package there.

%prep
%autosetup

%build
%make_build

%install
%make_install PREFIX=%{_prefix} DATADIR=%{_datadir}

%files
%license LICENSE
%doc README.md
%{_datadir}/omx-skins/
%dir %{_datadir}/omx/
%dir %{_datadir}/omx/skins/

%changelog
* Sat Oct 17 2026 Pau Aliagas <linuxnow@gmail.com> - 0.1.0-1
- First package: the skin package schema and the skins directory.
