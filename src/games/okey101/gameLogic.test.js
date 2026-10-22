import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileSet } from './tiles.js';
import { validateGroups, validatePairs } from './gameLogic.js';

const tiles = createTileSet();
const byId = Object.fromEntries(tiles.map(tile => [tile.id, tile]));
const okey = { color: 'yellow', number: 13 };

test('series validation rejects selecting one meld twice, overlapping melds and nonexistent tiles', () => {
  const groups = { first: ['T0', 'T2', 'T4'], second: ['T2', 'T4', 'T6'], missing: ['T0', 'T2', 'T4', 'missing'] };
  assert.equal(validateGroups(groups, byId, ['first'], okey).allValid, true);
  assert.equal(validateGroups(groups, byId, ['first', 'first'], okey).allValid, false);
  assert.equal(validateGroups(groups, byId, ['first', 'second'], okey).allValid, false);
  assert.equal(validateGroups(groups, byId, ['missing'], okey).allValid, false);
  assert.equal(validateGroups(groups, byId, [], okey).allValid, false);
});

test('five-pair opening requires ten distinct owned tiles and five distinct groups', () => {
  const groups = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`pair${i}`, [`T${i * 2}`, `T${i * 2 + 1}`]]));
  const selected = Object.keys(groups);
  assert.equal(validatePairs(groups, byId, selected, okey).valid, true);
  assert.equal(validatePairs(groups, byId, Array(5).fill('pair0'), okey).valid, false);
  groups.pair1 = groups.pair0;
  assert.equal(validatePairs(groups, byId, selected, okey).valid, false);
  groups.pair1 = ['T2', 'missing'];
  assert.equal(validatePairs(groups, byId, selected, okey).valid, false);
});
