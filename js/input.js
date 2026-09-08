// Keyboard, touch and gamepad collapsed into what the game asks for each frame.
//
// Only the two edge-triggered signals -- "jump was pressed", "surge was pressed"
// -- are latched, and they are cleared as soon as they are read. Everything else
// is derived from what is held down right now. Latching a held state means it
// survives the release that should have ended it: an early version kept `slide`
// until every key was up, so ducking under a gate and then jumping left you
// stuck in a slide until you let go of both.
//
// On touch, jump and slide get separate controls rather than sharing one touch.
// They cannot share it: a jump has to fire the instant a finger lands, and a
// drag can only be told apart from a tap after the fact, so "tap to jump, drag
// down to slide" jumps first every time and then slides.

export function createInput(canvas, pads = {}) {
  const st = { jumpPressed: false, surge: false, slide: false };

  const keys = new Set();
  const JUMP = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ']);
  const SLIDE = new Set(['ArrowDown', 'KeyS']);
  const SURGE = new Set(['ShiftLeft', 'ShiftRight', 'KeyX']);
  const anyOf = (set) => { for (const k of keys) if (set.has(k)) return true; return false; };

  addEventListener('keydown', (e) => {
    if (JUMP.has(e.code) || SLIDE.has(e.code) || SURGE.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (JUMP.has(e.code)) st.jumpPressed = true;
    if (SURGE.has(e.code)) st.surge = true;
  });
  addEventListener('keyup', (e) => keys.delete(e.code));

  // --- touch: anywhere on the playfield is jump ----------------------------
  const touches = new Set();

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.add(t.identifier);
    st.jumpPressed = true;
  }, { passive: false });

  const endTouch = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.delete(t.identifier);
  };
  canvas.addEventListener('touchend', endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  // --- on-screen pads ------------------------------------------------------
  let padSlideHeld = false;

  /**
   * Bind a pad. Pointer capture is the important part: without it, sliding your
   * thumb off the edge of the button mid-slide never delivers the release, and
   * the player stays crouched until they happen to press it again.
   */
  function bind(el, { onDown, onUp }) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerId != null && el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      }
      el.classList.add('on');
      onDown();
    };
    const up = (e) => {
      if (e) e.stopPropagation();
      el.classList.remove('on');
      onUp?.();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return up;
  }

  const releaseSlide = bind(pads.slide, {
    onDown: () => { padSlideHeld = true; },
    onUp: () => { padSlideHeld = false; },
  });
  bind(pads.surge, { onDown: () => { st.surge = true; } });

  // A pad hidden mid-press (surge appears, the run ends) never gets its release.
  const clearHeld = () => { padSlideHeld = false; releaseSlide?.(); };
  addEventListener('blur', () => { keys.clear(); touches.clear(); clearHeld(); });

  // --- gamepad -------------------------------------------------------------
  let padJump = false, padSurge = false, padHeld = false, padSlide = false;

  function pollPads() {
    padHeld = false;
    padSlide = false;
    let jump = false, surge = false;
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) {
      if (!p) continue;
      if (p.buttons[0]?.pressed || p.buttons[3]?.pressed) { jump = true; padHeld = true; }
      if (p.buttons[1]?.pressed || p.buttons[7]?.value > 0.4) padSlide = true;
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed) surge = true;
    }
    if (jump && !padJump) st.jumpPressed = true;
    if (surge && !padSurge) st.surge = true;
    padJump = jump;
    padSurge = surge;
  }

  /** Read the frame's intents, consuming the edge-triggered ones. */
  function take() {
    pollPads();
    const out = {
      jump: st.jumpPressed,
      jumpHeld: padHeld || anyOf(JUMP) || touches.size > 0,
      slide: padSlide || padSlideHeld || anyOf(SLIDE),
      surge: st.surge,
    };
    st.jumpPressed = false;
    st.surge = false;
    st.slide = out.slide;
    return out;
  }

  return { take, state: st, clearHeld };
}
