#!/usr/bin/env node
// Replays a saved Cosmic Junkyard run and says whether its score checks out.
//
//   node scripts/check-run.mjs run.json [tile/index.html]
//
// run.json: a cafe.thunderbird.cosmicjunkyard.run record (the value as stored, or getRecord's whole answer) saved with
// "Include my moves so this run can be checked". tile/index.html: the version of the game that made it (the record's
// game.cid names it; this folder's copy by default). The game's RUN ENGINE block is taken out of that file and run here,
// so the replay is the very code the player ran, on the same day's course, with the same character frame size and the
// same moves, one 60 Hz step at a time.
//
// What a passing check shows: those moves, on that day's course, in that version of the game, give that score. What it
// can't show: that a person (and not a program) played them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The run engine from a copy of the game's index.html (its RUN ENGINE block). */
export function loadEngine(html) {
  const m = /\/\/ ==== RUN ENGINE START ====([\s\S]*?)\/\/ ==== RUN ENGINE END ====/.exec(html);
  if (!m) throw new Error('No RUN ENGINE block in that file (version 1 of the game has none: its runs carry no moves).');
  return new Function(`"use strict";${m[1]}\nreturn RunEngine;`)();
}

/** → { ok, score, tally, steps } from the replay, plus { claimed, matches } comparing it with the record's own. */
export function checkRun(record, html) {
  const value = record && record.value && typeof record.value === 'object' ? record.value : record;
  if (!value || typeof value !== 'object') return { ok: false, problem: 'not a run record' };
  if (!value.moves) return { ok: false, problem: 'this run was saved without its moves, so it can\'t be replayed' };
  const engine = loadEngine(html);
  const r = engine.replay(value.day, value.moves);
  if (!r.ok) return r;
  const tallyMatches = !value.tally || ['dodged', 'hit', 'saucers', 'aliens'].every((k) => value.tally[k] === r.tally[k]);
  return { ...r, claimed: value.score, matches: r.score === value.score && tallyMatches };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runFile, tileFile = path.join(here, '..', 'tile', 'index.html')] = process.argv.slice(2);
  if (!runFile) { console.error('Usage: node scripts/check-run.mjs run.json [tile/index.html]'); process.exit(2); }
  const record = JSON.parse(readFileSync(runFile, 'utf8'));
  const result = checkRun(record, readFileSync(tileFile, 'utf8'));
  if (!result.ok) { console.log(`Can't replay this run: ${result.problem}.`); process.exit(1); }
  const v = record.value || record;
  console.log(`Day ${v.day}, ${result.steps} steps: the replay scores ${result.score} (${result.tally.dodged} dodged, ${result.tally.hit} hit, ${result.tally.saucers} saucers, ${result.tally.aliens} aliens).`);
  console.log(result.matches ? `The record says ${result.claimed}: it checks out.` : `The record says ${result.claimed}: it does NOT match.`);
  process.exit(result.matches ? 0 : 1);
}
