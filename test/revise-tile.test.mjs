// The revise script (claude/cosmic-junkyard-v2-plan.md, CJ2-1) against a stand-in account server holding the record as
// it was first published (record.prepared.json, Oct 2 2026: its manifest address in the old links-as-maps encoding).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRevise, TILE, TILE_URI, COLLECTION } from '../scripts/revise-tile.mjs';
import { rawCid } from '../scripts/lib/cid.js';
import { dagCborCid } from '../scripts/lib/dagcbor.js';

const PDS = 'https://fibercap.us-west.host.bsky.network';
const FIRST = JSON.parse(readFileSync(new URL('../record.prepared.json', import.meta.url), 'utf8'));
const V1_HTML = new Uint8Array(readFileSync(new URL('./fixtures/index-v1.html', import.meta.url)));
const V2_HTML = new Uint8Array(readFileSync(new URL('../tile/index.html', import.meta.url)));
const SPRITE = new Uint8Array(readFileSync(new URL('../tile/sprite.png', import.meta.url)));
const quiet = () => {};

function server({ record = FIRST, recordCid = 'bafyreirecordoneaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', password = 'abcd-efgh-ijkl-mnop', mimeFor = () => null, swapFails = false } = {}) {
  let cur = { cid: recordCid, value: structuredClone(record) };
  const blobs = new Map();
  const calls = [];
  let n = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, init });
    if (u.host === 'plc.directory') return json({ id: TILE.did, alsoKnownAs: ['at://thunderbird.cafe'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    if (u.pathname.endsWith('createSession')) return JSON.parse(init.body).password === password ? json({ did: TILE.did, accessJwt: 'jwt' }) : json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401);
    if (u.pathname.endsWith('getRecord')) {
      // the server's own field order (reversed), as Bluesky's does
      return json({ uri: TILE_URI, cid: cur.cid, value: Object.fromEntries(Object.entries(cur.value).reverse()) });
    }
    if (u.pathname.endsWith('uploadBlob')) {
      const bytes = new Uint8Array(init.body);
      const cid = await rawCid(bytes);
      blobs.set(cid, bytes);
      // Bluesky labels a stored file by its contents
      const mimeType = mimeFor(init.headers['Content-Type']) || (bytes[0] === 0x89 ? 'image/png' : 'text/html');
      return json({ blob: { $type: 'blob', ref: { $link: cid }, mimeType, size: bytes.length } });
    }
    if (u.pathname.endsWith('putRecord')) {
      const b = JSON.parse(init.body);
      if (swapFails || b.swapRecord !== cur.cid) return json({ error: 'InvalidSwap', message: 'Record was at bafy…' }, 400);
      cur = { cid: `bafyreirecord${++n}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, value: b.record };
      return json({ uri: TILE_URI, cid: cur.cid });
    }
    return json({ error: 'NotFound' }, 404);
  };
  return { fetchImpl, calls, blobs, get record() { return cur; } };
}
const files = (html) => (f) => (f.endsWith('index.html') ? html : SPRITE);

test('the first record is understood (links-as-maps), and the v1 files there are what was published', async () => {
  assert.equal(await dagCborCid(FIRST.tile, { linksAsMaps: true }), FIRST.cid);
  assert.equal(await rawCid(V1_HTML), FIRST.tile.resources['/'].src.ref.$link, 'test/fixtures/index-v1.html is the published version 1');
  assert.equal(await rawCid(SPRITE), FIRST.tile.resources['/sprite.png'].src.ref.$link);
});

test('a dry run lists only index.html as changed and writes nothing', async () => {
  const s = server();
  const lines = [];
  const r = await runRevise({ fetchImpl: s.fetchImpl, log: (l) => lines.push(l), dryRun: true, env: {}, readFile: files(V2_HTML),
    ask: () => assert.fail('no questions'), askHidden: () => assert.fail('no password'), saveBackup: () => assert.fail('no backup'), writePublished: () => assert.fail('nothing written') });
  assert.deepEqual(r.due, ['/']);
  assert.ok(lines.some((l) => l.includes('keep /sprite.png')));
  assert.ok(!s.calls.some((c) => c.init.method === 'POST'));
});

test('unchanged files: nothing to do', async () => {
  const r = await runRevise({ fetchImpl: server().fetchImpl, log: quiet, env: {}, readFile: files(V1_HTML), ask: () => assert.fail(), askHidden: () => assert.fail() });
  assert.equal(r.changed, false);
});

test('revising: backup, one upload, the record replaced with swapRecord, real links, read back, published.json', async () => {
  const s = server();
  let backup = null, pub = null;
  const r = await runRevise({ fetchImpl: s.fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readFile: files(V2_HTML),
    ask: async () => 'y', askHidden: () => assert.fail('the password came from the environment'),
    saveBackup: (name, text) => { backup = { name, text }; }, readPublished: () => ({ lexicons: { x: 1 } }), writePublished: (o) => { pub = o; },
    now: () => new Date('2026-11-20T10:00:00Z') });
  assert.equal(r.changed, true);
  assert.match(backup.name, /^backup-3mwvoqidyqd24-2026-11-20T10-00-00-000Z\.json$/);
  assert.equal(JSON.parse(backup.text).value.cid, FIRST.cid);
  const ups = s.calls.filter((c) => c.path.endsWith('uploadBlob'));
  assert.equal(ups.length, 1, 'only the changed file is uploaded');
  assert.equal(ups[0].init.headers['Content-Type'], 'text/html');
  const put = JSON.parse(s.calls.find((c) => c.path.endsWith('putRecord')).init.body);
  assert.deepEqual([put.repo, put.collection, put.rkey, put.validate, put.swapRecord], [TILE.did, COLLECTION, TILE.rkey, false, 'bafyreirecordoneaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  const v = s.record.value;
  assert.equal(v.cid, await dagCborCid(v.tile), 'the new manifest address uses real links');
  assert.equal(v.tile.resources['/'].src.ref.$link, await rawCid(V2_HTML));
  assert.equal(v.tile.resources['/'].src.mimeType, 'text/html', "the server's own answer");
  assert.deepEqual(v.tile.resources['/sprite.png'], FIRST.tile.resources['/sprite.png'], 'the sprite is untouched');
  assert.equal(v.tile.name, FIRST.tile.name);
  assert.equal(v.tile.description, FIRST.tile.description);
  assert.equal(v.createdAt, FIRST.createdAt);
  assert.equal(pub.lexicons.x, 1, 'the lexicons in published.json are kept');
  assert.deepEqual(pub.tile, { uri: TILE_URI, cid: r.cid, manifestCid: v.cid, files: { '/': await rawCid(V2_HTML), '/sprite.png': await rawCid(SPRITE) }, revisedAt: '2026-11-20T10:00:00.000Z' });
  assert.deepEqual(pub.tileEarlier, [{ uri: TILE_URI, cid: 'bafyreirecordoneaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', manifestCid: FIRST.cid,
    files: { '/': FIRST.tile.resources['/'].src.ref.$link, '/sprite.png': FIRST.tile.resources['/sprite.png'].src.ref.$link }, replacedAt: '2026-11-20T10:00:00.000Z' }], 'version 1, as it was');

  // and again on top of that: the previous version moves to tileEarlier, and the real-link record is understood
  const s2 = server({ record: v, recordCid: r.cid });
  let pub2 = null;
  const other = new Uint8Array([...V2_HTML, 0x0a]);
  await runRevise({ fetchImpl: s2.fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readFile: files(other), ask: async () => 'y', askHidden: quiet,
    saveBackup: () => {}, readPublished: () => pub, writePublished: (o) => { pub2 = o; } });
  assert.deepEqual(pub2.tileEarlier.map((e) => e.cid), [r.cid, 'bafyreirecordoneaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
});

test('a server that labels the page differently: its label is used, once', async () => {
  const s = server({ mimeFor: () => 'application/octet-stream' });
  const r = await runRevise({ fetchImpl: s.fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readFile: files(V2_HTML), ask: async () => 'y', askHidden: quiet, saveBackup: () => {}, readPublished: () => ({}), writePublished: () => {} });
  assert.equal(r.changed, true);
  assert.equal(s.record.value.tile.resources['/'].src.mimeType, 'application/octet-stream');
});

test('stops safely: "no", a record changed meanwhile, a wrong password, a record it doesn\'t understand', async () => {
  const base = { log: quiet, readFile: files(V2_HTML), askHidden: async () => 'abcd-efgh-ijkl-mnop', saveBackup: () => {}, readPublished: () => ({}), writePublished: () => assert.fail('nothing written'), env: {} };
  const s = server();
  assert.equal((await runRevise({ ...base, fetchImpl: s.fetchImpl, ask: async () => 'n' })).changed, false);
  assert.ok(!s.calls.some((c) => c.path.endsWith('putRecord')));
  await assert.rejects(runRevise({ ...base, fetchImpl: server({ swapFails: true }).fetchImpl, ask: async () => 'y' }), /changed after it was read/);
  await assert.rejects(runRevise({ ...base, fetchImpl: server().fetchImpl, ask: async () => 'y', askHidden: async () => 'wrong' }), /Invalid identifier or password/);
  const odd = structuredClone(FIRST); odd.cid = 'bafyreisomethingelseaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await assert.rejects(runRevise({ ...base, fetchImpl: server({ record: odd }).fetchImpl, ask: async () => 'y' }), /doesn't recompute/);
});

test('a record with more files than tile\\ (a screenshot added later): they stay as they are', async () => {
  const withShot = structuredClone(FIRST);
  withShot.tile.resources['/screenshot.png'] = { src: { $type: 'blob', ref: { $link: 'bafkreishotaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, mimeType: 'image/png', size: 9 }, 'content-type': 'image/png' };
  withShot.tile.screenshots = [{ src: '/screenshot.png', type: 'image/png', sizes: '775x387' }];
  withShot.cid = await dagCborCid(withShot.tile);
  const s = server({ record: withShot });
  const lines = [];
  await runRevise({ fetchImpl: s.fetchImpl, log: (l) => lines.push(l), env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readFile: files(V2_HTML), ask: async () => 'y', askHidden: quiet, saveBackup: () => {}, readPublished: () => ({}), writePublished: () => {} });
  assert.ok(lines.some((l) => l.includes('/screenshot.png')));
  assert.deepEqual(s.record.value.tile.resources['/screenshot.png'], withShot.tile.resources['/screenshot.png']);
  assert.deepEqual(s.record.value.tile.screenshots, withShot.tile.screenshots);
});
