"""Browser check of Cosmic Junkyard version 2 in a plain-iframe host (the tile's tier 2), in headless Chromium.

  python test/browser/check_tile.py            (from the repo's top folder)

Plays real runs through the page's own loop (keys held and let go between frames, Playwright's clock driving the
frames), then: the end screen without a saving host (version 1's layout, no save controls); with one (can-save):
Save this run sends write-record without moves, or with them when ticked; the moves replay (scripts/check-run.mjs) to
the score the page showed; the host's answers (asking, saving, saved with "See it" sending open-record; declined; not-
allowed); sound starts on Start and the mute button silences it; a sprite sent during a run waits for the run's end;
the existing messages (hello, sprite-status ready, sprite) work as before.
"""
import http.server, json, os, random, socketserver, subprocess, sys, threading, functools

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  ({extra})' if extra and not cond else ''))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/test/browser/host.html'

# Counts the oscillators the tile starts (each note is one), so the check can hear without speakers.
AUDIO_SPY = """
(() => {
  const AC = window.AudioContext;
  window.__notes = 0;
  window.AudioContext = class extends AC {
    createOscillator() { window.__notes++; return super.createOscillator(); }
  };
})();
"""

def frame_of(page):
    return page.frame_locator('#t')

def tile(page):
    return page.frames[1]

def tick(page, ms):
    page.clock.run_for(ms)

def play_run(page, seed, hold_ms=(100, 700)):
    """Start (or Play Again) and play to the end with random key holds. -> the score shown."""
    t = tile(page)
    rnd = random.Random(seed)
    t.focus('#game')
    page.keyboard.press('Enter')
    tick(page, 50)
    for _ in range(400):
        if t.evaluate("() => document.getElementById('savePanel').hidden === false") or t.evaluate("() => window.__cjDone && window.__cjDone()"):
            break
        key = rnd.choice(['ArrowLeft', 'ArrowRight', None, 'both'])
        if key == 'both':
            page.keyboard.down('ArrowLeft'); page.keyboard.down('ArrowRight')
        elif key:
            page.keyboard.down(key)
        tick(page, rnd.randint(*hold_ms))
        page.keyboard.up('ArrowLeft'); page.keyboard.up('ArrowRight')
        tick(page, rnd.randint(0, 300))
    tick(page, 3000)

def new_page(browser, answer=None):
    ctx = browser.new_context(viewport={'width': 400, 'height': 600})
    page = ctx.new_page()
    page.add_init_script(AUDIO_SPY)
    page.clock.install()
    page.goto(URL)
    if answer is not None:
        page.evaluate("(a) => { window.answerHello = () => a.forEach((m) => window.toTile(m)); }", answer)
    # the tile loads after the host's script: give it time, then (re)send hello answers if it already said hello
    tick(page, 500)
    if answer is not None and any(m.get('kind') == 'hello' for m in page.evaluate('window.got')):
        page.evaluate("(a) => a.forEach((m) => window.toTile(m))", answer)
    tick(page, 200)
    return ctx, page

