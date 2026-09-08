// Sharing a run.
//
// A distance on its own is a boast nobody can check or answer. The course is a
// pure function of its seed, so the link carries the seed and the recipient runs
// the same city, block for block, with a gate standing at the distance that was
// shared. That turns a score into a challenge, which is the only kind of score
// worth sending anyone.

import { difficultyAt, PX_PER_M } from './generator.js';

const FULL = '\u{1F7EA}';   // purple square
const EMPTY = '⬛';     // black square
const BARS = 10;

/** How far through the difficulty ramp a run got, as a row of squares. Tied to
 *  the real ramp, so retuning the pacing retunes the bar with it. */
function bar(dist) {
  const filled = Math.round(difficultyAt(dist * PX_PER_M) * BARS);
  return FULL.repeat(filled) + EMPTY.repeat(BARS - filled);
}

export function baseUrl() {
  return location.origin + location.pathname;
}

export function challengeUrl({ seed, dist }) {
  const q = new URLSearchParams();
  q.set('d', String(Math.round(dist)));
  return `${baseUrl()}#/run/${(seed >>> 0).toString(36)}?${q}`;
}

/** Read a challenge out of a URL hash. A mangled link should still open the
 *  game rather than a stack trace, so anything unparseable is simply not one. */
export function parseChallenge(hash = location.hash) {
  const m = /^#\/run\/([0-9a-z]+)(?:\?(.*))?$/i.exec(hash || '');
  if (!m) return null;
  const seed = parseInt(m[1], 36);
  if (!Number.isFinite(seed) || seed < 0) return null;
  const dist = Number(new URLSearchParams(m[2] || '').get('d'));
  return { seed: seed >>> 0, dist: Number.isFinite(dist) && dist > 0 ? Math.round(dist) : 0 };
}

const n = (v) => Math.round(v).toLocaleString();

export function shareText(run) {
  const lines = [
    `NIGHTRUN  ${n(run.dist)}m`,
    `${bar(run.dist)} ${run.cause === 'fell' ? '\u{1F573}️' : '\u{1F4A5}'}`,
    '',
  ];
  if (run.beat) lines.push(`Beat ${n(run.beat)}m on this course.`, '');
  const bits = [`${run.orbs} cells`, `×${run.mult}`];
  if (run.surges) bits.push(`${run.surges} surge${run.surges > 1 ? 's' : ''}`);
  bits.push(`${run.time.toFixed(1)}s`);
  lines.push(bits.join(' · '), '', 'Same city, your turn:', run.url);
  return lines.join('\n');
}

