// Run state: streams the course, steps the player, and owns everything the
// renderer and the HUD read.

import { step, newState, playerBox, hazardBox, P } from './physics.js';
import { createCourse, speedAt, difficultyAt, PX_PER_M } from './generator.js';
import { createParticles } from './particles.js';

const DT = 1 / 120;
const AHEAD = 3200;          // world px of course kept built in front
const BEHIND = 900;
const SURGE_COST = 100;
const SURGE_TIME = 3.2;
const SURGE_BOOST = 1.32;
const ORB_CHARGE = 9;

export function createGame({ audio, particles = createParticles() } = {}) {
  const g = {
    state: 'title',
    time: 0, runTime: 0,
    course: null, chunks: [],
    player: newState(0, 0),
    speed: 380, dist: 0, score: 0, orbs: 0, mult: 1,
    charge: 0, surge: 0, surgesUsed: 0,
    alive: true, deathT: 0, hitstop: 0,
    cam: { x: -240, y: 0 },
    trail: [], particles,
    shake: 0, flash: 0,
    gates: [],
    seed: 0, viewW: 900,
    milestone: 0,
    cause: '',
  };

  let groundRef = 0;
  let trailTick = 0;
  let carry = 0;
  let liveWorld = { solids: [], hazards: [] };

  function start(seed = (Math.random() * 1e9) | 0, gates = [], { leadIn } = {}) {
    g.seed = seed;
    g.course = createCourse(seed, leadIn === undefined ? {} : { leadIn });
    g.chunks = [];
    // The run opens on the generator's runway, behind the start line, so the
    // first obstacle is still seconds away when control is handed over.
    g.player = newState(g.course.startX, 0);
    g.speed = speedAt(g.player.x);
    g.dist = 0; g.score = 0; g.orbs = 0; g.mult = 1;
    g.charge = 0; g.surge = 0; g.surgesUsed = 0;
    g.alive = true; g.deathT = 0; g.hitstop = 0;
    g.runTime = 0; g.milestone = 0; g.cause = '';
    g.trail.length = 0;
    g.cam.x = g.player.x - 240; g.cam.y = 0;
    g.shake = 0; g.flash = 0;
    // Gates are the only thing in the world that is about you rather than about
    // the course: your best, and whatever distance somebody sent you.
    g.gates = gates
      .filter((gt) => gt.m > 0)
      .map((gt) => ({ ...gt, x: gt.m * PX_PER_M, passed: false }))
      .sort((a, b) => a.x - b.x);
    groundRef = 0;
    carry = 0;
    g.state = 'playing';
    stream();
  }

  /** Keep the built course a fixed distance ahead, and forget what is behind. */
  function stream() {
    while (g.course.cursor < g.player.x + AHEAD) g.chunks.push(g.course.next());
    while (g.chunks.length > 1 && g.chunks[0].x + g.chunks[0].len < g.player.x - BEHIND) g.chunks.shift();
  }

  function buildWorld() {
    const left = g.player.x - 200, right = g.player.x + 1500;
    const solids = [], hazards = [];
    const surging = g.surge > 0;
    for (const c of g.chunks) {
      if (c.x + c.len < left || c.x > right) continue;
      for (const s of c.solids) {
        if (s.x + s.w < left || s.x > right) continue;
        if (surging && s.kind !== 'floor') continue;   // smashed, see sweep()
        solids.push(s);
      }
      if (!surging) for (const h of c.hazards) {
        if (h.x + h.w < left || h.x > right) continue;
        hazards.push(h);
      }
    }
    liveWorld = { solids, hazards };
    return liveWorld;
  }

  /** While surging, anything breakable the player touches is removed for good,
   *  so surge can never expire with the player buried inside a wall. */
  function sweep() {
    const box = playerBox(g.player);
    const pad = 26;
    for (const c of g.chunks) {
      if (c.x + c.len < g.player.x - 60 || c.x > g.player.x + 160) continue;
      for (let i = c.solids.length - 1; i >= 0; i--) {
        const s = c.solids[i];
        if (s.kind === 'floor') continue;
        if (s.x > box.x + box.w + pad || s.x + s.w < box.x - pad) continue;
        if (s.y > box.y + box.h + pad || s.y + s.h < box.y - pad) continue;
        c.solids.splice(i, 1);
        particles.burst(s.x + s.w / 2, s.y + Math.min(s.h, 40) / 2, 16, 320, 340);
        g.shake = Math.max(g.shake, 8);
        audio?.smash();
      }
      for (let i = c.hazards.length - 1; i >= 0; i--) {
        const h = c.hazards[i];
        const hb = hazardBox(h, g.player.x);
        if (hb.x > box.x + box.w + pad || hb.x + hb.w < box.x - pad) continue;
        if (hb.y > box.y + box.h + pad || hb.y + hb.h < box.y - pad) continue;
        c.hazards.splice(i, 1);
        particles.burst(hb.x + hb.w / 2, hb.y + hb.h / 2, 14, 350, 320);
        audio?.smash();
      }
    }
  }

  function collectOrbs() {
    const box = playerBox(g.player);
    for (const c of g.chunks) {
      if (c.x + c.len < g.player.x - 60 || c.x > g.player.x + 120) continue;
      for (const o of c.orbs) {
        if (o.taken) continue;
        if (Math.abs(o.x - g.player.x) > 26 || o.y < box.y - 18 || o.y > box.y + box.h + 18) continue;
        o.taken = true;
        g.orbs++;
        g.score += 25 * g.mult;
        g.charge = Math.min(SURGE_COST, g.charge + ORB_CHARGE);
        particles.burst(o.x, o.y, 9, 50, 200, { grav: 200 });
        audio?.orb(g.orbs);
      }
    }
  }

  function die(cause) {
    if (!g.alive) return;
    g.alive = false;
    g.cause = cause;
    g.deathT = 0;
    g.hitstop = 0.11;
    g.shake = 26;
    g.flash = 0.55;
    particles.burst(g.player.x, g.player.y - 24, 60, g.surge > 0 ? 40 : 190, 520, { grav: 1400, drag: 0.97 });
    particles.burst(g.player.x, g.player.y - 24, 26, 330, 300, { grav: 900 });
    audio?.die();
    audio?.stopMusic(0.35);
  }

  function tick(dt, input, metrics) {
    g.time += dt;
    if (metrics) g.viewW = metrics.W / metrics.scale;

    if (g.hitstop > 0) { g.hitstop -= dt; dt = Math.min(dt, 0.004); }

    particles.update(dt);
    g.shake *= Math.pow(0.001, dt);
    g.flash *= Math.pow(0.0005, dt);

    if (g.state !== 'playing') { camera(dt); return; }

    if (!g.alive) {
      g.deathT += dt;
      camera(dt);
      if (g.deathT > 0.85) g.state = 'dead';
      return;
    }

    g.runTime += dt;

    // --- surge -------------------------------------------------------------
    if (input.surge && g.charge >= SURGE_COST && g.surge <= 0) {
      g.surge = SURGE_TIME;
      g.charge = 0;
      g.surgesUsed++;
      g.flash = 0.3;
      g.shake = 12;
      particles.burst(g.player.x, g.player.y - 24, 30, 45, 420, { grav: 100 });
      audio?.surge();
    }
    if (g.surge > 0) {
      g.surge -= dt;
      if (g.surge <= 0) { g.surge = 0; audio?.land(); }
    }

    const base = speedAt(g.player.x);
    g.speed = base * (g.surge > 0 ? SURGE_BOOST : 1);
    g.mult = (1 + Math.floor(g.dist / 400)) * (g.surge > 0 ? 2 : 1);

    // --- physics -----------------------------------------------------------
    // Fixed substeps of exactly DT, with the remainder carried to the next
    // frame. The solver validates courses at this same step, so a substep of any
    // other length would be simulating a game nobody is playing.
    const world = buildWorld();
    carry += dt;
    const steps = Math.floor(carry / DT);
    carry -= steps * DT;
    let first = true;
    for (let n = 0; n < steps && g.alive; n++) {
      const h = DT;
      const wasGround = g.player.onGround;
      const before = g.player.justJumped;
      const res = step(g.player, world, h, g.speed, {
        jump: input.jump && first,
        jumpHeld: input.jumpHeld,
        slide: input.slide,
      });
      first = false;

      if (g.player.justJumped && g.player.justJumped !== before) {
        audio?.jump(g.player.justJumped === 2);
        particles.dust(g.player.x, g.player.y, 6, g.player.justJumped === 2 ? 280 : 190);
        g.player.justJumped = 0;
      }
      if (g.player.landed) {
        g.player.landed = false;
        if (!wasGround) {
          audio?.land();
          particles.dust(g.player.x, g.player.y, 8, 190);
          g.shake = Math.max(g.shake, 3);
          groundRef = g.player.y;
        }
      }
      if (res === 'dead') {
        die(g.player.y > P.killY ? 'fell' : 'crashed');
        break;
      }
    }
    if (!g.alive) return;

    if (g.surge > 0) sweep();
    collectOrbs();
    stream();

    // --- score -------------------------------------------------------------
    g.dist = Math.max(0, g.player.x / PX_PER_M);
    g.score += (g.speed * dt) / PX_PER_M * g.mult * 0.4;
    for (const gate of g.gates) {
      if (gate.passed || g.player.x <= gate.x) continue;
      gate.passed = true;
      g.flash = 0.22;
      particles.burst(g.player.x, g.player.y - 30, 34, gate.hue ?? 190, 380, { grav: 200 });
      audio?.milestone();
    }
    const m = Math.floor(g.dist / 500);
    if (m > g.milestone) { g.milestone = m; audio?.milestone(); }

    // --- cosmetic ----------------------------------------------------------
    if (++trailTick % 2 === 0) {
      g.trail.push({ x: g.player.x, y: g.player.y, sliding: g.player.sliding });
      if (g.trail.length > (g.surge > 0 ? 12 : 7)) g.trail.shift();
    }
    if (g.surge > 0 || !g.player.onGround) {
      particles.trail(g.player.x - 12, g.player.y, g.surge > 0 ? 45 : 190, g.speed);
    }
    audio?.setIntensity(difficultyAt(g.player.x), g.surge > 0);

    camera(dt);
  }

  function camera(dt) {
    const k = 1 - Math.pow(0.0001, dt);
    g.cam.x = g.player.x - g.viewW * 0.3;
    const target = Math.max(-260, Math.min(20, groundRef));
    g.cam.y += (target - g.cam.y) * Math.min(1, k * 0.6);
  }

  /** Attract-mode drift so the title screen is not a still image. The course
   *  keeps building ahead of the camera, so it never drifts off the end. */
  function idle(dt) {
    g.time += dt;
    g.cam.x += 90 * dt;
    while (g.course.cursor < g.cam.x + 2600) g.chunks.push(g.course.next());
    while (g.chunks.length > 1 && g.chunks[0].x + g.chunks[0].len < g.cam.x - 400) g.chunks.shift();
    particles.update(dt);
  }

  return {
    g, start, tick, idle, buildWorld,
    get run() {
      return {
        dist: Math.round(g.dist),
        score: Math.round(g.score),
        orbs: g.orbs,
        mult: 1 + Math.floor(g.dist / 400),   // the multiplier without the surge doubling
        surges: g.surgesUsed,
        time: g.runTime,
        cause: g.cause,
        seed: g.seed,
      };
    },
  };
}
