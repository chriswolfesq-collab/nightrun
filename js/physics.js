// Shared movement rules.
//
// The game and the fairness solver both step the player through THIS module and
// nothing else. If the numbers below change, the generator's idea of what is
// reachable changes with them, so a tuning pass can never silently produce
// courses the player cannot clear.

export const P = {
  gravityUp: 2600,      // px/s^2 while moving upward
  gravityDown: 3400,    // px/s^2 while falling (asymmetric: floaty up, snappy down)
  jumpVel: -960,        // px/s applied on a ground jump
  jumpVel2: -840,       // px/s applied on the air jump
  jumpCut: -300,        // releasing early clamps upward speed to this
  maxFall: 1600,
  coyote: 0.09,         // grace after walking off an edge
  buffer: 0.12,         // grace for pressing jump before landing
  width: 30,
  standHeight: 48,
  slideHeight: 24,
  stepTolerance: 13,    // vertical slop forgiven when clipping a platform lip
  killY: 320,           // below this, the run is over
};

// Ground is y = 0. Up is negative. A platform's `y` is its top surface.
export const GROUND_Y = 0;

// --- derived reach numbers -------------------------------------------------
// Everything the generator needs to know about "can the player get there".

const apex = (v) => (v * v) / (2 * P.gravityUp);          // height gained
const rise = (v) => -v / P.gravityUp;                      // seconds spent rising
const fall = (h) => Math.sqrt((2 * h) / P.gravityDown);    // seconds to fall h

/** Peak height of a full single jump, in px above the takeoff surface. */
export const JUMP_HEIGHT = apex(P.jumpVel);

/** Peak height reachable with jump + air jump, taken at the apex of the first. */
export const DOUBLE_JUMP_HEIGHT = JUMP_HEIGHT + apex(P.jumpVel2);

/** Seconds airborne on a full single jump between two surfaces at height `dy`
 *  (dy > 0 means landing lower than takeoff). */
export function airtime(dy = 0) {
  return rise(P.jumpVel) + fall(JUMP_HEIGHT + dy);
}

export function airtimeDouble(dy = 0) {
  return rise(P.jumpVel) + rise(P.jumpVel2) + fall(DOUBLE_JUMP_HEIGHT + dy);
}

/** Horizontal distance covered by a full jump at `speed`, level ground. */
export const reach = (speed, dy = 0) => speed * airtime(dy);
export const reachDouble = (speed, dy = 0) => speed * airtimeDouble(dy);

// --- collision -------------------------------------------------------------

export function playerBox(s) {
  const h = s.sliding ? P.slideHeight : P.standHeight;
  return { x: s.x - P.width / 2, y: s.y - h, w: P.width, h };
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Drones ride a sine keyed to world x, not to wall-clock time, so the solver
 *  and the live game always see them in exactly the same place. */
export function hazardBox(h, x) {
  if (h.type !== 'drone') return h;
  const y = h.y + h.amp * Math.sin(x * h.freq + h.phase);
  return { x: h.x, y, w: h.w, h: h.h };
}

/**
 * Advance one fixed step. `intents` is { jump, jumpHeld, slide }.
 * Returns 'ok' | 'dead'. Mutates `s`.
 */
export function step(s, world, dt, speed, intents) {
  const enteringVy = s.vy;      // how fast we were falling when we got here
  s.x += speed * dt;

  // Buffers tick down regardless of what happens below.
  s.coyote = Math.max(0, s.coyote - dt);
  s.bufferT = Math.max(0, s.bufferT - dt);
  if (intents.jump) s.bufferT = P.buffer;

  // Standing up is blocked by a low ceiling; stay in the slide until it clears.
  if (intents.slide) s.sliding = true;
  else if (s.sliding && !blockedStanding(s, world)) s.sliding = false;

  // --- jump ---------------------------------------------------------------
  if (s.bufferT > 0) {
    if (s.onGround || s.coyote > 0) {
      s.vy = P.jumpVel;
      s.onGround = false;
      s.coyote = 0;
      s.bufferT = 0;
      s.jumps = 1;          // one air jump remains
      s.justJumped = 1;
    } else if (s.jumps > 0) {
      s.vy = P.jumpVel2;
      s.jumps = 0;
      s.bufferT = 0;
      s.justJumped = 2;
    }
  }

  // Variable height: let go early and the arc is cut short.
  if (!intents.jumpHeld && s.vy < P.jumpCut) s.vy = P.jumpCut;

  const g = s.vy < 0 ? P.gravityUp : P.gravityDown;
  s.vy = Math.min(P.maxFall, s.vy + g * dt);

  // How much of a lip to forgive. Approaching a corner diagonally, a player can
  // already be a whole step's worth of falling below a platform's top edge on the
  // frame they first cross into its column -- so a fixed tolerance would turn
  // "landed right on the edge" into "hit the side of the building" purely as an
  // artefact of the step size. Scale it by the descent that brought us here, not
  // by the current velocity, which a jump on this very frame may have reversed.
  const tol = P.stepTolerance + Math.max(0, s.vy, enteringVy) * dt;

  // --- vertical -------------------------------------------------------------
  // Resolved first: whether a solid is a floor or a wall depends on whether the
  // player came down onto it, so the landing has to be settled before anything
  // is called a wall.
  const prevFeet = s.y;
  s.y += s.vy * dt;
  s.onGround = false;

  const b = playerBox(s);
  for (const r of world.solids) {
    if (b.x + b.w <= r.x || b.x >= r.x + r.w) continue;
    if (s.vy >= 0 && prevFeet <= r.y + tol && s.y > r.y) {
      s.y = r.y;
      s.vy = 0;
      s.onGround = true;
      s.coyote = P.coyote;
      s.jumps = 1;
      s.landed = true;
    } else if (s.vy < 0 && b.y < r.y + r.h && b.y + b.h > r.y + r.h) {
      s.y = r.y + r.h + (s.sliding ? P.slideHeight : P.standHeight);
      s.vy = 0;
    }
  }

  // --- horizontal -----------------------------------------------------------
  // x is not ours to negotiate, so anything still overlapping that the player
  // did not arrive on top of is a wall, and a wall at this speed ends the run.
  const box = playerBox(s);
  for (const r of world.solids) {
    if (!overlaps(box, r)) continue;
    if (prevFeet > r.y + tol) return 'dead';
  }

  if (s.y > P.killY) return 'dead';

  for (const h of world.hazards) {
    if (overlaps(box, hazardBox(h, s.x))) return 'dead';
  }
  return 'ok';
}

function blockedStanding(s, world) {
  const head = { x: s.x - P.width / 2, y: s.y - P.standHeight, w: P.width, h: P.standHeight };
  return world.solids.some((r) => overlaps(head, r));
}

export function newState(x = 0, y = GROUND_Y) {
  return {
    x, y, vy: 0,
    onGround: true, sliding: false,
    jumps: 1, coyote: P.coyote, bufferT: 0,
    justJumped: 0, landed: false,
  };
}