/** A card for the places that show a picture better than they show text. */
export function shareCard(run) {
  const S = 2, W = 620, H = 340, HORIZON = 272;
  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d');
  x.scale(S, S);

  const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  const sky = x.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#04030f');
  sky.addColorStop(0.7, '#160734');
  sky.addColorStop(1, '#3c0f4d');
  x.fillStyle = sky;
  x.fillRect(0, 0, W, HORIZON);
  x.fillStyle = '#07040f';
  x.fillRect(0, HORIZON, W, H - HORIZON);

  // A horizon, so the card is unmistakably from this game.
  x.strokeStyle = 'rgba(255,46,147,0.30)';
  x.lineWidth = 1;
  x.beginPath();
  for (let i = 1; i < 9; i++) {
    const y = HORIZON + Math.pow(i / 9, 2.2) * (H - HORIZON);
    x.moveTo(0, y); x.lineTo(W, y);
  }
  for (let i = -7; i <= 7; i++) {
    x.moveTo(W / 2 + i * 18, HORIZON);
    x.lineTo(W / 2 + i * 170, H);
  }
  x.stroke();
  x.strokeStyle = '#3ff0ff';
  x.lineWidth = 2;
  x.shadowColor = '#3ff0ff'; x.shadowBlur = 16;
  x.beginPath(); x.moveTo(0, HORIZON); x.lineTo(W, HORIZON); x.stroke();
  x.shadowBlur = 0;

  x.textAlign = 'center';
  x.fillStyle = 'rgba(234,246,255,0.55)';
  x.font = `600 15px ${mono}`;
  x.fillText('N I G H T R U N', W / 2, 46);

  // Measure the number and its unit in their own fonts, then centre the pair.
  // Measuring one in the other's font is how the "m" ends up inside the "0".
  const num = n(run.dist);
  x.font = `800 88px ${mono}`;
  const numW = x.measureText(num).width;
  x.font = `600 26px ${mono}`;
  const unitW = x.measureText('m').width;
  const left = (W - (numW + 9 + unitW)) / 2;

  x.textAlign = 'left';
  x.font = `800 88px ${mono}`;
  x.fillStyle = '#3ff0ff';
  x.shadowColor = 'rgba(63,240,255,0.75)'; x.shadowBlur = 30;
  x.fillText(num, left, 136);
  x.shadowBlur = 0;
  x.font = `600 26px ${mono}`;
  x.fillStyle = 'rgba(63,240,255,0.6)';
  x.fillText('m', left + numW + 9, 136);
  x.textAlign = 'center';

  // The same ramp bar the text uses.
  const filled = Math.round(difficultyAt(run.dist * PX_PER_M) * BARS);
  const bw = 40, bh = 12, gap = 8;
  const barW = BARS * bw + (BARS - 1) * gap;
  const bx0 = (W - barW) / 2;
  // One gradient across the whole bar rather than one per cell, so the filled
  // run reads as a single sweep instead of ten identical blocks.
  const sweep = x.createLinearGradient(bx0, 0, bx0 + barW, 0);
  sweep.addColorStop(0, '#9a6bff');
  sweep.addColorStop(1, '#ff2e93');
  for (let i = 0; i < BARS; i++) {
    x.fillStyle = i < filled ? sweep : 'rgba(255,255,255,0.10)';
    x.fillRect(bx0 + i * (bw + gap), 170, bw, bh);
  }

  x.fillStyle = 'rgba(234,246,255,0.85)';
  x.font = `500 16px ${mono}`;
  const bits = [`${run.orbs} cells`, `×${run.mult}`];
  if (run.surges) bits.push(`${run.surges} surge${run.surges > 1 ? 's' : ''}`);
  bits.push(`${run.time.toFixed(1)}s`);
  x.fillText(bits.join('   ·   '), W / 2, 216);

  x.fillStyle = run.beat ? '#ffc247' : '#ff2e93';
  x.font = `700 15px ${mono}`;
  x.fillText(run.beat ? `BEAT ${n(run.beat)}M ON THIS COURSE` :
    run.cause === 'fell' ? 'LOST TO THE GAP' : 'WRECKED', W / 2, 248);

  x.fillStyle = 'rgba(234,246,255,0.5)';
  x.font = `500 13px ${mono}`;
  x.fillText('same city, your turn', W / 2, H - 22);

  return c;
}

// Native share where it exists, clipboard everywhere else, and a visible
// fallback if both are blocked.
export async function share(text, button, canvas) {
  const restore = button.dataset.label || button.textContent;
  button.dataset.label = restore;
  const done = (label) => {
    button.textContent = label;
    setTimeout(() => { button.textContent = restore; }, 1800);
  };

  if (canvas && navigator.canShare) {
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'nightrun.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ text, files: [file] });
        return done('SHARED');
      }
    } catch { /* fall through to text */ }
  }

  try {
    if (navigator.share) {
      await navigator.share({ text });
      return done('SHARED');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(text);
    return done('COPIED');
  } catch {
    showFallback(text);
    done('COPY IT');
  }
}

function showFallback(text) {
  document.querySelector('.share-fallback')?.remove();
  const box = document.createElement('textarea');
  box.className = 'share-fallback';
  box.value = text;
  box.readOnly = true;
  document.body.append(box);
  box.focus();
  box.select();
}
