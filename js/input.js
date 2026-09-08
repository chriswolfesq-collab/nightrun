// Keyboard, touch and gamepad collapsed into what the game asks for each frame.
//
// Only the two edge-triggered signals -- "jump was pressed", "surge was pressed"
// -- are latched, and they are cleared as soon as they are read. Everything else
// is derived from what is held down right now. Latching a held state means it
// survives the release that should have ended it: an early version kept `slide`
// until every key was up, so ducking under a gate and then jumping left you
// stuck in a slide until you let go of both.

export function createInput(canvas) {
  const st = { jumpPressed: false, surge: false, any: false, slide: false };

  const keys = new Set();
  const JUMP = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ']);
  const SLIDE = new Set(['ArrowDown', 'KeyS']);
  const SURGE = new Set(['ShiftLeft', 'ShiftRight', 'KeyX']);
  const anyOf = (set) => { for (const k of keys) if (set.has(k)) return true; return false; };

  addEventListener('keydown', (e) => {
    if (JUMP.has(e.code) || SLIDE.has(e.code) || SURGE.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (JUMP.has(e.code)) { st.jumpPressed = true; st.any = true; }
    if (SURGE.has(e.code)) st.surge = true;
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // --- touch ---------------------------------------------------------------
  // Tap anywhere to jump; drag down from that tap to slide. Surge gets its own
  // corner so a mistimed jump can never spend the meter.
  const touches = new Map();
  const surgeZone = () => ({ x: innerWidth - 108, y: innerHeight - 116, w: 92, h: 92 });
  const inZone = (t, z) => t.clientX > z.x && t.clientY > z.y;

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (inZone(t, surgeZone())) { st.surge = true; touches.set(t.identifier, { surge: true }); continue; }
      touches.set(t.identifier, { y0: t.clientY, slid: false });
      st.jumpPressed = true;
      st.any = true;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (rec && !rec.surge && t.clientY - rec.y0 > 42) rec.slid = true;
    }
  }, { passive: false });

  const end = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.delete(t.identifier);
  };
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });

  const someTouch = (fn) => { for (const v of touches.values()) if (fn(v)) return true; return false; };

  // --- gamepad -------------------------------------------------------------
  let padJump = false, padSurge = false, padHeld = false, padSlide = false;

  function pollPads() {
    padHeld = false;
    padSlide = false;
    let jump = false, surge = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      if (p.buttons[0]?.pressed || p.buttons[3]?.pressed) { jump = true; padHeld = true; }
      if (p.buttons[1]?.pressed || p.buttons[7]?.value > 0.4) padSlide = true;
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed) surge = true;
    }
    if (jump && !padJump) { st.jumpPressed = true; st.any = true; }
    if (surge && !padSurge) st.surge = true;
    padJump = jump;
    padSurge = surge;
  }

  /** Read the frame's intents, consuming the edge-triggered ones. */
  function take() {
    pollPads();
    const out = {
      jump: st.jumpPressed,
      jumpHeld: padHeld || anyOf(JUMP) || someTouch((v) => !v.surge && !v.slid),
      slide: padSlide || anyOf(SLIDE) || someTouch((v) => v.slid),
      surge: st.surge,
    };
    st.jumpPressed = false;
    st.surge = false;
    st.slide = out.slide;
    return out;
  }

  return { take, state: st, surgeZone };
}
