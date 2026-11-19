// Publishes the tile in tile\ over Cosmic Junkyard's own record, in place (claude/cosmic-junkyard-v2-plan.md, CJ2-1), on
// the pattern of the Web Tile Foundry's scripts/set-tile-screenshot.mjs and scripts/revise-tape.mjs. The address stays
// at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24, so the blog post's embed, the Live Gallery, the
// Station and Raku all get the new version. Run from C:\thunderbird-cafe\cosmic-junkyard-tile (Node 22, no packages):
//
//   node scripts/revise-tile.mjs              update the record (shows what changes; asks before writing)
//   node scripts/revise-tile.mjs --dry-run    show what would change; ask nothing, write nothing
//
// It reads the record, checks it understands it (its manifest address must recompute, in the links-as-maps encoding
// of the first publish's Python script or the real-link one the Foundry and atile use), and compares each file in
// tile\ with the one in the record. Then it takes the app password from $env:BSKY_APP_PASSWORD (or asks for it,
// hidden as you type), saves a backup of the current record in backups\, asks once more, uploads only the changed
// files (using the server's own answer for each in the record), rebuilds the manifest's address (real links), and
// replaces the record only if it hasn't changed since it was read (swapRecord). It reads the record back to check it,
// and writes the new version into published.json ("tile", and the one it replaced into "tileEarlier"): commit it, so
// this repo says which files each record version (the CID a saved run names) was made from.
// The tile's name, description and every other setting stay as they are in the record.
import readline from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawCid } from './lib/cid.js';
import { dagCborCid } from './lib/dagcbor.js';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const TILE = Object.freeze({ did: 'did:plc:6vxjigxrqizmbo56gojxico3', rkey: '3mwvoqidyqd24' });
export const COLLECTION = 'ing.dasl.masl';
export const TILE_URI = `at://${TILE.did}/${COLLECTION}/${TILE.rkey}`;
export const PUBLISHED_FILE = join(ROOT, 'published.json');
const BACKUP_DIR = join(ROOT, 'backups');
// The tile's files, as published: its path in the tile, the file here, its content type.
export const FILES = Object.freeze([
  { path: '/', file: join('tile', 'index.html'), type: 'text/html' },
  { path: '/sprite.png', file: join('tile', 'sprite.png'), type: 'image/png' },
]);

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status; err.error = body && body.error;
    throw err;
  }
  return body;
}
/** Parses "Expected: X, Got: Y" from a PDS InvalidMimeType message (as the Foundry's publish.js). */
const mimeMismatch = (message) => { const m = /Expected:\s*([^,\s]+)\s*,\s*Got:\s*([^\s,]+)/i.exec(message || ''); return m ? { expected: m[1], got: m[2] } : null; };

