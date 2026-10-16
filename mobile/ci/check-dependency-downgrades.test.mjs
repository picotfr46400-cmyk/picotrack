import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, findProblems } from './check-dependency-downgrades.mjs';

test('version ordering', () => {
  assert.equal(compareVersions('1.9.0-alpha04', '1.8.0'), 1);
  assert.equal(compareVersions('1.8.0', '1.9.0-alpha04'), -1);
  assert.equal(compareVersions('1.9.0', '1.9.0-alpha04'), 1);
  assert.equal(compareVersions('1.9.0-beta01', '1.9.0-alpha04'), 1);
  assert.equal(compareVersions('2.6.2', '2.6.2'), 0);
});

test('detects the androidx.browser downgrade that broke #29', () => {
  const p = findProblems('|    +--- androidx.browser:browser:1.9.0-alpha04 -> 1.8.0 (*)');
  assert.deepEqual(p, ['downgrade androidx.browser:browser 1.9.0-alpha04 -> 1.8.0']);
});

test('upgrades and strict pins', () => {
  assert.deepEqual(findProblems('+--- androidx.core:core:1.1.0 -> 1.13.1'), []);
  assert.equal(findProblems("+--- androidx.browser:browser:{strictly 1.8.0} -> 1.8.0").length, 1);
});
