'use strict';
// AI Race Game – rules engine. Pure functions on a plain "game" object, no I/O.
// Rules: ../AI Race Game.pdf. Open points and how they were decided: SPEC.md §4.

const GENERATIONS = 3;
const MAX_ROUNDS = 6;
const START_SAFETY = [12, 11, 10];
const MAX_CAPABILITY = 12;
const MAX_SAFETY = 12;
const CARDS = ['cooperate', 'race', 'release', 'exposeLeft', 'exposeRight'];
const COOPERATIVE = new Set(['cooperate', 'exposeLeft', 'exposeRight']);

/** Points saved when releasing at a capability level (bands 1P–5P of the table sheet). */
function pointsFor(cap) {
  if (cap <= 0) return 0;
  if (cap <= 3) return 1;
  if (cap <= 6) return 2;
  if (cap <= 8) return 3;
  if (cap <= 10) return 4;
  return 5;
}

/** players: array of ids in seat order (clockwise). */
function createGame(playerIds) {
  const g = {
    seats: [...playerIds],
    gen: 0,
    round: 0,
    safety: 0,
    phase: 'choose', // choose | revealed | rolled | final
    players: {},
    choices: {},
    resolution: null,
    rollResult: null,
    genOver: false,
  };
  for (const id of playerIds) {
    g.players[id] = { capability: 0, saved: [null, null, null], released: false, skipping: false, skipNext: false };
  }
  startGeneration(g, 1);
  return g;
}

function startGeneration(g, gen) {
  g.gen = gen;
  g.safety = START_SAFETY[gen - 1];
  g.genOver = false;
  for (const id of g.seats) {
    Object.assign(g.players[id], { capability: 0, released: false, skipping: false, skipNext: false });
  }
  startRound(g, 1);
}

function startRound(g, round) {
  g.round = round;
  g.phase = 'choose';
  g.choices = {};
  g.resolution = null;
  g.rollResult = null;
  for (const id of g.seats) {
    const p = g.players[id];
    p.skipping = p.skipNext;
    p.skipNext = false;
  }
}

/** Players who choose a card this round, in seat order. */
function activeIds(g) {
  return g.seats.filter((id) => !g.players[id].released && !g.players[id].skipping);
}
function unreleasedIds(g) {
  return g.seats.filter((id) => !g.players[id].released);
}

/** Target of an expose card: next active player to the left (clockwise, +1) or right (−1). */
function targetOf(g, id, card) {
  const act = activeIds(g);
  const i = act.indexOf(id);
  if (i < 0 || act.length < 2) return null;
  const dir = card === 'exposeLeft' ? 1 : card === 'exposeRight' ? -1 : 0;
  if (!dir) return null;
  return act[(i + dir + act.length) % act.length];
}

function choose(g, id, card) {
  if (g.phase !== 'choose') throw new Error('Not in the selection phase');
  if (!activeIds(g).includes(id)) throw new Error('You are not active this round');
  if (card === null) { delete g.choices[id]; return; }
  if (!CARDS.includes(card)) throw new Error('Unknown card');
  g.choices[id] = card;
}

function allChosen(g) {
  const act = activeIds(g);
  return act.length > 0 && act.every((id) => g.choices[id]);
}

