// Version 2's run engine plays exactly as version 1's game did: version 1's own simulation code (taken from its
// index.html by line range, as published Oct 2 2026) and version 2's engine, fed the same held directions step by step,
// must agree on every step's character position and score, for many days, frame sizes and random inputs.
import { readFileSync } from 'node:fs';
import { loadEngine } from '../scripts/check-run.mjs';

const v1 = readFileSync(process.argv[2], 'utf8').split('\n');
const lines = (a, b) => v1.slice(a - 1, b).join('\n');
const v2 = loadEngine(readFileSync(new URL('../tile/index.html', import.meta.url), 'utf8'));

function v1Game(day, fw, fh) {
  const src = [
    lines(75, 115),                                   // constants
    'function todayStr() { return DAY; }',
    lines(130, 196),                                  // the seeded course, helpers
    'let frameWidth=48, frameHeight=48, destWidth=0, destHeight=0, characterY=0, characterHitboxSize=0, facingRowLeft=0, facingRowRight=1, facingRowForward=null, facingRow=1;',
    'function applySheet(img, dims) {' + lines(248, 260) ,
    'applySheet(null, { frameWidth: FW, frameHeight: FH, sheetWidth: FW * 3, sheetHeight: FH * 4 });',
    lines(332, 363),                                  // game state, beginGame, resetForReplay
    'const keysDown = new Set(); const activePointers = new Map(); function releaseEverything() { keysDown.clear(); }',
    lines(424, 516),                                  // the simulation
    'return { beginGame, step, keysDown, get: () => ({ charX, score, runComplete, dropLog }) };',
  ].join('\n');
  return new Function('DAY', 'FW', 'FH', 'let sheet;' + src)(day, fw, fh);
}

let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
let runs = 0, steps = 0;
for (const day of ['2026-11-19', '2026-10-02', '2025-01-01', '2026-12-31', '2027-02-28']) {
  for (const [fw, fh] of [[48, 48], [32, 48], [64, 64], [24, 32], [96, 80]]) {
    for (let k = 0; k < 6; k++) {
      // Start version 1's run after some idle steps (its clock runs before Start), to show that doesn't matter.
      const g1 = v1Game(day, fw, fh);
      for (let i = Math.floor(rand() * 5000); i > 0; i--) g1.step();
      g1.beginGame();
      const r2 = v2.createRun({ day, frameWidth: fw, frameHeight: fh });
      let go = 'stop', changes = [];
      for (let s = 1; s < 20000; s++) {
        if (rand() < 0.04) { const n = ['left', 'right', 'stop'][Math.floor(rand() * 3)]; if (n !== go) { go = n; changes.push({ at: s, go }); } }
        g1.keysDown.clear();
        if (go === 'left') g1.keysDown.add('ArrowLeft');
        if (go === 'right') g1.keysDown.add('ArrowRight');
        g1.step();
        r2.step(go);
        const a = g1.get();
        if (a.charX !== r2.charX || a.score !== r2.score || a.runComplete !== r2.complete) {
          console.error('DIFFER', { day, fw, fh, s, v1: a, v2: { charX: r2.charX, score: r2.score, complete: r2.complete } });
          process.exit(1);
        }
        steps++;
        if (a.runComplete) break;
      }
      // And the replay of the recorded changes gives the same score.
      const back = v2.replay(day, { frame: { width: fw, height: fh }, steps: r2.steps, changes });
      if (!back.ok || back.score !== r2.score) { console.error('REPLAY', back, r2.score); process.exit(1); }
      runs++;
    }
  }
}
console.log(`v1 and v2 agree: ${runs} runs, ${steps} steps compared; every replay matched.`);
