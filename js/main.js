import { createRenderer } from './render.js';
import { createGame } from './game.js';
import { CAP_M } from './generator.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import * as store from './storage.js';
import { share, shareText, shareCard, challengeUrl, parseChallenge } from './share.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

const renderer = createRenderer(canvas);
const input = createInput(canvas, { slide: $('slidebtn'), surge: $('surgebtn') });
const audio = createAudio();
const game = createGame({ audio });
const g = game.g;

let stats = store.load();
let paused = false;
let challenge = parseChallenge();   // a city somebody sent us, if any
let lastRun = null;

// --- screens ---------------------------------------------------------------

const screens = { title: $('title'), over: $('over'), paused: $('paused') };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $('hud').hidden = name === 'title';
  if (name !== null) $('cue').hidden = true;
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
  const banner = $('challengebanner');
  banner.hidden = !challenge;
  $('newcity').hidden = !challenge;
  if (challenge) {
    banner.innerHTML = challenge.dist
      ? `CHALLENGE · BEAT <b>${challenge.dist.toLocaleString()}m</b> ON THIS CITY`
      : 'CHALLENGE · SOMEBODY SENT YOU THIS CITY';
  }
}

// --- run control -----------------------------------------------------------

function begin() {
  audio.unlock();
  refreshTitle();
  // A challenge keeps its seed across retries -- you cannot learn a city you are
  // only shown once.
  const seed = challenge ? challenge.seed : (Math.random() * 1e9) | 0;
  const gates = [
    { m: stats.best, label: 'YOUR BEST', done: 'NEW BEST', tone: 'best', hue: 190 },
  ];
  if (challenge?.dist) {
    gates.push({
      m: challenge.dist, tone: 'target', hue: 330,
      label: `${challenge.dist.toLocaleString()}m TO BEAT`, done: 'PASSED',
    });
  }
  game.start(seed, gates);
  audio.startMusic();
  show(null);
  $('surgebtn').hidden = true;
  paused = false;
}

function finish() {
  const run = game.run;
  const prevBest = stats.best;
  const target = challenge?.dist || 0;
  const beat = target && run.dist >= target ? target : 0;
  stats = store.record(run);

  lastRun = { ...run, beat, url: challengeUrl({ seed: run.seed, dist: run.dist }) };

  $('cause').textContent = g.cause === 'fell' ? 'LOST TO THE GAP' : 'WRECKED';
  $('fdist').textContent = run.dist.toLocaleString();
  $('fscore').textContent = run.score.toLocaleString();
  $('forbs').textContent = run.orbs;
  $('ftime').textContent = `${run.time.toFixed(1)}s`;
  $('fbest').textContent = `${Math.round(stats.best)}m`;
  $('verdict').textContent =
    beat ? `CHALLENGE BEATEN · ${target.toLocaleString()}m`
    : target ? `${(target - run.dist).toLocaleString()}m SHORT`
    : run.dist > prevBest ? 'NEW PERSONAL BEST'
    : verdictFor(run.dist);
  show('over');
}

$('play').onclick = begin;
$('again').onclick = begin;

$('share').addEventListener('click', (e) => {
  e.stopPropagation();
  if (lastRun) share(shareText(lastRun), $('share'), shareCard(lastRun));
});

$('newcity').addEventListener('click', (e) => {
  e.stopPropagation();
  challenge = null;
  history.replaceState(null, '', location.pathname + location.search);
  refreshTitle();
  begin();
});

// Somebody pasting a link into the address bar of an open game should get that
// city, not the one already running.
addEventListener('hashchange', () => location.reload());

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

// The air-jump prompt. It is on screen from a little before the opening gap
// until the far lip, and only for a player who has never crossed it: the lesson
// is over the moment it has been demonstrated, and nagging past that point is
// how a tutorial turns into furniture.
function updateCue() {
  const cue = g.cue;
  if (!cue || stats.taught) { $('cue').hidden = true; return; }
  const x = g.player.x;
  if (x > cue.x + cue.w + 40) {
    stats = store.markTaught();     // landed it -- never ask again
    $('cue').hidden = true;
    return;
  }
  $('cue').hidden = !(x > cue.x - 620);
}

let lastMult = 1;
function updateHud() {
  $('dist').textContent = Math.round(g.dist);
  $('best').textContent = Math.round(Math.max(stats.best, g.dist));
  $('score').textContent = Math.round(g.score).toLocaleString();
  $('mult').textContent = `×${g.mult}`;
  const multEl = document.querySelector('.stat.mult');
  multEl.classList.toggle('maxed', g.dist >= CAP_M);
  if (g.mult !== lastMult) {
    lastMult = g.mult;
    multEl.style.transform = 'scale(1.35)';
    setTimeout(() => (multEl.style.transform = ''), 130);
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
    if (g.state === 'playing') { updateHud(); updateCue(); }
  }
  wasState = g.state;
  renderer.draw(g);
}

// Handy from the console: nightrun.game.start(seed), nightrun.g, and friends.
window.nightrun = { game, renderer, input, audio, store };

// The title screen shows a real slice of course rather than an empty backdrop --
// and no opening runway, which is the empty backdrop it exists to avoid.
game.start(Date.now() & 0xffff, [], { leadIn: 0 });
g.state = 'title';
refreshTitle();
show('title');
requestAnimationFrame(frame);
