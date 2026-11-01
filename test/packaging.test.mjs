// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

for (const bin of ['bin/omx-panel.mjs', 'dist/bin/omx-panel.mjs']) {
  test(`${bin} --version prints the package version and nothing on stderr (#74)`, () => {
    const r = spawnSync(process.execPath, [join(ROOT, bin), '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `omx-panel ${version}\n`);
    assert.equal(r.stderr, '');
  });
}

test('the DEB reloads systemd after install, for the drop-ins on another package\'s unit (#74)', () => {
  const postinst = readFileSync(join(ROOT, 'debian/omx-panel.postinst'), 'utf8');
  assert.match(postinst, /^#DEBHELPER#$/m);
  assert.match(postinst, /^\s*systemctl daemon-reload\b/m);
  assert.equal(spawnSync('sh', ['-n', join(ROOT, 'debian/omx-panel.postinst')]).status, 0);
});

test('an upgrade does not stop the sync units: they are never started by the package (#74)', () => {
  assert.match(readFileSync(join(ROOT, 'debian/rules'), 'utf8'), /dh_installsystemd --no-enable --no-start --no-stop-on-upgrade/);
});
