// Course generator.
//
// The course is an endless stream of chunks. A chunk is a short, self-contained
// piece of level with a known entry height and exit height, built from the
// current speed rather than from fixed pixel numbers -- a gap that is a fair
// jump at 380 px/s is a coin flip at 900, so every distance here is expressed as
// a fraction of what the player can actually reach at the speed they arrive at.
//
// Nothing is trusted. Each chunk is handed to the solver before it is allowed
// into the world.

import { reach, reachDouble, JUMP_HEIGHT, DOUBLE_JUMP_HEIGHT, airtime, P } from './physics.js';
import { solve } from './solver.js';

// --- pacing ----------------------------------------------------------------

export const PX_PER_M = 15;

/** World px over which the course escalates. Past this the run is as fast, as
 *  dense and as wide as it is ever going to get. */
const RAMP = 26000;

/** Where the course stops escalating, in metres -- the far end of the ramp
 *  above, in the units the HUD and the scoring work in. */
export const CAP_M = RAMP / PX_PER_M;

/** 0 at the start line, 1 once the course has nothing left to escalate.
 *  Clamped at both ends: the run opens behind the start line (see LEAD_IN) and
 *  a negative fraction raised to a fractional power is NaN, which would poison
 *  every speed downstream of it. */
export function difficultyAt(dist) {
  return Math.max(0, Math.min(1, dist / RAMP));
}

export function speedAt(dist) {
  return 380 + 520 * Math.pow(difficultyAt(dist), 0.75);
}

// --- rng -------------------------------------------------------------------