export async function runRevise({ fetchImpl = fetch, ask, askHidden, log = console.log, dryRun = false, env = process.env,
  readFile = (f) => new Uint8Array(readFileSync(join(ROOT, f))),
  saveBackup = (name, text) => { mkdirSync(BACKUP_DIR, { recursive: true }); writeFileSync(join(BACKUP_DIR, name), text); },
  readPublished = () => (existsSync(PUBLISHED_FILE) ? JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8')) : {}),
  writePublished = (o) => writeFileSync(PUBLISHED_FILE, JSON.stringify(o, null, 2) + '\n'),
  now = () => new Date() } = {}) {
  const doc = await getJson(fetchImpl, `https://plc.directory/${TILE.did}`);
  const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || String(s.id).endsWith('#atproto_pds'));
  if (!svc) throw new Error("Could not find thunderbird.cafe's server.");
  const pds = String(svc.serviceEndpoint).replace(/\/+$/, '');
  const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith('at://'));
  const handle = aka ? aka.slice(5) : TILE.did;

  const recordUrl = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(TILE.did)}&collection=${COLLECTION}&rkey=${TILE.rkey}`;
  const current = await getJson(fetchImpl, recordUrl);
  const manifest = current.value && current.value.tile;
  if (!manifest || !manifest.resources) throw new Error("That record isn't a Web Tile; nothing was changed.");
  const known = [await dagCborCid(manifest), await dagCborCid(manifest, { linksAsMaps: true })];
  if (!known.includes(current.value.cid)) throw new Error("This tile's manifest address doesn't recompute the way this script expects, so it stopped without changing anything.");

  const files = [];
  for (const f of FILES) {
    const bytes = readFile(f.file);
    const cid = await rawCid(bytes);
    const was = manifest.resources[f.path];
    files.push({ ...f, bytes, cid, changed: !was || was.src?.ref?.$link !== cid, was });
  }
  const changed = files.filter((f) => f.changed);
  const extra = Object.keys(manifest.resources).filter((p) => !FILES.some((f) => f.path === p));

  log(`\nTile: ${manifest.name}  (@${handle})`);
  log(`Address: ${TILE_URI}`);
  log(`Record now: ${current.cid}`);
  if (!changed.length) { log('\nThe files in tile\\ are the ones already published. Nothing to change.'); return { changed: false }; }
  log('\nThis will:');
  for (const f of changed) log(`  - ${f.was ? 'replace' : 'add'} ${f.path} with ${f.file} (${(f.bytes.length / 1024).toFixed(1)} KB, ${f.cid})`);
  for (const f of files.filter((x) => !x.changed)) log(`  - keep ${f.path} as it is`);
  if (extra.length) log(`  - keep the record's other files as they are: ${extra.join(', ')}`);
  log('  - keep the name, description and address; anything that shows this address gets the new version');
  if (dryRun) { log('\nDry run: nothing was written.'); return { changed: false, due: changed.map((f) => f.path) }; }

  let password = (env.BSKY_APP_PASSWORD || '').trim();
  if (password) log(`\nUsing the app password in $env:BSKY_APP_PASSWORD (${password.length} characters).`);
  else password = await askHidden(`\nApp password for @${handle} (hidden): `);
  if (!password) throw new Error('No app password given; nothing was changed.');
  const session = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: TILE.did, password }),
  });
  if (session.did !== TILE.did) throw new Error('That app password belongs to a different account; nothing was changed.');
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  const ok = (await ask(`Update the tile at ${TILE_URI}? [y/N] `)).trim().toLowerCase();
  if (ok !== 'y' && ok !== 'yes') { log('Stopped; nothing was changed.'); return { changed: false }; }

  const backupName = `backup-${TILE.rkey}-${now().toISOString().replace(/[:.]/g, '-')}.json`;
  saveBackup(backupName, JSON.stringify(current, null, 2) + '\n');
  log(`Saved a backup of the current record: backups\\${backupName}`);

  const next = structuredClone(manifest);
  for (const f of changed) {
    const res = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'Content-Type': f.type }, body: f.bytes });
    const link = res && res.blob && res.blob.ref && res.blob.ref.$link;
    if (link !== f.cid) throw new Error(`The server stored ${f.path} under a different address than expected; the record is unchanged.`);
    next.resources[f.path] = { ...(f.was || {}), src: { $type: 'blob', ref: { $link: link }, mimeType: res.blob.mimeType || f.type, size: res.blob.size ?? f.bytes.length }, 'content-type': f.type };
    log(`Uploaded ${f.path}`);
  }
  const build = async () => ({ $type: COLLECTION, cid: await dagCborCid(next), tile: next, createdAt: current.value.createdAt || now().toISOString() });
  let record = await build();
  let put;
  for (let attempt = 1; ; attempt++) {
    try {
      put = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.putRecord`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: TILE.did, collection: COLLECTION, rkey: TILE.rkey, record, validate: false, swapRecord: current.cid }),
      });
      break;
    } catch (err) {
      // A server that already held these bytes under another type says so: use its type, once.
      const mm = err.error === 'InvalidMimeType' ? mimeMismatch(err.message) : null;
      const which = mm && changed.find((f) => next.resources[f.path].src.mimeType === mm.got);
      if (attempt === 1 && which) { next.resources[which.path].src.mimeType = mm.expected; record = await build(); continue; }
      if (err.error === 'InvalidSwap') throw new Error('The record changed after it was read (someone else updated it?), so it was not replaced. Run this again.');
      throw new Error(`Replacing the record failed: ${err.message}. The old record is unchanged.`);
    }
  }
  const after = await getJson(fetchImpl, recordUrl);
  if (!after.value || after.value.cid !== record.cid || after.cid !== put.cid) throw new Error('The record was replaced, but reading it back didn\'t match. Check it, and restore the backup if needed.');

  const published = readPublished() || {};
  const files2 = Object.fromEntries(FILES.map((f) => [f.path, next.resources[f.path].src.ref.$link]));
  const entry = { uri: TILE_URI, cid: put.cid, manifestCid: record.cid, files: files2, revisedAt: now().toISOString() };
  // The version just replaced, as it was (the first time, version 1 as it was live), so every version a saved run can name
  // stays listed with the files it was made from.
  const replaced = { uri: TILE_URI, cid: current.cid, manifestCid: current.value.cid,
    files: Object.fromEntries(Object.entries(manifest.resources).map(([k, v]) => [k, v?.src?.ref?.$link || null])), replacedAt: now().toISOString() };
  const earlier = [replaced, ...(published.tileEarlier || [])].filter((e, i, all) => all.findIndex((x) => x.cid === e.cid) === i);
  writePublished({ ...published, tile: entry, tileEarlier: earlier });
  log(`\nDone. ${TILE_URI} is now record ${put.cid}.`);
  log(`  look: https://pdsls.dev/${TILE_URI}`);
  log('Commit published.json. Delete this app password once you are done with it (Bluesky: Settings > Privacy and security > App passwords).');
  return { changed: true, record, cid: put.cid };
}

function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) write(muted ? '\n' : s); };
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const askHidden = (q) => new Promise((r) => { process.stdout.write(q); muted = true; rl.question('', (a) => { muted = false; r(a.trim()); }); });
  return { ask, askHidden, close: () => rl.close() };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const io = makeAsk();
  runRevise({ ask: io.ask, askHidden: io.askHidden, dryRun: process.argv.slice(2).includes('--dry-run') })
    .catch((err) => { console.error(`\n${err.message}`); process.exitCode = 1; })
    .finally(() => io.close());
}
