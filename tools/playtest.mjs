// End-to-end playtest.  `node tools/playtest.mjs [runs] [targetMetres]`
//
// tools/stress.mjs proves each chunk is clearable in isolation. This proves the
// assembled game is, in two steps that between them leave nowhere to hide:
//
//   1. Search the whole streamed course -- every chunk, every seam, the real
//      speed ramp -- for a single line from the start to the target distance.
//      No bot heuristics: either a line exists or the course is unfair.
//   2. Replay that exact line through the real createGame(): its tick loop, its
//      streaming, its collision window, its scoring. The solver and the game
//      share physics.step() and the same fixed timestep, so the replay has to
//      survive. If it does not, the game and the thing that vouches for it have
//      drifted apart, which is the one bug this whole design exists to prevent.

import { createGame } from '../js/game.js';
import { solveFrom, SOLVER_HOLD } from '../js/solver.js';
import { createCourse, speedAt, PX_PER_M } from '../js/generator.js';

const RUNS = Number(process.argv[2] || 12);
const TARGET_M = Number(process.argv[3] || 2500);
const TICK = SOLVER_HOLD / 120;
const TARGET_X = TARGET_M * PX_PER_M;

let unfair = 0, drifted = 0, budget = 0;
const notes = [];
let totalNodes = 0, totalMs = 0, totalActions = 0;

for (let run = 0; run < RUNS; run++) {
  const seed = 4242 + run;

  // --- 1. is there a line at all? -----------------------------------------
  const course = createCourse(seed);
  const chunks = [];
  while (course.cursor < TARGET_X + 3000) chunks.push(course.next());
  const world = {
    solids: chunks.flatMap((c) => c.solids),
    hazards: chunks.flatMap((c) => c.hazards),
  };

  const t0 = Date.now();
  const res = solveFrom(world, speedAt, { x: 0, y: 0, vy: 0, onGround: true, sliding: false, jumps: 1, coyote: 0.09, bufferT: 0, justJumped: 0, landed: false }, TARGET_X, false, 4e6);
  totalMs += Date.now() - t0;
  totalNodes += res.nodes;

  if (!res.ok) {
    if (res.budget) { budget++; notes.push(`  seed ${seed}: search ran out of budget after ${res.nodes} states`); }
    else {
      unfair++;
      notes.push(`  seed ${seed}: NO LINE EXISTS to ${TARGET_M}m`);
    }
    process.stdout.write(res.budget ? '?' : 'X');
    continue;
  }
  totalActions += res.inputs.length;

  // --- 2. does the real game agree? ---------------------------------------
  const game = createGame({ audio: null });
  const g = game.g;
  game.start(seed, 0);
  let held = false;
  for (const a of res.inputs) {
    if (a === 1) held = true; else if (a === 2) held = false;
    game.tick(TICK, { jump: a === 1, jumpHeld: held, slide: a === 3, surge: false }, null);
    if (!g.alive) break;
  }

  if (g.alive && g.dist < TARGET_M - 5) {
    drifted++;
    notes.push(`  seed ${seed}: replay ended alive at only ${Math.round(g.dist)}m of ${TARGET_M}m` +
      `  <-- the line does not carry through the game`);
    process.stdout.write('!');
  } else if (!g.alive) {
    drifted++;
    const c = g.chunks.find((c) => g.player.x >= c.x && g.player.x <= c.x + c.len);
    notes.push(`  seed ${seed}: line found, but the game killed it at ${Math.round(g.dist)}m` +
      ` (${g.cause} in "${c ? c.name : '?'}")  <-- solver and game disagree`);
    process.stdout.write('!');
  } else {
    process.stdout.write('.');
  }
}

const ok = RUNS - unfair - drifted - budget;
console.log(`\n\n  ${ok}/${RUNS} courses had a line, and the game agreed`);
console.log(`  ${unfair} unfair · ${drifted} solver/game disagreements · ${budget} over budget`);
console.log(`  search: ${(totalNodes / RUNS / 1000).toFixed(0)}k states, ${(totalMs / RUNS).toFixed(0)}ms per course`);
console.log(`  lines were ${Math.round(totalActions / Math.max(1, RUNS - unfair - budget))} decisions long`);
if (notes.length) console.log('\n' + notes.join('\n'));
console.log(ok === RUNS ? '\nevery course is clearable, and clearable in the real game\n' : '\nFAILURES\n');
process.exit(ok === RUNS ? 0 : 1);
