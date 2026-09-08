const KEY = 'nightrun.v1';

const blank = () => ({ best: 0, bestScore: 0, runs: 0, totalDist: 0, bestOrbs: 0, seen: {} });

export function load() {
  try {
    return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return blank();
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function record(run) {
  const s = load();
  s.runs++;
  s.totalDist += run.dist;
  s.best = Math.max(s.best, run.dist);
  s.bestScore = Math.max(s.bestScore, run.score);
  s.bestOrbs = Math.max(s.bestOrbs, run.orbs);
  save(s);
  return s;
}

export function reset() { save(blank()); }