export function rngFrom(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = (r, lo, hi) => lo + r() * (hi - lo);
const rndInt = (r, lo, hi) => Math.floor(rnd(r, lo, hi + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// --- geometry helpers ------------------------------------------------------

const SLAB = 480;                       // platforms extend well below the view
const LEVELS = [0, -70, -140, -205];

const plat = (x, w, y) => ({ x, y, w, h: SLAB, kind: 'floor' });
/** Keep floors on the level grid so the skyline reads as a set of storeys. */
const snap = (y) => LEVELS.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
const block = (x, w, y, h, kind = 'block') => ({ x, y, w, h, kind });
const spike = (x, w, y = 0) => ({ type: 'spike', x, y: y - 24, w, h: 24 });
const drone = (x, y, amp, freq, phase) =>
  ({ type: 'drone', x, y, w: 30, h: 30, amp, freq, phase });
const orb = (x, y) => ({ x, y });

/** Widest gap a full single jump clears, with room left for a human. */
const gapMax = (speed, dy = 0) => reach(speed, dy) * 0.64;

/**
 * The true widest gap a jump crosses is more than its airtime suggests. The
 * player can take off with their front foot already over the edge and land with
 * their back foot on the far lip -- a body width -- and coyote time lets them
 * leave the ground up to 90ms after the platform ran out, which at speed is
 * another fifty pixels. Miss those terms and a "chasm" that was supposed to need
 * the air jump turns out to be an ordinary jump with a good run-up.
 */
const singleMax = (speed, dy = 0) => reach(speed, dy) + P.width + P.coyote * speed;
const doubleMax = (speed, dy = 0) => reachDouble(speed, dy) + P.width + P.coyote * speed;

/** A gap the single jump cannot reach and the air jump can. */
const gapChasm = (speed, t) => {
  const lo = singleMax(speed) * 1.12;
  const hi = doubleMax(speed) * 0.86;
  return lo + (hi - lo) * Math.max(0, Math.min(1, t));
};

/** Distance covered by one full jump -- the course's natural beat. */
const beat = (speed) => speed * airtime();

/** Drop orbs along the arc the player would fly if they jumped at `x0`. */
function arc(out, x0, y0, speed, span, n = 3) {
  for (let i = 1; i <= n; i++) {
    const t = (i / (n + 1)) * (span / speed);
    const up = -P.jumpVel * t - 0.5 * P.gravityUp * t * t;
    out.push(orb(x0 + speed * t, y0 - Math.max(24, up) - 26));
  }
}

// --- chunk templates -------------------------------------------------------
// Each returns { solids, hazards, orbs, exitY, len }. `tag` marks intensity so
// the pacer can follow a hard chunk with somewhere to breathe.

const T = {};

/**
 * The ground the run opens on. Nothing to clear, nothing to dodge -- just enough
 * road to see the city, feel the speed and find the keys before the first
 * obstacle arrives, which at the opening speed is a little over three seconds.
 *
 * It is laid down BEHIND the start line, from -LEAD_IN to 0, so the metres on
 * the HUD still begin where the course does: a free runway that also inflated
 * every distance by eighty metres would quietly beat everyone's old best.
 */
T.leadin = {
  tag: 'rest', from: 0,
  build({ x, y, len }) {
    const orbs = [];
    // A short line at head height, in the back half where the player has had a
    // moment to look up: the first thing on screen teaches what to collect, and
    // it cannot be failed.
    for (let i = 0; i < 4; i++) orbs.push(orb(x + len * 0.55 + i * 54, y - 40));
    return { solids: [plat(x, len, y)], hazards: [], orbs, exitY: y, len };
  },
};

/**
 * The air-jump lesson: a gap a single jump cannot clear, at the opening speed,
 * with a long approach and a long landing. The only chunk that is placed rather
 * than chosen.
 *
 * "Again in the air" on the title screen is a sentence, not a lesson. A player
 * who has not found the second jump runs perfectly well for several hundred
 * metres and then meets a chasm sized at 90% of what the air jump can do, with
 * nothing on screen to tell them which move they are missing. So the course asks
 * the question in the first four seconds instead, where the answer is cheap and
 * the retry is immediate, and `cue` tells the HUD where to put the prompt.
 *
 * It goes into every seeded course, whether or not this player still needs it: a
 * city that quietly rearranged itself around who was running it would not be the
 * same city as the one in the link they were sent.
 */
T.teach = {
  tag: 'work', from: 0,
  build({ x, y, speed }) {
    const lead = 320;
    // Well past a full single jump -- which is the whole point of it -- and well
    // inside a double: 79% of what the air jump actually reaches, against the 86%
    // the hardest real chasm is allowed.
    const g = singleMax(speed) * 1.18;
    const tail = 420;
    const orbs = [];
    // Strung across the back half of the arc, at a height the player can only be
    // at if the second jump has already happened.
    for (let i = 0; i < 4; i++) {
      orbs.push(orb(x + lead + g * (0.45 + (i / 3) * 0.4), y - 250 + 40 * Math.abs(i - 1.5)));
    }
    return {
      solids: [plat(x, lead, y), plat(x + lead + g, tail, y)],
      hazards: [], orbs, exitY: y, len: lead + g + tail,
      cue: { x: x + lead, w: g },
    };
  },
};

T.flat = {
  tag: 'rest', from: 0,
  build({ x, y, speed, r }) {
    const len = rnd(r, 1.1, 1.9) * beat(speed);
    const orbs = [];
    if (r() < 0.6) for (let i = 0; i < 4; i++) orbs.push(orb(x + 90 + i * 46, y - 40));
    return { solids: [plat(x, len, y)], hazards: [], orbs, exitY: y, len };
  },
};

T.gaps = {
  tag: 'work', from: 0,
  build({ x, y, d, speed, r }) {
    const n = rndInt(r, 1, d < 0.35 ? 2 : 3);
    const solids = [], orbs = [];
    let cx = x, cy = y;
    solids.push(plat(cx, rnd(r, 110, 170), cy));
    cx += solids[0].w;
    for (let i = 0; i < n; i++) {
      const g = gapMax(speed) * rnd(r, 0.45 + 0.3 * d, 0.72 + 0.24 * d);
      arc(orbs, cx, cy, speed, g);
      cx += g;
      const pad = rnd(r, 150, 260) - 60 * d;
      solids.push(plat(cx, pad, cy));
      cx += pad;
    }
    return { solids, hazards: [], orbs, exitY: cy, len: cx - x };
  },
};

T.blocks = {
  tag: 'work', from: 0,
  build({ x, y, d, speed, r }) {
    const n = rndInt(r, 2, 4);
    const step = beat(speed) * rnd(r, 0.62, 0.92);
    const len = step * (n + 1);
    const hazards = [], orbs = [];
    const solids = [plat(x, len, y)];
    for (let i = 0; i < n; i++) {
      const bx = x + step * (i + 0.85);
      const bw = rnd(r, 34, 52);
      if (r() < 0.35 + 0.3 * d) {
        hazards.push(spike(bx, bw, y));
      } else {
        const bh = rnd(r, 46, 46 + 46 * d);
        solids.push(block(bx, bw, y - bh, bh));
        if (r() < 0.5) orbs.push(orb(bx + bw / 2, y - bh - 40));
      }
    }
    return { solids, hazards, orbs, exitY: y, len };
  },
};

T.lowbars = {
  tag: 'work', from: 0.12,
  build({ x, y, d, speed, r }) {
    const n = rndInt(r, 1, d < 0.5 ? 2 : 3);
    const step = beat(speed) * rnd(r, 0.7, 1.0);
    const len = step * (n + 1);
    const solids = [plat(x, len, y)];
    const orbs = [];
    for (let i = 0; i < n; i++) {
      const bx = x + step * (i + 0.8);
      const bw = rnd(r, 90, 130 + 80 * d);
      // The gate hangs from above the top of anything the player can reach, so
      // going over it is not a line. The bottom edge clears a sliding head and
      // nothing else: this is the one obstacle that only the slide answers.
      const top = DOUBLE_JUMP_HEIGHT + 90;
      solids.push(block(bx, bw, y - top, top - P.slideHeight - 4, 'bar'));
      for (let k = 0; k < 3; k++) orbs.push(orb(bx + (bw * (k + 0.5)) / 3, y - 12));
    }
    return { solids, hazards: [], orbs, exitY: y, len };
  },
};

T.stairs = {
  tag: 'work', from: 0.08,
  build({ x, y, d, speed, r }) {
    const up = y > LEVELS[2] && r() < 0.6;
    const n = rndInt(r, 2, 3);
    const solids = [], orbs = [];
    let cx = x, cy = y;
    for (let i = 0; i < n; i++) {
      const w = rnd(r, 130, 210);
      solids.push(plat(cx, w, cy));
      cx += w;
      const dy = rnd(r, 48, Math.min(JUMP_HEIGHT * 0.62, 62 + 24 * d));
      const g = gapMax(speed, up ? -dy : dy) * rnd(r, 0.3, 0.55);
      orbs.push(orb(cx + g / 2, cy - 70));
      cx += g;
      cy = snap(Math.max(LEVELS[3], Math.min(0, cy + (up ? -dy : dy))));
    }
    const w = rnd(r, 150, 220);
    solids.push(plat(cx, w, cy));
    return { solids, hazards: [], orbs, exitY: cy, len: cx + w - x };
  },
};

T.pillars = {
  tag: 'hard', from: 0.3,
  build({ x, y, d, speed, r }) {
    const n = rndInt(r, 3, 5);
    const solids = [plat(x, 130, y)];
    const orbs = [];
    let cx = x + 130;
    for (let i = 0; i < n; i++) {
      const g = gapMax(speed) * rnd(r, 0.5, 0.7 + 0.18 * d);
      arc(orbs, cx, y, speed, g, 2);
      cx += g;
      const w = rnd(r, 118 - 30 * d, 150 - 30 * d);
      solids.push(plat(cx, w, y + rnd(r, -22, 22)));
      cx += w;
    }
    const tail = 170;
    solids.push(plat(cx, tail, y));
    return { solids, hazards: [], orbs, exitY: y, len: cx + tail - x };
  },
};

T.chasm = {
  tag: 'hard', from: 0.22,
  build({ x, y, speed, r, d }) {
    const lead = rnd(r, 150, 220);
    const g = gapChasm(speed, rnd(r, 0.1, 0.45 + 0.5 * d));
    const orbs = [];
    // Orbs sit high over the middle: the line that collects them is the line
    // that saves the air jump for the far side.
    for (let i = 0; i < 5; i++) orbs.push(orb(x + lead + (g * (i + 1)) / 6, y - 150 - 40 * Math.sin((i / 4) * Math.PI)));
    const tail = rnd(r, 220, 300);
    return {
      solids: [plat(x, lead, y), plat(x + lead + g, tail, y)],
      hazards: [], orbs, exitY: y, len: lead + g + tail,
    };
  },
};

T.drones = {
  tag: 'work', from: 0.35,
  build({ x, y, d, speed, r }) {
    const len = beat(speed) * rnd(r, 1.6, 2.4);
    const n = rndInt(r, 2, 3);
    const hazards = [], orbs = [];
    for (let i = 0; i < n; i++) {
      const dx = x + (len * (i + 0.7)) / (n + 0.4);
      hazards.push(drone(dx, y - rnd(r, 54, 96), rnd(r, 26, 40 + 30 * d), 0.012, r() * 6.28));
      orbs.push(orb(dx + 60, y - 130));
    }
    return { solids: [plat(x, len, y)], hazards, orbs, exitY: y, len };
  },
};

T.rooftops = {
  tag: 'hard', from: 0.45,
  build({ x, y, d, speed, r }) {
    const n = rndInt(r, 3, 4);
    const solids = [], orbs = [];
    let cx = x, cy = y;
    for (let i = 0; i < n; i++) {
      const w = rnd(r, 150, 250);
      solids.push(plat(cx, w, cy));
      if (r() < 0.4 + 0.3 * d) {
        const bh = rnd(r, 44, 70);
        solids.push(block(cx + w * 0.6, 36, cy - bh, bh));
      }
      cx += w;
      const ny = pick(r, LEVELS.filter((L) => Math.abs(L - cy) <= 145));
      const dy = ny - cy;
      const g = gapMax(speed, dy) * rnd(r, 0.42, 0.68);
      arc(orbs, cx, cy, speed, g, 2);
      cx += g;
      cy = ny;
    }
    const tail = rnd(r, 180, 240);
    solids.push(plat(cx, tail, cy));
    return { solids, hazards: [], orbs, exitY: cy, len: cx + tail - x };
  },
};

// Everything the pacer may choose from. `leadin` is deliberately absent: it is
// placed once, by hand, at the start of the course.
const ORDER = ['flat', 'gaps', 'blocks', 'lowbars', 'stairs', 'pillars', 'chasm', 'drones', 'rooftops'];

// --- assembly --------------------------------------------------------------

const RUNWAY = 260;

/** Wrap a chunk in the ground the player arrives on and departs to, so the
 *  solver judges it in context rather than in a vacuum. */
function withRunways(c, x, entryY) {
  return {
    solids: [plat(x - RUNWAY, RUNWAY, entryY), ...c.solids, plat(x + c.len, RUNWAY, c.exitY)],
    hazards: c.hazards,
  };
}

/**
 * The player accelerates as they cross a chunk, so one speed is not enough to
 * judge it: the entry speed is the meanest for clearing gaps, the exit speed the
 * meanest for landing on anything narrow. A chunk has to survive both.
 */
export function validate(c, x, entryY, speed, exitSpeed = speed, budget) {
  const world = withRunways(c, x, entryY);
  const a = solve(world, speed, x - RUNWAY + 40, x + c.len + 40, entryY, budget);
  if (!a.ok) return a;
  if (Math.abs(exitSpeed - speed) < 4) return a;
  const b = solve(world, exitSpeed, x - RUNWAY + 40, x + c.len + 40, entryY, budget);
  return b.ok ? a : b;
}

// A safety valve, not a schedule. Ordinary chunks are proved in a fraction of a
// millisecond and the hardest measured takes about 26k states, so this never
// fires in practice -- but if some future template ever produced a search that
// ran away, the run would drop a frame and reroll rather than hang the tab. An
// unproven chunk is treated exactly like a failed one; it never ships.
const LIVE_BUDGET = 60000;

/** How much clear road the run opens on, in px. Three and a half seconds at the
 *  opening speed: long enough that the first obstacle is still off the right of
 *  the screen when the run begins, and reaches the player only after they have
 *  had a jump or two to get their hands sorted. */
export const LEAD_IN = Math.round(speedAt(0) * 3.5);

/**
 * @param {number} seed
 * @param {{leadIn?: number}} opts  `leadIn` 0 starts the course at the start
 *   line with no runway -- what the title screen's attract loop wants, since
 *   nobody is playing it and a blank straight is a dull thing to look at.
 */
export function createCourse(seed = (Math.random() * 1e9) | 0, { leadIn = LEAD_IN } = {}) {
  const r = rngFrom(seed);
  let x = -leadIn;
  let y = 0;
  let last = '';
  let sinceRest = 0;
  let opened = leadIn <= 0;
  let taught = leadIn <= 0;      // the attract loop has nobody to teach
  const stats = { built: 0, rerolled: 0, fellBack: 0, overBudget: 0 };

  function choose(d) {
    if (sinceRest >= 3 || (T[last]?.tag !== 'rest' && r() < 0.10)) return 'flat';
    const pool = ORDER.filter((k) => k !== 'flat' && k !== last && T[k].from <= d);
    // Bias toward the templates that only just unlocked -- new ideas feel like
    // progress, and the old ones still show up plenty. Up on the rooftops, lean
    // on the templates that can bring the player back down.
    const high = y <= LEVELS[2];
    const weights = pool.map((k) => {
      let w = 1 + 1.6 * Math.max(0, 1 - (d - T[k].from) * 3);
      if (high && (k === 'stairs' || k === 'rooftops')) w *= 3;
      return w;
    });
    let t = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      t -= weights[i];
      if (t <= 0) return pool[i];
    }
    return pool[pool.length - 1] || 'flat';
  }

  /** Build (and prove) the next chunk. Never returns something unplayable. */
  function next() {
    const d = difficultyAt(x);
    const speed = speedAt(x);

    // The runway is not proposed to the solver: it is a flat slab with nothing
    // on it, and a validator that could fail it would be broken.
    if (!opened) {
      opened = true;
      return finish(T.leadin.build({ x, y, len: leadIn }), 'leadin');
    }

    // The lesson comes before anything the pacer chose, so it always lands on
    // the opening speed with clear ground either side. It is proved like any
    // other chunk -- hand-placed is not the same as trustworthy -- and if it
    // ever stopped proving, the run simply carries on without it.
    if (!taught) {
      taught = true;
      const c = T.teach.build({ x, y, speed });
      if (validate(c, x, y, speed, speedAt(x + c.len), LIVE_BUDGET).ok) return finish(c, 'teach');
    }

    let name = choose(d);

    for (let attempt = 0; attempt < 6; attempt++) {
      const c = T[name].build({ x, y, d, speed, r });
      const res = validate(c, x, y, speed, speedAt(x + c.len), LIVE_BUDGET);
      if (res.ok) {
        stats.built++;
        if (attempt > 0) stats.rerolled += attempt;
        return finish(c, name);
      }
      if (res.budget) stats.overBudget++;
      if (attempt === 3) name = 'gaps';       // step down to something tamer
    }
    stats.fellBack++;
    return finish(T.flat.build({ x, y, d, speed, r }), 'flat');
  }

  function finish(c, name) {
    const chunk = {
      name,
      tag: T[name].tag,
      x, len: c.len,
      entryY: y, exitY: c.exitY,
      solids: c.solids,
      hazards: c.hazards,
      orbs: c.orbs.map((o) => ({ ...o, taken: false })),
      cue: c.cue,
    };
    x += c.len;
    y = c.exitY;
    last = name;
    sinceRest = T[name].tag === 'rest' ? 0 : sinceRest + 1;
    return chunk;
  }

  return { next, stats, seed, startX: leadIn > 0 ? -leadIn : 0, get cursor() { return x; } };
}

export const templates = T;
