import test from 'node:test';
import assert from 'node:assert/strict';
import { allModels, buildModelTree, folderAt, matchesSearch, resourcesForTab, resourcePreviewUrl, formatBytes } from '../src/catalog.ts';
import type { ModelPackage } from '../src/catalog.ts';

const fixtures: ModelPackage[] = [
  { name: 'b', description: '夏服', path: '虹咲/09璃奈/b', installPath: '3d/figure/虹咲/09璃奈/b', preview: 'b.webp', url: 'b.zip' },
  { name: 'a', description: '冬服', path: '虹咲/09璃奈/a', installPath: '3d/figure/虹咲/09璃奈/a', preview: 'a.webp', url: 'a.zip' },
];
test('package sizes use readable decimal units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(250), '250 B');
  assert.equal(formatBytes(1000), '1 KB');
  assert.equal(formatBytes(1270249), '1.27 MB');
  assert.equal(formatBytes(2163159), '2.16 MB');
  assert.equal(formatBytes(1500000000), '1.5 GB');
});
test('folders preserve group and character paths; representative preview is first sorted model', () => {
  const tree = buildModelTree(fixtures);
  assert.equal(tree.folders[0].name, '虹咲');
  assert.equal(allModels(tree.folders[0])[0].preview, 'a.webp');
  assert.equal(folderAt(tree, '虹咲/09璃奈').models.length, 2);
  assert.equal(folderAt(tree, '').path, '');
});
test('search includes readable description and character directory', () => {
  assert.equal(matchesSearch(fixtures[0], '夏服'), true);
  assert.equal(matchesSearch(fixtures[0], '璃奈'), true);
  assert.equal(matchesSearch(fixtures[0], '校服'), false);
});
test('shared resource catalog separates motions from figures, background and music', () => {
  const entries = (['motion', 'live2d_mot_exp', 'background', 'bgm', 'figure'] as const).map(type => ({ type, name: type, description: '', installPath: type, checkPath: type, url: type }));
  assert.deepEqual(resourcesForTab(entries, 'motion').map(item => item.type), ['motion', 'live2d_mot_exp']);
  assert.deepEqual(resourcesForTab(entries, 'other').map(item => item.type), ['background', 'bgm', 'figure']);
});
test('malformed model paths are rejected', () => {
  assert.throws(() => buildModelTree([{ ...fixtures[0], path: '虹咲/../a' }]));
});
test('resource previews only use catalog images', () => {
  assert.equal(resourcePreviewUrl({ url: 'https://host/a.zip' }), undefined);
  assert.equal(resourcePreviewUrl({ url: 'https://host/a.ZIP?token=1#part' }), undefined);
  assert.equal(resourcePreviewUrl({ url: 'https://host/a.zip', preview: 'https://host/custom.webp' }), 'https://host/custom.webp');
  assert.equal(resourcePreviewUrl({ url: 'https://host/download?id=1' }), undefined);
});
