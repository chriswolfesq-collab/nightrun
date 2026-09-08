// Generator stress test.  `node tools/stress.mjs [runs]`
//
// Two jobs. First, prove the validator has teeth: a validator that says yes to
// everything is worse than none, so it is fed courses that are known-clearable
// and courses that are known-impossible, and it has to sort them. Only then does
// it get to vouch for the real generator.

import { createCourse, speedAt, difficultyAt, templates, validate, PX_PER_M } from '../js/generator.js';
import { solve } from '../js/solver.js';
import { reach, JUMP_HEIGHT, DOUBLE_JUMP_HEIGHT, P } from '../js/physics.js';

const RUNS = Number(process.argv[2] || 60);
const SLAB = 480;
const plat = (x, w, y = 0) => ({ x, y, w, h: SLAB });

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}  (solver said ${got ? 'clearable' : 'impossible'})`);
};

// --- 1. does the validator actually discriminate? --------------------------
//
// Every "impossible" case here has to be impossible for the RIGHT reason. A
// block is not unclearable just because it is taller than one jump -- the air
// jump reaches 313px -- so the walls below are built past that, and the bars are
// built tall enough that going over the top is off the table too.

console.log('\nvalidator calibration');
console.log(`  reach: jump ${JUMP_HEIGHT.toFixed(0)}px, jump+air ${DOUBLE_JUMP_HEIGHT.toFixed(0)}px high`);

for (const speed of [400, 650, 900]) {
  const R = reach(speed);
  const gapWorld = (g) => ({ solids: [plat(0, 400), plat(400 + g, 500)], hazards: [] });
  check(`${speed}px/s  gap ${Math.round(R * 0.5)}px (half of single-jump reach)`,
    solve(gapWorld(R * 0.5), speed, 60, 900).ok, true);
  check(`${speed}px/s  gap ${Math.round(R * 2.4)}px (past double-jump reach)`,
    solve(gapWorld(R * 2.4), speed, 60, 900 + R * 2.4).ok, false);

  const wall = (h) => ({ solids: [plat(0, 1400), { x: 900, y: -h, w: 40, h }], hazards: [] });
  check(`${speed}px/s  wall ${Math.round(DOUBLE_JUMP_HEIGHT * 0.55)}px (inside air-jump reach)`,
    solve(wall(DOUBLE_JUMP_HEIGHT * 0.55), speed, 60, 1360).ok, true);
  check(`${speed}px/s  wall ${Math.round(DOUBLE_JUMP_HEIGHT + 60)}px (above air-jump reach)`,
    solve(wall(DOUBLE_JUMP_HEIGHT + 60), speed, 60, 1360).ok, false);

  // Bars run high enough that the only way past is underneath them.
  const bar = (clearance) => ({
    solids: [plat(0, 1400), { x: 900, y: -(DOUBLE_JUMP_HEIGHT + 140), w: 160, h: DOUBLE_JUMP_HEIGHT + 140 - clearance }],
    hazards: [],
  });
  check(`${speed}px/s  bar with ${P.slideHeight + 6}px clearance (slide fits)`,
    solve(bar(P.slideHeight + 6), speed, 60, 1360).ok, true);
  check(`${speed}px/s  bar with ${P.slideHeight - 8}px clearance (slide does not fit)`,
    solve(bar(P.slideHeight - 8), speed, 60, 1360).ok, false);

  // And the slide has to be the thing that saved it: with the hitbox pinned to
  // standing height, the same bar must become impossible.
  const savedSlide = P.slideHeight;
  P.slideHeight = P.standHeight;
  check(`${speed}px/s  ...and that bar is impossible without ducking`,
    solve(bar(savedSlide + 6), speed, 60, 1360).ok, false);
  P.slideHeight = savedSlide;

  // Drones are phased on x, so the same course must judge identically every run.
  const dr = {
    solids: [plat(0, 1400)],
    hazards: [{ type: 'drone', x: 700, y: -60, w: 30, h: 30, amp: 40, freq: 0.012, phase: 1.3 }],
  };
  const a = solve(dr, speed, 60, 1360).ok, b = solve(dr, speed, 60, 1360).ok;
  check(`${speed}px/s  drone verdict is deterministic`, a === b, true);
}

// --- 2. the real generator --------------------------------------------------

console.log('\ngenerating');
const byName = new Map();
let chunks = 0, rerolled = 0, fellBack = 0, dist = 0, overBudget = 0;
let needsAir = 0, needsSlide = 0;

/** Re-judge a chunk with one ability removed. If it stops being clearable, that
 *  ability is what the chunk was actually asking for. */
function demands(c, speed, disable) {
  const saved = P[disable.key];
  P[disable.key] = disable.to;
  const ok = validate(c, c.x, c.entryY, speed).ok;
  P[disable.key] = saved;
  return !ok;
}
const nodes = [];
const t0 = Date.now();

for (let i = 0; i < RUNS; i++) {
  const course = createCourse(1000 + i);
  // Roughly a two-minute run's worth of course.
  while (course.cursor < 60000) {
    const c = course.next();
    const rec = byName.get(c.name) || { n: 0, len: 0, orbs: 0 };
    rec.n++; rec.len += c.len; rec.orbs += c.orbs.length;
    byName.set(c.name, rec);
    chunks++;

    // Re-prove the emitted chunk independently of the generator's own pass.
    const sp = speedAt(c.x);
    const res = validate(c, c.x, c.entryY, sp);
    nodes.push(res.nodes);
    if (res.ok) {
      if (demands(c, sp, { key: 'jumpVel2', to: 0 })) needsAir++;
      if (demands(c, sp, { key: 'slideHeight', to: P.standHeight })) needsSlide++;
    }
    if (!res.ok) {
      failures++;
      console.log(`  FAIL  unclearable ${c.name} emitted at x=${Math.round(c.x)}`);
    }
  }
  rerolled += course.stats.rerolled;
  fellBack += course.stats.fellBack;
  overBudget += course.stats.overBudget;
  dist += course.cursor;
}
const ms = Date.now() - t0;

nodes.sort((a, b) => a - b);
const pct = (p) => nodes[Math.min(nodes.length - 1, Math.floor(nodes.length * p))];

console.log(`\n  ${chunks} chunks over ${RUNS} runs  (${(dist / PX_PER_M / RUNS / 1000).toFixed(1)}km each)`);
console.log(`  rerolls ${rerolled} (${((rerolled / chunks) * 100).toFixed(1)}%)   fallbacks ${fellBack}   unproven in budget ${overBudget}`);
console.log(`  solver nodes  p50 ${pct(0.5)}  p95 ${pct(0.95)}  max ${nodes[nodes.length - 1]}`);
console.log(`  ${ms}ms total, ${(ms / chunks).toFixed(2)}ms per chunk`);
console.log(`\n  moveset demand   ${((needsAir / chunks) * 100).toFixed(1)}% of chunks are unclearable without the air jump`);
console.log(`                   ${((needsSlide / chunks) * 100).toFixed(1)}% are unclearable without sliding`);

console.log('\n  template            share    avg len   orbs');
for (const [name, rec] of [...byName].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `  ${name.padEnd(18)} ${((rec.n / chunks) * 100).toFixed(1).padStart(5)}%  ${(rec.len / rec.n).toFixed(0).padStart(7)}px ${(rec.orbs / rec.n).toFixed(1).padStart(6)}`
  );
}

console.log(failures ? `\n${failures} FAILURES\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
