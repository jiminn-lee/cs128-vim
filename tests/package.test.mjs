import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
test('Package is restricted to CS 128 and contains all declared local assets', async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.background, undefined);
  for (const script of manifest.content_scripts) {
    assert.deepEqual(script.matches, ['https://cs128.org/*']);
    assert.equal(script.world, 'MAIN');
    assert.equal(script.all_frames, false);
    for (const file of [...script.js, ...script.css]) {
      assert.ok((await stat(new URL(`extension/${file}`, root))).size > 0);
    }
  }
});
test('Bundled script parses and includes locally registered Vim with attribution', async () => {
  const code = await readFile(new URL('extension/content.js', root), 'utf8');
  new vm.Script(code);
  assert.match(code, /ace\.define\("ace\/keyboard\/cs128-vim"/);
  assert.doesNotMatch(code, /ace\.define\("ace\/keyboard\/vim"/);
  assert.ok((await readFile(new URL('extension/LICENSE-ace.txt', root), 'utf8')).includes('Redistribution'));
  assert.ok((await readFile(new URL('extension/THIRD-PARTY-NOTICES.txt', root), 'utf8')).includes('CodeMirror'));
});
test('Build uses the pinned Ace release', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.devDependencies['ace-builds'], '1.44.0');
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  assert.equal(lock.packages['node_modules/ace-builds'].version, '1.44.0');
});