/** Reveal the cards and resolve actions + Safety. The collapse roll comes afterwards. */
function reveal(g) {
  if (g.phase !== 'choose') throw new Error('Not in the selection phase');
  if (!allChosen(g)) throw new Error('Not everybody has chosen yet');
  const act = activeIds(g);
  const res = {};
  for (const id of act) {
    res[id] = {
      card: g.choices[id], target: targetOf(g, id, g.choices[id]), hit: false, exposedBy: [],
      gain: 0, capBefore: g.players[id].capability, capAfter: 0, released: false, points: 0, skipNext: false,
    };
  }
  // Exposes
  for (const id of act) {
    const r = res[id];
    if (r.target && res[r.target].card === 'race') {
      r.hit = true;
      res[r.target].exposedBy.push(id);
    }
  }
  // Gains
  for (const id of act) {
    const r = res[id];
    const p = g.players[id];
    if (r.card === 'cooperate') r.gain = 1;
    else if (r.card === 'race') {
      r.gain = Math.max(0, 2 - r.exposedBy.length);
      if (r.exposedBy.length) { r.skipNext = true; p.skipNext = true; }
    } else if (r.card === 'release') {
      r.released = true;
      r.points = pointsFor(p.capability);
      p.saved[g.gen - 1] = r.points;
      p.released = true;
    } else if (r.hit) r.gain = 2;
    if (r.released) {
      r.capAfter = r.capBefore;
      p.capability = 0;
    } else {
      p.capability = Math.min(MAX_CAPABILITY, p.capability + r.gain);
      r.capAfter = p.capability;
      r.gain = r.capAfter - r.capBefore; // effective gain (cap at 12)
    }
  }
  // Safety
  const coop = act.filter((id) => COOPERATIVE.has(res[id].card)).length;
  const races = act.filter((id) => res[id].card === 'race').length;
  // Players who release this round have left the race: they do not count for the majority.
  const staying = act.filter((id) => res[id].card !== 'release').length;
  const majority = coop * 2 > staying;
  const before = g.safety;
  g.safety = Math.max(0, Math.min(MAX_SAFETY, before + (majority ? 1 : 0) - races));
  g.resolution = {
    order: act, players: res,
    safety: { before, after: g.safety, majority, coop, races, active: staying },
    skipped: g.seats.filter((id) => g.players[id].skipping),
  };
  g.phase = 'revealed';
  if (unreleasedIds(g).length === 0) {
    // Nobody left at risk: no collapse roll.
    g.rollResult = { roll: null, collapse: false, lost: {}, autoReleased: {} };
    g.genOver = true;
    g.phase = 'rolled';
  }
  return g.resolution;
}

/** Collapse roll. rng() → [0,1). */
function roll(g, rng = Math.random) {
  if (g.phase !== 'revealed') throw new Error('Nothing to roll for');
  const value = 1 + Math.floor(rng() * 12);
  const collapse = g.safety < value;
  const out = { roll: value, collapse, lost: {}, autoReleased: {} };
  const open = unreleasedIds(g);
  if (collapse) {
    for (const id of open) {
      const p = g.players[id];
      out.lost[id] = p.capability;
      p.capability = 0;
      p.saved[g.gen - 1] = 0;
    }
    g.genOver = true;
  } else if (g.round >= MAX_ROUNDS) {
    // A single remaining player plays on alone (no early end of the generation).
    for (const id of open) {
      const p = g.players[id];
      out.autoReleased[id] = { capability: p.capability, points: pointsFor(p.capability) };
      p.saved[g.gen - 1] = out.autoReleased[id].points;
      p.capability = 0;
      p.released = true;
    }
    g.genOver = true;
  }
  g.rollResult = out;
  g.phase = 'rolled';
  return out;
}

/** Continue after the roll: next round, next generation or final ranking. */
function next(g) {
  if (g.phase !== 'rolled') throw new Error('Round is not finished yet');
  if (!g.genOver) startRound(g, g.round + 1);
  else if (g.gen < GENERATIONS) startGeneration(g, g.gen + 1);
  else g.phase = 'final';
}

function total(g, id) {
  return g.players[id].saved.reduce((a, b) => a + (b || 0), 0);
}

/** Ranking with shared ranks on ties. */
function ranking(g) {
  const rows = g.seats.map((id) => ({ id, total: total(g, id), saved: g.players[id].saved.map((v) => v || 0) }));
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1; });
  return rows;
}

module.exports = {
  GENERATIONS, MAX_ROUNDS, START_SAFETY, MAX_CAPABILITY, CARDS,
  pointsFor, createGame, activeIds, unreleasedIds, targetOf, choose, allChosen, reveal, roll, next, total, ranking,
};
