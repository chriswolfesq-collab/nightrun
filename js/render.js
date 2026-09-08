// Canvas 2D renderer. Everything is drawn, nothing is loaded: the skyline, the
// sun, the grid and the player are all procedural, so the whole game is a few
// hundred lines of maths and no assets.

const C = {
  sky0: '#04030f', sky1: '#1a0838', sky2: '#3c0f4d',
  cyan: '#3ff0ff', magenta: '#ff2e93', violet: '#9a6bff',
  amber: '#ffc247', orb: '#ffe066', danger: '#ff3355',
  ink: '#07040f',
};

// How much world the camera frames. Height alone is the wrong basis: on a tall
// narrow screen it zooms right in, and a runner lives or dies on how far ahead
// you can see -- at 900px/s, half a second of warning is the difference between
// a fair death and a cheap one. So the tighter of the two constraints wins.
const VIEW_H = 620;
const VIEW_W = 820;
const TILE = 900;               // skyline tile width in world units

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const TILE_BASE = 330;          // where street level sits inside a tile canvas
const TILE_H = 660;             // room for the tallest tower plus a skirt

/** A tile of skyline that always regenerates identically, so it never shimmers
 *  as it scrolls past. Buildings are clamped inside the tile so the seams meet
 *  cleanly when the tiles are drawn side by side. */
function skylineTile(layer, i) {
  const out = [];
  let x = 0, n = 0;
  while (x < TILE - 20) {
    const r1 = hash(i * 31 + n, layer * 977);
    const r2 = hash(i * 31 + n, layer * 977 + 5);
    let w = 40 + r1 * (layer === 0 ? 120 : 90);
    const h = (layer === 0 ? 60 : 40) + r2 * (layer === 0 ? 260 : 170);
    if (x + w > TILE) w = TILE - x;
    out.push({ x, w, h, lit: hash(i, n * 7 + layer) > 0.45, seed: i * 131 + n });
    x += w + 4 + hash(i, n + 61) * 26;
    n++;
  }
  return out;
}

/**
 * Skylines are painted once into their own canvas and then blitted.
 *
 * Drawn straight to the screen, two parallax layers of lit windows are the best
 * part of ten thousand fillRects every frame, for a picture that is identical
 * every frame. Painting each tile once and moving it costs two draw calls.
 */
