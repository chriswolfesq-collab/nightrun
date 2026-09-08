// Everything you hear is synthesised at runtime -- no audio files to load, and
// the music can be wired straight to how fast the player is going.

const SCALE = [0, 3, 5, 7, 10, 12, 15];       // minor pentatonic + octave
const ROOT = 55;                               // A1
const PATTERN = [0, 0, 3, 0, 4, 0, 2, 5];

export function createAudio() {
  let ctx = null, master, musicGain, sfxGain, comp, filter;
  let running = false, timer = 0, nextNote = 0, stepIx = 0;
  let bpm = 128, muted = false, intensity = 0;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = 0.9;
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0;
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.85;
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 6;
    musicGain.connect(filter); filter.connect(comp);
    sfxGain.connect(comp); comp.connect(master); master.connect(ctx.destination);
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  function env(node, t, a, d, peak) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone({ t, freq, dur = 0.18, type = 'square', gain = 0.25, to, slide = 0, dest }) {
    if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + (slide || dur));
    env(g, t, Math.min(0.02, dur * 0.2), dur, gain);
    o.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.08);
  }

  function noise({ t, dur = 0.2, gain = 0.3, from = 4000, to = 200 }) {
    if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, dur, gain);
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // --- sequencer -----------------------------------------------------------

  function scheduleStep(t) {
    const deg = PATTERN[stepIx % PATTERN.length];
    const semis = SCALE[deg % SCALE.length] + (stepIx % 16 >= 8 ? 3 : 0);
    const f = ROOT * Math.pow(2, semis / 12);

    tone({ t, freq: f, to: f * 0.995, dur: 0.22, type: 'sawtooth', gain: 0.22, dest: musicGain });
    if (stepIx % 4 === 0) {
      tone({ t, freq: 150, to: 45, dur: 0.16, type: 'sine', gain: 0.5, slide: 0.09, dest: musicGain });
    }
    if (intensity > 0.35 && stepIx % 8 === 6) {
      tone({ t, freq: f * 4, dur: 0.14, type: 'triangle', gain: 0.1 * intensity, dest: musicGain });
    }
    if (intensity > 0.6 && stepIx % 2 === 1) {
      noise({ t, dur: 0.05, gain: 0.05 * intensity, from: 9000, to: 6000 });
    }
    stepIx++;
  }

  function pump() {
    if (!ctx || !running) return;
    const spb = 60 / bpm / 2;                 // eighth notes
    while (nextNote < now() + 0.15) {
      if (nextNote < now()) nextNote = now() + 0.02;
      scheduleStep(nextNote);
      nextNote += spb;
    }
  }

  return {
    get ready() { return !!ctx; },
    get muted() { return muted; },

    unlock() {
      init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    startMusic() {
      this.unlock();
      if (!ctx || running) return;
      running = true;
      nextNote = now() + 0.05;
      stepIx = 0;
      musicGain.gain.cancelScheduledValues(now());
      musicGain.gain.setValueAtTime(0.0001, now());
      musicGain.gain.exponentialRampToValueAtTime(muted ? 0.0001 : 0.5, now() + 1.2);
      timer = setInterval(pump, 25);
    },

    stopMusic(fade = 0.6) {
      if (!ctx || !running) return;
      running = false;
      clearInterval(timer);
      musicGain.gain.cancelScheduledValues(now());
      musicGain.gain.setValueAtTime(Math.max(0.0002, musicGain.gain.value), now());
      musicGain.gain.exponentialRampToValueAtTime(0.0001, now() + fade);
    },

    /** Drive tempo and brightness from the run. `t` is 0..1 intensity. */
    setIntensity(t, surging) {
      intensity = t;
      bpm = 118 + 54 * t + (surging ? 16 : 0);
      if (filter) {
        filter.frequency.setTargetAtTime(700 + 3600 * t + (surging ? 4000 : 0), now(), 0.25);
        filter.Q.setTargetAtTime(surging ? 2 : 6, now(), 0.2);
      }
    },

    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.05);
      return muted;
    },

    jump(air) {
      const t = now();
      tone({ t, freq: air ? 520 : 340, to: air ? 900 : 700, dur: 0.13, type: 'square', gain: 0.16, slide: 0.1 });
    },
    land() { noise({ t: now(), dur: 0.09, gain: 0.14, from: 900, to: 120 }); },
    slide() { noise({ t: now(), dur: 0.26, gain: 0.1, from: 2600, to: 500 }); },
    orb(streak) {
      const t = now();
      const f = 760 * Math.pow(2, Math.min(14, streak) / 24);
      tone({ t, freq: f, dur: 0.1, type: 'triangle', gain: 0.16 });
      tone({ t: t + 0.02, freq: f * 1.5, dur: 0.09, type: 'sine', gain: 0.1 });
    },
    surge() {
      const t = now();
      tone({ t, freq: 180, to: 1400, dur: 0.5, type: 'sawtooth', gain: 0.22, slide: 0.45 });
      noise({ t, dur: 0.5, gain: 0.18, from: 400, to: 8000 });
    },
    smash() { noise({ t: now(), dur: 0.14, gain: 0.22, from: 3200, to: 300 }); },
    milestone() {
      const t = now();
      [0, 4, 7, 12].forEach((s, i) =>
        tone({ t: t + i * 0.07, freq: 440 * Math.pow(2, s / 12), dur: 0.22, type: 'triangle', gain: 0.14 }));
    },
    die() {
      const t = now();
      tone({ t, freq: 420, to: 40, dur: 0.9, type: 'sawtooth', gain: 0.3, slide: 0.85 });
      noise({ t, dur: 0.7, gain: 0.25, from: 6000, to: 90 });
    },
  };
}
