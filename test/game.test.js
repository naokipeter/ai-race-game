'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');

const ids = ['a', 'b', 'c', 'd', 'e'];
const play = (g, cards) => { for (const [id, c] of Object.entries(cards)) G.choose(g, id, c); return G.reveal(g); };
const noCollapse = () => 0;      // rolls 1
const maxRoll = () => 0.999;     // rolls 12

test('points bands', () => {
  assert.deepEqual([0, 1, 3, 4, 6, 7, 8, 9, 10, 11, 12].map(G.pointsFor), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('starting safety per generation', () => {
  const g = G.createGame(ids);
  assert.equal(g.safety, 12);
});

test('cooperate / race gains and safety', () => {
  const g = G.createGame(ids);
  const r = play(g, { a: 'cooperate', b: 'cooperate', c: 'cooperate', d: 'race', e: 'race' });
  assert.equal(g.players.a.capability, 1);
  assert.equal(g.players.d.capability, 2);
  assert.deepEqual(r.safety, { before: 12, after: 11, majority: true, coop: 3, races: 2, active: 5 });
});

test('strict majority: 2 of 4 is not enough', () => {
  const g = G.createGame(['a', 'b', 'c', 'd']);
  g.safety = 8;
  const r = play(g, { a: 'cooperate', b: 'cooperate', c: 'race', d: 'race' });
  assert.equal(r.safety.majority, false);
  assert.equal(g.safety, 6);
});

test('players who release do not count for the majority', () => {
  const g = G.createGame(['a', 'b', 'c', 'd']);
  g.safety = 8;
  const r = play(g, { a: 'cooperate', b: 'cooperate', c: 'race', d: 'release' });
  assert.equal(r.safety.active, 3);
  assert.equal(r.safety.majority, true); // 2 of 3
  assert.equal(g.safety, 8);             // +1 majority, −1 race
});

test('safety clamps at 12 and 0', () => {
  const g = G.createGame(ids);
  play(g, { a: 'cooperate', b: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.equal(g.safety, 12);
  const h = G.createGame(ids);
  h.safety = 2;
  play(h, { a: 'race', b: 'race', c: 'race', d: 'race', e: 'race' });
  assert.equal(h.safety, 0);
});

test('expose left hits the clockwise neighbour who raced', () => {
  const g = G.createGame(ids);
  const r = play(g, { a: 'exposeLeft', b: 'race', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.equal(r.players.a.target, 'b');
  assert.equal(g.players.a.capability, 2);
  assert.equal(g.players.b.capability, 1);
  assert.equal(g.players.b.skipNext, true);
  assert.equal(g.safety, 12); // +1 majority, −1 race
});

test('expose right wraps around; miss gives nothing', () => {
  const g = G.createGame(ids);
  const r = play(g, { a: 'exposeRight', b: 'race', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.equal(r.players.a.target, 'e');
  assert.equal(r.players.a.hit, false);
  assert.equal(g.players.a.capability, 0);
  assert.equal(g.players.b.capability, 2);
});

test('exposed by both neighbours: no gain, both exposers +2', () => {
  const g = G.createGame(ids);
  play(g, { a: 'exposeLeft', b: 'race', c: 'exposeRight', d: 'cooperate', e: 'cooperate' });
  assert.equal(g.players.b.capability, 0);
  assert.equal(g.players.a.capability, 2);
  assert.equal(g.players.c.capability, 2);
  assert.equal(g.players.b.skipNext, true);
});

test('exposed player skips exactly one round and is not targetable', () => {
  const g = G.createGame(ids);
  play(g, { a: 'exposeLeft', b: 'race', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  G.roll(g, noCollapse); G.next(g);
  assert.deepEqual(G.activeIds(g), ['a', 'c', 'd', 'e']);
  assert.equal(G.targetOf(g, 'a', 'exposeLeft'), 'c');
  assert.throws(() => G.choose(g, 'b', 'race'));
  play(g, { a: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  G.roll(g, noCollapse); G.next(g);
  assert.deepEqual(G.activeIds(g), ids);
});

test('release banks banded points and protects from collapse', () => {
  const g = G.createGame(ids);
  g.players.a.capability = 7;
  g.players.b.capability = 5;
  g.safety = 3;
  play(g, { a: 'release', b: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.deepEqual(g.players.a.saved, [3, null, null]);
  const out = G.roll(g, maxRoll);
  assert.equal(out.collapse, true);
  assert.equal(out.lost.b, 6);
  assert.equal(g.players.b.saved[0], 0);
  assert.equal(g.players.a.saved[0], 3);
  assert.equal(g.genOver, true);
  G.next(g);
  assert.equal(g.gen, 2);
  assert.equal(g.safety, 11);
  assert.equal(g.round, 1);
});

test('collapse only if safety < roll', () => {
  const g = G.createGame(ids);
  g.safety = 12;
  play(g, { a: 'cooperate', b: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.equal(G.roll(g, maxRoll).collapse, false);
});

test('last unreleased player plays on alone; cooperating alone raises safety', () => {
  const g = G.createGame(['a', 'b', 'c']);
  g.players.c.capability = 4;
  g.safety = 9;
  play(g, { a: 'release', b: 'release', c: 'cooperate' });
  const out = G.roll(g, noCollapse);
  assert.deepEqual(out.autoReleased, {});
  assert.equal(g.genOver, false);
  G.next(g);
  assert.equal(g.round, 2);
  assert.deepEqual(G.activeIds(g), ['c']);
  assert.equal(G.targetOf(g, 'c', 'exposeLeft'), null);
  const r = play(g, { c: 'cooperate' });
  assert.equal(r.safety.majority, true); // 1 of 1
  assert.equal(g.safety, 11);            // 9 → 10 → 11
  assert.equal(g.players.c.capability, 6);
  G.roll(g, noCollapse); G.next(g);
  play(g, { c: 'race' });
  assert.equal(g.safety, 10);
  assert.equal(G.roll(g, maxRoll).collapse, true);
  assert.equal(g.players.c.saved[0], 0);
});

test('everybody released: no roll', () => {
  const g = G.createGame(['a', 'b']);
  play(g, { a: 'release', b: 'release' });
  assert.equal(g.phase, 'rolled');
  assert.equal(g.rollResult.roll, null);
});

test('round 6 ends the generation with auto-release; skip does not carry over', () => {
  const g = G.createGame(ids);
  for (let r = 1; r <= 6; r++) {
    assert.equal(g.round, r);
    if (r === 6) play(g, { a: 'exposeLeft', b: 'race', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
    else play(g, { a: 'cooperate', b: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
    G.roll(g, noCollapse);
    if (r < 6) G.next(g);
  }
  assert.equal(g.genOver, true);
  assert.equal(g.players.a.saved[0], G.pointsFor(7));
  G.next(g);
  assert.deepEqual(G.activeIds(g), ids);
});

test('capability capped at 12', () => {
  const g = G.createGame(ids);
  g.players.a.capability = 11;
  const r = play(g, { a: 'race', b: 'cooperate', c: 'cooperate', d: 'cooperate', e: 'cooperate' });
  assert.equal(g.players.a.capability, 12);
  assert.equal(r.players.a.gain, 1);
});

test('full game reaches final ranking with shared ranks', () => {
  const g = G.createGame(['a', 'b', 'c']);
  while (g.phase !== 'final') {
    for (const id of G.activeIds(g)) G.choose(g, id, g.round < 3 ? 'cooperate' : 'release');
    G.reveal(g);
    if (g.phase === 'revealed') G.roll(g, noCollapse);
    G.next(g);
  }
  const rk = G.ranking(g);
  assert.deepEqual(rk.map((r) => r.rank), [1, 1, 1]);
  assert.equal(rk[0].total, 3);
});