function paintTile(layer, i, color, windowColor) {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE_H;
  const q = c.getContext('2d');
  for (const b of skylineTile(layer, i)) {
    q.fillStyle = color;
    q.fillRect(b.x, TILE_BASE - b.h, b.w, b.h + (TILE_H - TILE_BASE));
    if (!b.lit) continue;
    q.fillStyle = windowColor;
    for (let wy = TILE_BASE - b.h + 10; wy < TILE_BASE - 8; wy += 13) {
      for (let wx = b.x + 5; wx < b.x + b.w - 6; wx += 11) {
        if (hash(b.seed + (wy | 0), wx | 0) > 0.62) q.fillRect(wx, wy, 3.5, 5);
      }
    }
  }
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const tiles = new Map();
  let W = 0, H = 0, scale = 1, groundY = 0, dpr = 1;

  function tileFor(layer, i, color, windowColor) {
    const k = layer * 1e6 + i;
    let t = tiles.get(k);
    if (!t) { t = paintTile(layer, i, color, windowColor); tiles.set(k, t); }
    if (tiles.size > 16) tiles.delete(tiles.keys().next().value);
    return t;
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.max(0.34, Math.min(1.35, Math.min(H / VIEW_H, W / VIEW_W)));
    // Sit the ground line so the playable band lands near the middle of the
    // screen whatever shape it is, rather than at a fixed fraction of a height
    // that might be mostly empty sky.
    groundY = Math.round(H * 0.5 + 150 * scale);
  }
  resize();
  addEventListener('resize', resize);

  const glow = (color, blur) => { ctx.shadowColor = color; ctx.shadowBlur = blur * scale; };
  const noGlow = () => { ctx.shadowBlur = 0; };

  function drawSky(g) {
    const grad = ctx.createLinearGradient(0, 0, 0, groundY + 40);
    grad.addColorStop(0, C.sky0);
    grad.addColorStop(0.55, C.sky1);
    grad.addColorStop(1, g.surge > 0 ? '#5a1140' : C.sky2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, groundY + 2);
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, groundY, W, H - groundY);
  }

  function drawStars(g) {
    const ox = -g.cam.x * 0.02;
    ctx.fillStyle = '#cfe6ff';
    for (let i = 0; i < 70; i++) {
      const bx = ((hash(i, 1) * 2400 + ox) % 2400 + 2400) % 2400;
      if (bx > W + 4) continue;
      const by = hash(i, 2) * groundY * 0.6;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(g.time * 1.4 + i));
      ctx.globalAlpha = 0.25 + 0.5 * tw;
      ctx.fillRect(bx, by, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }

  function drawSun(g) {
    const cx = W * 0.74;
    const cy = groundY - 196 * scale - g.cam.y * 0.12 * scale;
    const r = 132 * scale;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
    const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    grad.addColorStop(0, '#ffe98a');
    grad.addColorStop(0.45, '#ff9a3c');
    grad.addColorStop(1, C.magenta);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // Slotted bands, tighter toward the bottom -- the synthwave sun. Kept thin:
    // where a tower cuts across the disc, a thick band leaves a striped sliver
    // that reads as a glitch rather than as a sun behind a building.
    ctx.fillStyle = C.sky1;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      ctx.fillRect(cx - r, cy - r * 0.15 + t * r * 1.2, r * 2, 1.5 + t * 6 * scale);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawSkyline(g, layer, par, color, windowColor, baseLift) {
    const ox = g.cam.x * par;
    const base = groundY - baseLift * scale - g.cam.y * par * scale;
    const first = Math.floor(ox / TILE);
    const span = Math.ceil(W / (TILE * scale)) + 2;
    for (let i = first; i < first + span; i++) {
      const x = (i * TILE - ox) * scale;
      ctx.drawImage(tileFor(layer, i, color, windowColor),
        x, base - TILE_BASE * scale, TILE * scale, TILE_H * scale);
    }
  }

  /** Perspective floor under the platform line. */
  function drawGrid(g) {
    const horizon = groundY - 4;
    ctx.strokeStyle = 'rgba(255,46,147,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -14; i <= 14; i++) {
      const vx = W * 0.5 + i * 120 * scale;
      ctx.moveTo(W * 0.5 + (vx - W * 0.5) * 0.06, horizon);
      ctx.lineTo(vx * 2 - W * 0.5 - (g.cam.x * 0.55 % 240) * scale, H + 20);
    }
    ctx.stroke();
    const off = (g.cam.x * 0.55) % 60;
    ctx.strokeStyle = 'rgba(63,240,255,0.28)';
    ctx.beginPath();
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      const y = horizon + Math.pow(t, 2.4) * (H - horizon) * 1.4 - off * 0.0;
      if (y > H) break;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  // --- world -----------------------------------------------------------------

  const sx = (g, wx) => (wx - g.cam.x) * scale;
  const sy = (g, wy) => groundY + (wy - g.cam.y) * scale;

  function drawSolids(g) {
    const left = g.cam.x - 80, right = g.cam.x + W / scale + 80;
    const floors = [], blocks = [], bars = [];
    for (const c of g.chunks) {
      if (c.x + c.len < left || c.x > right) continue;
      for (const s of c.solids) {
        if (s.x + s.w < left || s.x > right) continue;
        (s.kind === 'bar' ? bars : s.kind === 'block' ? blocks : floors).push(s);
      }
    }

    for (const s of floors) {
      const x = sx(g, s.x), y = sy(g, s.y), w = s.w * scale;
      const grad = ctx.createLinearGradient(0, y, 0, y + 150 * scale);
      grad.addColorStop(0, 'rgba(58,22,96,1)');
      grad.addColorStop(0.55, 'rgba(24,9,48,0.92)');
      grad.addColorStop(1, 'rgba(8,4,20,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, H - y + 10);
    }

    ctx.lineWidth = Math.max(1.5, 2.4 * scale);
    ctx.strokeStyle = C.cyan;
    glow(C.cyan, 14);
    ctx.beginPath();
    for (const s of floors) {
      const x = sx(g, s.x), y = sy(g, s.y);
      ctx.moveTo(x, y); ctx.lineTo(x + s.w * scale, y);
    }
    ctx.stroke();
    noGlow();
    ctx.strokeStyle = 'rgba(255,46,147,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of floors) {
      const x = sx(g, s.x), y = sy(g, s.y) + 5 * scale;
      ctx.moveTo(x, y); ctx.lineTo(x + s.w * scale, y);
    }
    ctx.stroke();

    // Ticks down the ends of every floor. A gap you notice late is a gap you
    // fall into, and at 900px/s the edge is the only thing worth reading.
    ctx.strokeStyle = C.magenta;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    glow(C.magenta, 10);
    ctx.beginPath();
    for (const s of floors) {
      const y = sy(g, s.y);
      for (const x of [sx(g, s.x), sx(g, s.x + s.w)]) {
        ctx.moveTo(x, y); ctx.lineTo(x, y + 18 * scale);
      }
    }
    ctx.stroke();
    noGlow();

    // Blocks are things you land ON, spikes are things that end the run, and at
    // 900px/s the pair used to be one silhouette: a magenta-outlined mass sitting
    // on the floor line. So a block is now drawn as what it is -- a short piece of
    // floor, with the same glowing cyan lip and magenta shadow every other
    // standable surface in the frame gets -- and only its sides are violet
    // masonry. Cyan means "stand here" everywhere else; it has to mean it here.
    for (const s of blocks) {
      const x = sx(g, s.x), y = sy(g, s.y), w = s.w * scale, h = s.h * scale;
      ctx.fillStyle = 'rgba(46,18,86,0.94)';
      ctx.fillRect(x, y, w, h);

      const surging = g.surge > 0;
      ctx.strokeStyle = surging ? C.amber : 'rgba(154,107,255,0.8)';
      ctx.lineWidth = 2 * scale;
      if (surging) glow(C.amber, 12);
      ctx.beginPath();                       // sides and base only: the top is a floor
      ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y);
      ctx.stroke();
      noGlow();

      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = 1; i < 4; i++) ctx.fillRect(x + 3, y + (h * i) / 4, w - 6, 1.5);

      ctx.strokeStyle = surging ? C.amber : C.cyan;
      ctx.lineWidth = Math.max(1.5, 2.4 * scale);
      glow(ctx.strokeStyle, 14);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
      noGlow();
      ctx.strokeStyle = 'rgba(255,46,147,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 5 * scale); ctx.lineTo(x + w, y + 5 * scale);
      ctx.stroke();
    }

    for (const s of bars) {
      const x = sx(g, s.x), y = sy(g, s.y), w = s.w * scale, h = s.h * scale;
      ctx.fillStyle = 'rgba(60,40,10,0.85)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2 * scale;
      glow(C.amber, 14);
      ctx.strokeRect(x, y, w, h);
      noGlow();
      // Hazard hatching on the underside you have to duck beneath.
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y + h - 10 * scale, w, 10 * scale); ctx.clip();
      ctx.strokeStyle = 'rgba(255,194,71,0.85)';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      for (let i = -1; i < s.w / 12 + 2; i++) {
        const bx = x + i * 12 * scale;
        ctx.moveTo(bx, y + h); ctx.lineTo(bx + 10 * scale, y + h - 10 * scale);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHazards(g) {
    const left = g.cam.x - 60, right = g.cam.x + W / scale + 60;
    for (const c of g.chunks) {
      if (c.x + c.len < left || c.x > right) continue;
      for (const h of c.hazards) {
        if (h.x + h.w < left || h.x > right) continue;
        if (h.type === 'spike') {
          const x = sx(g, h.x), y = sy(g, h.y + h.h), w = h.w * scale, ht = h.h * scale;
          // A red stripe burnt into the deck beneath the teeth. The teeth
          // themselves are only 24px tall and read as a texture at speed; the
          // stripe is what says "not here" from far enough away to act on.
          ctx.fillStyle = 'rgba(255,51,85,0.6)';
          ctx.fillRect(x - 3 * scale, y, w + 6 * scale, 5 * scale);
          ctx.fillStyle = C.danger;
          glow(C.danger, 12);
          ctx.beginPath();
          const teeth = Math.max(2, Math.round(h.w / 14));
          for (let i = 0; i < teeth; i++) {
            const tx = x + (w * i) / teeth;
            ctx.moveTo(tx, y);
            ctx.lineTo(tx + w / teeth / 2, y - ht);
            ctx.lineTo(tx + w / teeth, y);
          }
          ctx.fill(); noGlow();
        } else {
          const hy = h.y + h.amp * Math.sin(g.player.x * h.freq + h.phase);
          const x = sx(g, h.x + h.w / 2), y = sy(g, hy + h.h / 2);
          const r = (h.w / 2) * scale;
          ctx.save(); ctx.translate(x, y); ctx.rotate(g.time * 2.2);
          ctx.strokeStyle = C.danger; ctx.lineWidth = 2.2 * scale;
          glow(C.danger, 16);
          ctx.beginPath();
          ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, y, 2.6 * scale, 0, 7); ctx.fill();
          noGlow();
          ctx.strokeStyle = 'rgba(255,51,85,0.20)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, sy(g, 0)); ctx.stroke();
        }
      }
    }
  }

  function drawOrbs(g) {
    const left = g.cam.x - 40, right = g.cam.x + W / scale + 40;
    glow(C.orb, 16);
    for (const c of g.chunks) {
      if (c.x + c.len < left || c.x > right) continue;
      for (const o of c.orbs) {
        if (o.taken || o.x < left || o.x > right) continue;
        const x = sx(g, o.x), y = sy(g, o.y + Math.sin(g.time * 3 + o.x * 0.02) * 4);
        ctx.fillStyle = C.orb;
        ctx.beginPath(); ctx.arc(x, y, 5 * scale, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,224,102,0.5)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, (8 + Math.sin(g.time * 4 + o.x) * 2) * scale, 0, 7); ctx.stroke();
      }
    }
    noGlow();
  }

  /** Gates: something in the world to actually run at. */
  function drawGates(g) {
    for (const gate of g.gates) {
      const x = sx(g, gate.x);
      if (x < -140 || x > W + 140) continue;
      const top = sy(g, -330), bot = sy(g, 60);
      const color = gate.passed ? C.cyan : gate.tone === 'target' ? C.magenta : C.violet;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * scale;
      ctx.globalAlpha = 0.75;
      glow(color, 18);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      noGlow();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.font = `600 ${11 * scale}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(gate.passed ? gate.done : gate.label, x, top - 8);
      ctx.textAlign = 'left';
    }
  }

  function drawParticles(g) {
    const p = g.particles.data;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < g.particles.count; i++) {
      if (p.life[i] <= 0) continue;
      const a = p.life[i] / p.max[i];
      const x = sx(g, p.x[i]), y = sy(g, p.y[i]);
      if (x < -20 || x > W + 20) continue;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = `hsl(${p.hue[i]} 100% ${55 + 25 * a}%)`;
      const s = p.size[i] * scale * a;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPlayer(g) {
    const pl = g.player;
    const w = 30 * scale;
    const h = (pl.sliding ? 24 : 48) * scale;
    const x = sx(g, pl.x) - w / 2;
    const y = sy(g, pl.y) - h;
    const main = g.surge > 0 ? '#fff2b0' : C.cyan;
    const edge = g.surge > 0 ? C.amber : C.violet;

    for (let i = 0; i < g.trail.length; i++) {
      const t = g.trail[i];
      const a = (i / g.trail.length) * (g.surge > 0 ? 0.5 : 0.3);
      ctx.globalAlpha = a;
      ctx.fillStyle = main;
      const tw = w * (0.5 + a), th = (t.sliding ? 24 : 48) * scale * (0.5 + a);
      ctx.fillRect(sx(g, t.x) - tw / 2, sy(g, t.y) - th, tw, th);
    }
    ctx.globalAlpha = 1;

    // Legs: a cheap two-line cycle that reads as running at any speed.
    if (pl.onGround && !pl.sliding) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 3 * scale;
      glow(edge, 8);
      const ph = g.time * (g.speed / 42);
      ctx.beginPath();
      for (const o of [0, Math.PI]) {
        ctx.moveTo(x + w * 0.5, y + h - 6 * scale);
        ctx.lineTo(x + w * 0.5 + Math.cos(ph + o) * 13 * scale, y + h + Math.abs(Math.sin(ph + o)) * 2 * scale);
      }
      ctx.stroke();
      noGlow();
    }

    ctx.fillStyle = main;
    glow(main, g.surge > 0 ? 30 : 18);
    roundRect(x, y, w, h, 6 * scale);
    ctx.fill();
    noGlow();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x + w * 0.58, y + h * 0.18, w * 0.28, 4 * scale);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2 * scale;
    roundRect(x, y, w, h, 6 * scale);
    ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSpeedLines(g) {
    const t = Math.max(0, (g.speed - 560) / 400) + (g.surge > 0 ? 0.8 : 0);
    if (t <= 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = g.surge > 0 ? 'rgba(255,220,120,0.35)' : 'rgba(120,220,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const y = ((hash(i, 3) * H) + g.time * 40 * (1 + i % 3)) % H;
      const len = (40 + hash(i, 4) * 160) * Math.min(1.6, t);
      const x = (W + 200 - ((g.time * (500 + i * 60) * Math.min(1.8, t)) % (W + 400)));
      ctx.moveTo(x, y); ctx.lineTo(x + len, y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawOverlay(g) {
    // Scanlines.
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#000';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
    // Vignette.
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    if (g.flash > 0.001) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, g.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function draw(g) {
    ctx.save();
    if (g.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    }
    drawSky(g);
    drawStars(g);
    drawSun(g);
    drawSkyline(g, 0, 0.10, '#1c0a3a', 'rgba(255,90,170,0.30)', 40);
    drawSkyline(g, 1, 0.26, '#100626', 'rgba(90,230,255,0.32)', 8);
    drawGrid(g);
    drawGates(g);
    drawSolids(g);
    drawHazards(g);
    drawOrbs(g);
    drawParticles(g);
    if (g.alive || g.deathT < 0.15) drawPlayer(g);
    drawSpeedLines(g);
    ctx.restore();
    drawOverlay(g);
  }

  return { draw, resize, get metrics() { return { W, H, scale, groundY }; } };
}
