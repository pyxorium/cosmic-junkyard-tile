// The run lexicon and its publish script, against a stand-in account server (as pyxorium/tile-posts' own test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runPublish, readLexicons, ACCOUNT, SCHEMA, PUBLISHED_FILE } from '../scripts/publish-lexicons.mjs';

const PDS = 'https://fibercap.us-west.host.bsky.network';
const RUN = 'cafe.thunderbird.cosmicjunkyard.run';

test('the lexicons: cafe.thunderbird.cosmicjunkyard.run, nothing else', () => {
  assert.deepEqual(readLexicons().map((l) => l.id), [RUN]);
});

test('the run record: the fields decided (claude/cosmic-junkyard-v2-plan.md, CJ2-4, CJ2-9; the build chat, Nov 19)', () => {
  const l = readLexicons()[0];
  const m = l.defs.main;
  assert.equal(m.type, 'record');
  assert.equal(m.key, 'tid');
  assert.deepEqual(m.record.required, ['game', 'score', 'day', 'playedAt', 'createdAt']);
  const p = m.record.properties;
  assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'day', 'game', 'moves', 'playedAt', 'score', 'tally']);
  assert.equal(p.game.ref, 'com.atproto.repo.strongRef');
  assert.equal(p.score.type, 'integer');
  assert.deepEqual([p.day.minLength, p.day.maxLength], [10, 10]);
  assert.equal(p.playedAt.format, 'datetime');
  assert.equal(p.createdAt.format, 'datetime');
  assert.deepEqual(l.defs.tally.required, ['dodged', 'hit', 'saucers', 'aliens']);
  assert.deepEqual(l.defs.moves.required, ['frame', 'steps', 'changes']);
  assert.equal(l.defs.moves.properties.changes.maxLength, 4000);
  assert.deepEqual(l.defs.frame.required, ['width', 'height']);
  assert.deepEqual(l.defs.change.properties.go.enum, ['left', 'right', 'stop']);
});

function server({ password = 'abcd-efgh-ijkl-mnop', sessionDid = ACCOUNT, mangle = false } = {}) {
  const repo = new Map();
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (u.host === 'plc.directory') return json({ id: ACCOUNT, alsoKnownAs: ['at://thunderbird.cafe'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    if (u.pathname.endsWith('createSession')) {
      const b = JSON.parse(init.body);
      if (b.password !== password) return json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401);
      return json({ did: sessionDid, accessJwt: 'jwt' });
    }
    if (u.pathname.endsWith('putRecord')) {
      const b = JSON.parse(init.body);
      repo.set(`${b.collection}/${b.rkey}`, mangle ? { ...b.record, defs: {} } : b.record);
      return json({ uri: `at://${b.repo}/${b.collection}/${b.rkey}`, cid: 'bafyreilexicon' });
    }
    if (u.pathname.endsWith('getRecord')) {
      const v = repo.get(`${u.searchParams.get('collection')}/${u.searchParams.get('rkey')}`);
      if (!v) return json({ error: 'RecordNotFound' }, 400);
      return json({ uri: 'x', cid: 'bafyreilexicon', value: Object.fromEntries(Object.entries(v).reverse()) });
    }
    return json({ error: 'NotFound' }, 404);
  };
  return { fetchImpl, calls, repo };
}
const quiet = () => {};

test('a dry run shows what would be published and writes nothing', async () => {
  const s = server();
  let wrote = false;
  const r = await runPublish({ fetchImpl: s.fetchImpl, log: quiet, dryRun: true, env: {}, readPublished: () => ({}), writePublished: () => { wrote = true; },
    ask: () => assert.fail('no questions in a dry run'), askHidden: () => assert.fail('no password in a dry run') });
  assert.deepEqual(r.due, [RUN]);
  assert.equal(wrote, false);
  assert.ok(!s.calls.some((c) => c.method === 'POST'));
});

test('publishing: one record keyed by the NSID, read back, published.json written, the TXT record named', async () => {
  const s = server();
  let saved = null;
  const lines = [];
  const r = await runPublish({ fetchImpl: s.fetchImpl, log: (l) => lines.push(l), env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readPublished: () => ({}),
    writePublished: (o) => { saved = o; }, ask: async () => 'y', askHidden: () => assert.fail('the password came from the environment'), now: () => '2026-11-19T12:00:00.000Z' });
  assert.equal(r.changed, true);
  const puts = s.calls.filter((c) => c.path.endsWith('putRecord'));
  assert.deepEqual(puts.map((c) => [c.body.repo, c.body.collection, c.body.rkey, c.body.record.$type]), [[ACCOUNT, SCHEMA, RUN, SCHEMA]]);
  assert.equal(saved.lexicons[RUN].uri, `at://${ACCOUNT}/${SCHEMA}/${RUN}`);
  assert.equal(saved.lexicons[RUN].text, JSON.stringify(readLexicons()[0]));
  assert.ok(lines.some((l) => l.includes('_lexicon.cosmicjunkyard')), 'it reminds about the TXT record');
  const r2 = await runPublish({ fetchImpl: server().fetchImpl, log: quiet, env: {}, readPublished: () => saved, writePublished: () => assert.fail('nothing to write'),
    ask: () => assert.fail('nothing to ask'), askHidden: () => assert.fail('nothing to ask') });
  assert.equal(r2.changed, false);
});

test('once published, the committed published.json matches the lexicon on disk (publish, then commit it)', { skip: !existsSync(PUBLISHED_FILE) && 'not published yet' }, async () => {
  const committed = JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8'));
  const r = await runPublish({ fetchImpl: server().fetchImpl, log: quiet, dryRun: true, env: {}, readPublished: () => committed, ask: quiet, askHidden: quiet });
  assert.deepEqual(r.due, [], 'the lexicon changed since it was published: lexicons only grow (optional fields), and must be published again');
});

test("another account's app password, a wrong one, or a record that doesn't read back, stops it", async () => {
  const go = (s, pw = 'abcd-efgh-ijkl-mnop') => runPublish({ fetchImpl: s.fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: pw }, readPublished: () => ({}), writePublished: () => {}, ask: async () => 'y', askHidden: quiet });
  await assert.rejects(go(server({ sessionDid: 'did:plc:someoneelseaaaaaaaaaaaaa' })), /different account/);
  await assert.rejects(go(server({ mangle: true })), /didn't read back/);
  await assert.rejects(go(server(), 'wrong'), /Invalid identifier or password/);
});
