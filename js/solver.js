// Fairness validator.
//
// A generator that only *believes* its gaps are jumpable will eventually ship an
// unclearable one. So every chunk gets played, at generation time, by a search
// that uses the same physics.step() the human player does. If no line exists,
// the chunk is thrown away and rerolled.

import { step, newState } from './physics.js';

// The same fixed step the game runs at, so a line the solver finds is a line
// that exists in the real thing rather than one that survives only at a coarser
// integration.
const DT = 1 / 120;
const HOLD_STEPS = 4;       // a decision every ~33ms
const MAX_NODES = 200000;
const OVERRUN = 900;        // how far past the goal a line may run to find footing
const BUCKET = 16;          // px of progress per frontier bucket

export const NONE = 0, JUMP = 1, RELEASE = 2, SLIDE = 3;
const ACTIONS = [NONE, JUMP, RELEASE, SLIDE];

export const SOLVER_DT = DT;
export const SOLVER_HOLD = HOLD_STEPS;

function key(s, held) {
  return (
    (s.x / 10 | 0) * 1e7 +
    (s.y / 8 | 0) * 1e4 +
    (s.vy / 90 | 0) * 40 +
    (held ? 20 : 0) + (s.sliding ? 10 : 0) + s.jumps * 2 + (s.onGround ? 1 : 0)
  );
}

/**
 * Search for a line from `start` to `targetX`.
 *
 * Success means standing on something at or beyond `targetX`, not merely being
 * alive as you cross it. "Alive at x" is not a safe state -- you can cross the
 * line mid-air, out of jumps, over a gap that starts a metre later -- and a goal
 * that accepts it will happily bless a course that kills you just past the edge
 * of what it looked at.
 *
 * The frontier is ordered by how far right a state has got, so the search spends
 * its budget going forwards instead of enumerating every way to dawdle.
 *
 * `speed` may be a number or a function of x, so a search can be run against the
 * real speed ramp. It is sampled once per decision, exactly where game.tick()
 * samples it, which is what lets a line found here be replayed through the live
 * game frame for frame.
 *
 * @returns {{ok, nodes, inputs, budget}} `inputs` is one action per HOLD_STEPS
 *   frames -- the sequence that lets tools/playtest.mjs actually play the course.
 */
export function solveFrom(world, speed, start, targetX, held = false, maxNodes = MAX_NODES) {
  maxNodes = maxNodes || MAX_NODES;
  const speedOf = typeof speed === 'function' ? speed : () => speed;
  const buckets = new Map();
  let top = -Infinity;
  const seen = new Set();
  let nodes = 0;

  const push = (node) => {
    const q = Math.floor(node.s.x / BUCKET);
    let b = buckets.get(q);
    if (!b) buckets.set(q, (b = []));
    b.push(node);
    if (q > top) top = q;
  };
  const pop = () => {
    while (top > -Infinity) {
      const b = buckets.get(top);
      if (b && b.length) return b.pop();
      buckets.delete(top);
      top = buckets.size ? Math.max(...buckets.keys()) : -Infinity;
    }
    return null;
  };

  // Nodes keep a parent pointer rather than a copy of the path: a course-long
  // search holds hundreds of thousands of them, and copying the whole sequence
  // into every one turns a linear search into a quadratic one.
  push({ s: { ...start }, held, prev: null, act: -1 });

  const trace = (node) => {
    const out = [];
    for (let n = node; n && n.act >= 0; n = n.prev) out.push(n.act);
    return out.reverse();
  };

  for (;;) {
    const node = pop();
    if (!node) return { ok: false, nodes, inputs: [], budget: false };
    if (++nodes > maxNodes) return { ok: false, nodes, inputs: [], budget: true };

    const v = speedOf(node.s.x);
    for (const a of ACTIONS) {
      const s = { ...node.s };
      let h = node.held;
      if (a === JUMP) h = true;
      else if (a === RELEASE) h = false;

      let dead = false;
      for (let k = 0; k < HOLD_STEPS; k++) {
        const intents = { jump: a === JUMP && k === 0, jumpHeld: h, slide: a === SLIDE };
        if (step(s, world, DT, v, intents) === 'dead') { dead = true; break; }
      }
      if (dead) continue;

      const child = { s, held: h, prev: node, act: a };
      if (s.x >= targetX && s.onGround) return { ok: true, nodes, inputs: trace(child), budget: false };
      if (s.x > targetX + OVERRUN) continue;

      const kk = key(s, h);
      if (seen.has(kk)) continue;
      seen.add(kk);
      push(child);
    }
  }
}

export function solve(world, speed, startX, targetX, startY = 0, maxNodes) {
  return solveFrom(world, speed, newState(startX, startY), targetX, false, maxNodes);
}
