// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * fixtures.mjs — the test bundles omx-panel ships, for any package that tests against them instead of keeping a copy.
 * `fixtures/` sits beside `tools/` in the tree and in dist/ alike, so the paths resolve from either.
 *
 *   import { MODGUI_ECHO } from '@openmixer/omx-panel/fixtures';
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory of the shipped fixtures. */
export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * A MOD GUI bundle of our own, with no MOD art: one LV2 echo plugin (urn:openmixer:fixture:echo) with its modgui.ttl,
 * stylesheet, icon, knob sprite, screenshot and thumbnail. The importer's and the console's round-trip tests read it.
 */
export const MODGUI_ECHO = join(FIXTURES_DIR, 'modgui', 'omx-fixture-echo.lv2');