# The test hook: when the run has ended (read from the page's own text: the score line goes, Play Again shows).
DONE_HOOK = "() => { window.__cjDone = () => false; }"

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])

    # 1. No host that saves: hello is sent, the end screen has no save controls.
    ctx, page = new_page(browser, answer=[{'kind': 'sprite-status', 'state': 'ready'}])
    t = tile(page)
    got = page.evaluate('window.got')
    ok('hello sent as before', got and got[0] == {'source': 'cosmic-junkyard', 'kind': 'hello', 'v': 1}, got)
    ok('sprite-status ready reveals the sprite button', t.evaluate("() => getComputedStyle(document.getElementById('spriteBtn')).display") != 'none')
    ok('the mute button is in the bar, sound on', t.evaluate("() => document.getElementById('muteBtn').getAttribute('aria-pressed')") == 'false')
    notes0 = t.evaluate('window.__notes')
    play_run(page, 1)
    ok('a run ends: no save controls without can-save', t.evaluate("() => document.getElementById('savePanel').hidden") is True)
    notes1 = t.evaluate('window.__notes')
    ok('sounds played during the run (start, catches or hits, the end tune)', notes1 - notes0 >= 10, notes1 - notes0)
    ok('nothing written without a saving host', not any(m.get('kind') == 'write-record' for m in page.evaluate('window.got')))
    ctx.close()

    # 2. A saving host: Save without moves; then with moves, replayed to the same score.
    can = {'kind': 'can-save', 'collections': ['cafe.thunderbird.cosmicjunkyard.run']}
    ctx, page = new_page(browser, answer=[{'kind': 'sprite-status', 'state': 'ready'}, can])
    t = tile(page)
    play_run(page, 2)
    ok('with can-save the end screen shows Save this run', t.evaluate("() => !document.getElementById('savePanel').hidden"))
    ok('the moves box starts unticked', t.evaluate("() => document.getElementById('movesBox').checked") is False)
    t.click('#saveBtn')
    tick(page, 50)
    writes = [m for m in page.evaluate('window.got') if m.get('kind') == 'write-record']
    w = writes[-1] if writes else {}
    rec = w.get('record', {})
    ok('write-record sent, shaped like writeRecord', w.get('action') == 'create' and w.get('collection') == 'cafe.thunderbird.cosmicjunkyard.run' and isinstance(w.get('id'), str), w)
    ok('the record: score, day, playedAt, tally; no moves unticked', set(rec) == {'score', 'day', 'playedAt', 'tally'} and 'moves' not in rec, rec)
    ok('the button waits while the host works', t.evaluate("() => document.getElementById('saveBtn').disabled") and 'Waiting for the host' in t.inner_text('#saveStatus'))
    page.evaluate("(id) => window.toTile({ kind: 'write-record-status', id, state: 'asking' })", w['id']); tick(page, 50)
    ok('asking shows', 'allow' in t.inner_text('#saveStatus'))
    page.evaluate("(id) => window.toTile({ kind: 'write-record-result', id, ok: false, error: 'declined' })", w['id']); tick(page, 50)
    ok('declined: Not saved, and Save works again', t.inner_text('#saveStatus') == 'Not saved.' and not t.evaluate("() => document.getElementById('saveBtn').disabled"))
    shown = rec.get('score')
    # now with moves
    t.check('#movesBox')
    t.click('#saveBtn'); tick(page, 50)
    w2 = [m for m in page.evaluate('window.got') if m.get('kind') == 'write-record'][-1]
    rec2 = w2['record']
    ok('a second try has a new id', w2['id'] != w['id'])
    mv = rec2.get('moves') or {}
    ok('ticked: moves with frame, steps, changes', set(mv) == {'frame', 'steps', 'changes'} and mv['frame'] == {'width': 48, 'height': 48} and len(mv['changes']) > 5, mv.keys())
    ok('changes are { at, go } in step order', all(set(c) == {'at', 'go'} and c['go'] in ('left', 'right', 'stop') for c in mv['changes']) and all(a['at'] < b['at'] for a, b in zip(mv['changes'], mv['changes'][1:])))
    with open('/tmp/cj-run.json', 'w') as fh: json.dump(rec2, fh)
    out = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'check-run.mjs'), '/tmp/cj-run.json'], capture_output=True, text=True)
    ok('the saved moves replay to the score the page showed', out.returncode == 0 and 'checks out' in out.stdout, out.stdout + out.stderr)
    print('   ', out.stdout.strip().replace('\n', ' / '))
    page.evaluate("(id) => window.toTile({ kind: 'write-record-status', id, state: 'saving' })", w2['id']); tick(page, 50)
    ok('saving shows', t.inner_text('#saveStatus') == 'Saving…')
    page.evaluate("(id) => window.toTile({ kind: 'write-record-result', id: 'run-99', ok: true, uri: 'at://did:plc:x/cafe.thunderbird.cosmicjunkyard.run/3abc', handle: 'someone.else' })", w2['id']); tick(page, 50)
    ok('a result for another id is ignored', t.inner_text('#saveStatus') == 'Saving…')
    uri = 'at://did:plc:abc/cafe.thunderbird.cosmicjunkyard.run/3m2abcdefgh22'
    page.evaluate("([id, uri]) => window.toTile({ kind: 'write-record-result', id, ok: true, uri, handle: 'thunderbird.cafe' })", [w2['id'], uri]); tick(page, 50)
    ok("saved: Saved to @handle's account ✓ and See it", "Saved to @thunderbird.cafe's account ✓" in t.inner_text('#saveStatus') and t.locator('#seeIt').count() == 1, t.inner_text('#saveStatus'))
    ok('the button says Saved', t.inner_text('#saveBtn') == 'Saved' and t.evaluate("() => document.getElementById('saveBtn').disabled"))
    t.click('#seeIt'); tick(page, 50)
    opens = [m for m in page.evaluate('window.got') if m.get('kind') == 'open-record']
    ok('See it sends open-record with that address', opens and opens[-1]['uri'] == uri, opens)
    # Play Again clears the save controls
    t.focus('#game'); page.keyboard.press('Enter'); tick(page, 100)
    ok('Play Again hides the save controls', t.evaluate("() => document.getElementById('savePanel').hidden"))
    ctx.close()

    # 3. Mute, a sprite during a run, and not-allowed.
    ctx, page = new_page(browser, answer=[{'kind': 'sprite-status', 'state': 'ready'}, can])
    t = tile(page)
    t.click('#muteBtn'); tick(page, 50)
    ok('mute: aria-pressed true', t.evaluate("() => document.getElementById('muteBtn').getAttribute('aria-pressed')") == 'true')
    n0 = t.evaluate('window.__notes')
    t.focus('#game'); page.keyboard.press('Enter'); tick(page, 3000)
    ok('muted: no sounds', t.evaluate('window.__notes') == n0, t.evaluate('window.__notes') - n0)
    # a 64 x 64 frame sheet, sent mid-run: the run keeps its 48 x 48 character
    page.evaluate("""() => { const c = document.createElement('canvas'); c.width = 192; c.height = 256; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 192, 256);
      window.toTile({ kind: 'sprite', image: c.toDataURL('image/png'), frameWidth: 64, frameHeight: 64, sheetWidth: 192, sheetHeight: 256, handle: 'mid.run' }); }""")
    tick(page, 200)
    ok('the bar names the new character at once', t.inner_text('#status') == 'Playing as @mid.run')
    t.click('#muteBtn'); tick(page, 50)
    play_run(page, 3)
    t.check('#movesBox'); t.click('#saveBtn'); tick(page, 50)
    w3 = [m for m in page.evaluate('window.got') if m.get('kind') == 'write-record'][-1]
    ok('the run kept its starting frame size (48)', w3['record']['moves']['frame'] == {'width': 48, 'height': 48}, w3['record']['moves']['frame'])
    page.evaluate("(id) => window.toTile({ kind: 'write-record-result', id, ok: false, error: 'not-allowed' })", w3['id']); tick(page, 50)
    ok('not-allowed: says so, Save stays off', 'copy of the game' in t.inner_text('#saveStatus') and t.evaluate("() => document.getElementById('saveBtn').disabled"))
    t.focus('#game'); page.keyboard.press('Enter'); tick(page, 100)
    play_run(page, 4)
    t.click('#saveBtn'); tick(page, 50)
    t.evaluate("() => document.getElementById('saveBtn').click()"); tick(page, 50)
    w4 = [m for m in page.evaluate('window.got') if m.get('kind') == 'write-record']
    ok('one request per tap while the host works', w4[-1]['id'] != w3['id'] and sum(1 for m in w4 if m['id'] == w4[-1]['id']) == 1)
    page.evaluate("(id) => window.toTile({ kind: 'write-record-result', id, ok: false, error: 'failed' })", w4[-1]['id']); tick(page, 50)
    t.check('#movesBox'); t.click('#saveBtn'); tick(page, 50)
    w5 = [m for m in page.evaluate('window.got') if m.get('kind') == 'write-record'][-1]
    ok('the next run is played with the new 64 x 64 character', w5['record']['moves']['frame'] == {'width': 64, 'height': 64}, w5['record']['moves']['frame'])
    with open('/tmp/cj-run64.json', 'w') as fh: json.dump(w5['record'], fh)
    out = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'check-run.mjs'), '/tmp/cj-run64.json'], capture_output=True, text=True)
    ok('and replays to its score too', out.returncode == 0 and 'checks out' in out.stdout, out.stdout)
    page.screenshot(path='/tmp/cj-end.png')
    ctx.close()
    browser.close()

passed = sum(1 for _, c in results if c)
print(f'\n{passed} of {len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
