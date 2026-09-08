import { createRenderer } from './render.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

const renderer = createRenderer(canvas);
const input = createInput(canvas, { slide: $('slidebtn'), surge: $('surgebtn') });
const audio = createAudio();
const game = createGame({ audio });
const g = game.g;

let stats = store.load();
let paused = false;

// --- screens ---------------------------------------------------------------

const screens = { title: $('title'), over: $('over'), paused: $('paused') };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $('hud').hidden = name === 'title';
  // The on-screen pads belong to the run, not the menus. Hiding one mid-press
  // would swallow its release, so the input layer is told to let go first.
  const playing = name === null;
  $('slidebtn').hidden = !(playing && matchMedia('(pointer: coarse)').matches);
  if (!playing) {
    input.clearHeld();
    $('surgebtn').hidden = true;
  }
}

function verdictFor(dist) {
  if (dist < 150) return 'the city barely noticed';
  if (dist < 400) return 'you are learning the rhythm';
  if (dist < 800) return 'that was a real run';
  if (dist < 1400) return 'the rooftops know your name';
  if (dist < 2200) return 'few get this far';
  return 'nothing left to prove';
}

function refreshTitle() {
  stats = store.load();
  $('titlebest').textContent = stats.runs
    ? `${stats.runs} runs · best ${Math.round(stats.best)}m · ${Math.round(stats.totalDist / 1000)}km total`
    : '';
}

// --- run control -----------------------------------------------------------

function begin() {
  audio.unlock();
  refreshTitle();
  game.start((Math.random() * 1e9) | 0, stats.best);
  audio.startMusic();
  show(null);
  $('surgebtn').hidden = true;
  paused = false;
}

function finish() {
  const run = game.run;
  stats = store.record(run);
  $('cause').textContent = g.cause === 'fell' ? 'LOST TO THE GAP' : 'WRECKED';
  $('fdist').textContent = run.dist;
  $('fscore').textContent = run.score.toLocaleString();
  $('forbs').textContent = run.orbs;
  $('ftime').textContent = `${g.runTime.toFixed(1)}s`;
  $('fbest').textContent = `${Math.round(stats.best)}m`;
  $('verdict').textContent = g.passedBest && run.dist >= stats.best
    ? 'NEW PERSONAL BEST'
    : verdictFor(run.dist);
  show('over');
}

$('play').onclick = begin;
$('again').onclick = begin;

$('mute').onclick = (e) => {
  e.stopPropagation();
  audio.unlock();
  const m = audio.toggleMute();
  $('mute').classList.toggle('off', m);
  $('mute').textContent = m ? '✕' : '♪';
};

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') $('mute').click();
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (g.state === 'playing' && g.alive) {
      paused = !paused;
      show(paused ? 'paused' : null);
      if (paused) audio.stopMusic(0.2); else audio.startMusic();
    }
  }
  if (g.state === 'title' && (e.code === 'Space' || e.code === 'Enter')) begin();
  if (g.state === 'dead' && (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter')) begin();
});

// A tap on the end screen restarts, but only after a beat, so the tap that
// killed you cannot immediately throw you into the next run.
let overShownAt = 0;
addEventListener('pointerdown', (e) => {
  if (e.target.tagName === 'BUTTON') return;
  if (g.state === 'title') begin();
  else if (g.state === 'dead' && performance.now() - overShownAt > 450) begin();
});

addEventListener('blur', () => {
  if (g.state === 'playing' && g.alive && !paused) {
    paused = true;
    show('paused');
    audio.stopMusic(0.2);
  }
});

// --- hud -------------------------------------------------------------------

let lastMult = 1;
function updateHud() {
  $('dist').textContent = Math.round(g.dist);
  $('best').textContent = Math.round(Math.max(stats.best, g.dist));
  $('score').textContent = Math.round(g.score).toLocaleString();
  $('mult').textContent = `×${g.mult}`;
  if (g.mult !== lastMult) {
    lastMult = g.mult;
    const el = document.querySelector('.stat.mult');
    el.style.transform = 'scale(1.35)';
    setTimeout(() => (el.style.transform = ''), 130);
  }
  const pct = g.surge > 0 ? (g.surge / 3.2) * 100 : g.charge;
  $('surgefill').style.width = `${pct}%`;
  const hud = $('hud');
  const ready = g.charge >= 100 && g.surge <= 0;
  hud.classList.toggle('ready', ready);
  hud.classList.toggle('surging', g.surge > 0);
  $('surgelabel').textContent = g.surge > 0 ? 'SURGING' : ready ? 'SURGE READY' : 'SURGE';
  if (matchMedia('(pointer: coarse)').matches) $('surgebtn').hidden = !ready;
}

// --- loop ------------------------------------------------------------------

let prev = performance.now();
let wasState = 'title';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  const i = input.take();

  if (paused) { renderer.draw(g); return; }

  if (g.state === 'title') {
    game.idle(dt);
  } else {
    game.tick(dt, i, renderer.metrics);
    if (g.state === 'dead' && wasState !== 'dead') {
      overShownAt = now;
      finish();
    }
    if (g.state === 'playing') updateHud();
  }
  wasState = g.state;
  renderer.draw(g);
}

// Handy from the console: nightrun.game.start(seed), nightrun.g, and friends.
window.nightrun = { game, renderer, input, audio, store };

// The title screen shows a real slice of course rather than an empty backdrop.
game.start(Date.now() & 0xffff, 0);
g.state = 'title';
refreshTitle();
show('title');
requestAnimationFrame(frame);
