// One flat pool of additive sparks. Everything that pops, trails or shatters
// goes through here so the whole game costs a single draw pass.

const MAX = 900;

export function createParticles() {
  const p = {
    x: new Float32Array(MAX), y: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    life: new Float32Array(MAX), max: new Float32Array(MAX),
    size: new Float32Array(MAX), hue: new Float32Array(MAX),
    grav: new Float32Array(MAX), drag: new Float32Array(MAX),
  };
  let head = 0, live = 0;

  function spawn(x, y, vx, vy, life, size, hue, grav = 0, drag = 0.98) {
    const i = head; head = (head + 1) % MAX;
    p.x[i] = x; p.y[i] = y; p.vx[i] = vx; p.vy[i] = vy;
    p.life[i] = life; p.max[i] = life; p.size[i] = size; p.hue[i] = hue;
    p.grav[i] = grav; p.drag[i] = drag;
    if (live < MAX) live++;
  }

  const rr = (a, b) => a + Math.random() * (b - a);

  return {
    data: p, get count() { return MAX; },

    burst(x, y, n, hue, speed = 260, opts = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rr(speed * 0.25, speed);
        spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
          rr(0.25, 0.7), rr(1.5, 3.6), hue + rr(-14, 14), opts.grav ?? 900, opts.drag ?? 0.95);
      }
    },

    dust(x, y, n, hue) {
      for (let i = 0; i < n; i++)
        spawn(x + rr(-10, 10), y, rr(-90, -20), rr(-120, -20), rr(0.2, 0.45), rr(1, 2.6), hue, 300, 0.9);
    },

    trail(x, y, hue, speed) {
      spawn(x + rr(-6, 6), y + rr(-16, -2), rr(-40, 20) - speed * 0.12, rr(-30, 30),
        rr(0.18, 0.4), rr(1, 2.4), hue, -30, 0.93);
    },

    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (p.life[i] <= 0) continue;
        p.life[i] -= dt;
        p.vy[i] += p.grav[i] * dt;
        const d = Math.pow(p.drag[i], dt * 60);
        p.vx[i] *= d; p.vy[i] *= d;
        p.x[i] += p.vx[i] * dt;
        p.y[i] += p.vy[i] * dt;
      }
    },
  };
}
