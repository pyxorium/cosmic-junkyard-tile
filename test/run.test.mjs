// The game's run engine and replays (scripts/check-run.mjs), the sound block's copy, and that a run record as the tile
// sends it (plus what the host fills in) fits the lexicon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEngine, checkRun } from '../scripts/check-run.mjs';
import { readLexicons } from '../scripts/publish-lexicons.mjs';
import { checkRunRecord } from '../scripts/run-record.mjs';

const html = readFileSync(new URL('../tile/index.html', import.meta.url), 'utf8');
const E = loadEngine(html);

function playRandom(day, fw, fh, seed) {
  let r = seed >>> 0;
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const run = E.createRun({ day, frameWidth: fw, frameHeight: fh });
  let go = 'stop';
  const changes = [];
  while (!run.complete) {
    if (rand() < 0.05) { const n = ['left', 'right', 'stop'][Math.floor(rand() * 3)]; if (n !== go) { go = n; changes.push({ at: run.steps + 1, go }); } }
    run.step(go);
  }
  return { score: run.score, day, tally: E.tallyBreakdown(run.dropLog), moves: { frame: { width: fw, height: fh }, steps: run.steps, changes } };
}

test('version 2 plays exactly as version 1 (step by step, many days, frame sizes and inputs)', () => {
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('./v1-v2.mjs', import.meta.url)), fileURLToPath(new URL('./fixtures/index-v1.html', import.meta.url))], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /agree/);
});

test('a run replays to its score; a changed score, tally, day, frame or move does not', () => {
  const v = playRandom('2026-11-19', 48, 48, 7);
  assert.deepEqual(checkRun(v, html), { ok: true, score: v.score, tally: v.tally, steps: v.moves.steps, claimed: v.score, matches: true });
  assert.equal(checkRun({ ...v, score: v.score + 1 }, html).matches, false);
  assert.equal(checkRun({ ...v, tally: { ...v.tally, hit: v.tally.hit + 1 } }, html).matches, false);
  const other = checkRun({ ...v, day: '2026-11-18' }, html);
  assert.ok(!other.ok || !other.matches, 'another day\'s course');
  const big = checkRun({ ...v, moves: { ...v.moves, frame: { width: 96, height: 96 } } }, html);
  assert.ok(!big.ok || !big.matches, 'a bigger character');
  const moved = structuredClone(v);
  for (const c of moved.moves.changes) c.go = c.go === 'left' ? 'right' : c.go === 'right' ? 'left' : 'stop';
  const m = checkRun(moved, html);
  assert.ok(!m.ok || !m.matches, 'left and right swapped');
  // getRecord's whole answer works too
  assert.equal(checkRun({ uri: 'at://x', cid: 'y', value: v }, html).matches, true);
});

test('replays refuse what isn\'t a run: no moves, out-of-order or unknown moves, too many, moves after the end', () => {
  const v = playRandom('2026-11-19', 48, 48, 9);
  assert.match(checkRun({ ...v, moves: undefined }, html).problem, /without its moves/);
  assert.equal(E.replay(v.day, { ...v.moves, changes: [{ at: 5, go: 'left' }, { at: 5, go: 'right' }] }).problem, 'changes');
  assert.equal(E.replay(v.day, { ...v.moves, changes: [{ at: 5, go: 'up' }] }).problem, 'changes');
  assert.equal(E.replay(v.day, { ...v.moves, changes: Array.from({ length: 4001 }, (_, i) => ({ at: i + 1, go: i % 2 ? 'left' : 'stop' })) }).problem, 'changes');
  assert.equal(E.replay(v.day, { ...v.moves, changes: [...v.moves.changes, { at: v.moves.steps + 5, go: 'left' }] }).problem, 'moves after the end');
  assert.equal(E.replay(v.day, { ...v.moves, steps: v.moves.steps + 1 }).problem, 'steps');
  assert.equal(E.replay('19 Nov', v.moves).problem, 'day');
});

test('the course is the same for everyone on a day, and differs between days', () => {
  assert.deepEqual(E.generateDailySequence('2026-11-19'), E.generateDailySequence('2026-11-19'));
  assert.notDeepEqual(E.generateDailySequence('2026-11-19'), E.generateDailySequence('2026-11-20'));
});

test('the sound tuning page holds the same SOUND ENGINE block as the tile', () => {
  const block = (s) => /\/\/ ==== SOUND ENGINE START ====([\s\S]*?)\/\/ ==== SOUND ENGINE END ====/.exec(s)?.[1];
  const page = readFileSync(new URL('../tools/sound-tuning.html', import.meta.url), 'utf8');
  assert.ok(block(html));
  assert.equal(block(page), block(html), 'copy the block from tile/index.html into tools/sound-tuning.html (or the other way, after tuning)');
});

test('a run as the tile sends it, with the host\'s fields, fits the lexicon; moves are optional', () => {
  const lex = readLexicons()[0];
  const v = playRandom('2026-11-19', 48, 48, 11);
  const full = { $type: lex.id, game: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24', cid: 'bafyreif6tgpdhckolcpncqtxgc4jdckfuezhpjq7y5sehhexv356tgleyi' },
    score: v.score, day: v.day, playedAt: '2026-11-19T18:00:00.000Z', tally: v.tally, moves: v.moves, createdAt: '2026-11-19T18:00:05.000Z' };
  assert.equal(checkRunRecord(full), null);
  const { moves, ...noMoves } = full;
  assert.equal(checkRunRecord(noMoves), null);
  assert.match(checkRunRecord({ ...full, score: 1.5 }), /score/);
  assert.match(checkRunRecord({ ...full, extra: 1 }), /extra/);
  assert.match(checkRunRecord({ ...full, day: '2026-1-9' }), /day/);
  assert.match(checkRunRecord({ ...full, moves: { ...moves, changes: [{ at: 1, go: 'jump' }] } }), /go/);
  assert.match(checkRunRecord({ ...full, game: { uri: 'x' } }), /game/);
});
