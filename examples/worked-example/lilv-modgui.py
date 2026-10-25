# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# lilv-modgui.py <plugin uri>: what lilv, the library mod-ui loads LV2 data with, reads for one plugin from the
# bundles on LV2_PATH: the bundle it took the plugin from, and the plugin's modgui:gui with each property it carries.
# Exit 0 when the plugin has a modgui:gui, 1 when it has none, 2 when lilv does not find the plugin.
import sys

import lilv

MODGUI = "http://moddevices.com/ns/modgui#"
LV2 = "http://lv2plug.in/ns/lv2core#"

world = lilv.World()
world.load_all()
uri = sys.argv[1]
plugin = world.get_all_plugins().get_by_uri(world.new_uri(uri))
if plugin is None:
    print(f"lilv finds no plugin {uri}")
    sys.exit(2)
print(f"plugin  {uri}")
print(f"bundle  {plugin.get_bundle_uri()}")
# the plugin's own query loads its data files (the manifest's rdfs:seeAlso), as a host does
guis = plugin.get_value(world.new_uri(MODGUI + "gui"))
gui = next(iter(guis), None)
if gui is None:
    print("modgui:gui  none")
    sys.exit(1)
for prop in ("resourcesDirectory", "iconTemplate", "stylesheet", "screenshot", "thumbnail", "brand", "label"):
    value = world.get(gui, world.new_uri(MODGUI + prop), None)
    print(f"modgui:{prop}  {value}")
ports = []
for port in world.find_nodes(gui, world.new_uri(MODGUI + "port"), None):
    index = world.get(port, world.new_uri(LV2 + "index"), None)
    symbol = world.get(port, world.new_uri(LV2 + "symbol"), None)
    ports.append((int(str(index)), str(symbol)))
for index, symbol in sorted(ports):
    print(f"modgui:port  {index} {symbol}")
