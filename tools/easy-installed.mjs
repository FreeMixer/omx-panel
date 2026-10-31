// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * easy-installed.mjs — a scan has nothing to read an easy list from, so a scanned descriptor takes the list of the descriptor the
 * plugin's own package installed under the same plugin id, each key turned into the key the scan names that control by.
 */
import { keyOf } from './panel-description.mjs';

/**
 * The easy list `descriptor` (a scan) takes from `installed` (descriptors), by plugin id; undefined with none, or when a key
 * has no control in this scan: no list rather than half of one, and the rule answers.
 */
export function easyFromInstalled(descriptor, installed) {
  const own = installed.find((d) => d.plugin?.id === descriptor.plugin?.id && d.easy);
  if (!own) return undefined;
  const keys = own.easy.map((key) => {
    const c = own.controls.find((x) => keyOf(x) === key);
    const found = c && descriptor.controls.find((x) => x.id === c.symbol || x.id === c.id);
    return found && keyOf(found);
  });
  return keys.every(Boolean) ? keys : undefined;
}
