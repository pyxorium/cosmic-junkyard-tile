"""tools/sound-tuning.html opens from a file, every Play makes notes, editing a number changes what plays, and
"Copy settings" gives text that, pasted into the tile, is the same settings.  python test/browser/check_tuning.py"""
import os, re, json, sys, subprocess
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPY = "(() => { const AC = window.AudioContext; window.__f = []; window.__noise = 0; window.AudioContext = class extends AC { createBufferSource() { window.__noise++; return super.createBufferSource(); } createOscillator() { const o = super.createOscillator(); const set = o.frequency.setValueAtTime.bind(o.frequency); o.frequency.setValueAtTime = (v, t) => { window.__f.push(v); return set(v, t); }; return o; } }; })();"
res = []
def ok(n, c, d=''): res.append(c); print(('PASS ' if c else 'FAIL ') + n + (f'  [{d}]' if d and not c else ''))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page()
    pg.add_init_script(SPY)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + os.path.join(ROOT, 'tools', 'sound-tuning.html'))
    names = pg.eval_on_selector_all('section h2', 'els => els.map(e => e.firstChild.textContent)')
    ok('six sounds listed', names == ['start', 'catch', 'alien', 'hit', 'end', 'click'])
    ok('the wave list offers noise', 'noise' in pg.eval_on_selector_all('section select option', 'os => os.map(o => o.value)'))
    for i, n in enumerate(names):
        before = pg.evaluate('window.__f.length')
        pg.locator('section').nth(i).locator('button.play').click()
        ok(f'Play {n} makes notes', pg.evaluate('window.__f.length') > before)
    n0 = pg.evaluate('window.__noise')
    pg.locator('section').nth(3).locator('button.play').click()
    ok('the hit plays a noise burst (an explosion)', pg.evaluate('window.__noise') > n0)
    # rendered offline with the page's own engine: loud enough, and it starts bright and ends dull
    loud = pg.evaluate('''async () => {
      const ctx = new OfflineAudioContext(1, 44100, 44100); ctx.resume = () => Promise.resolve();
      const OrigAC = window.AudioContext; let made = null;
      window.AudioContext = function () { made = ctx; return ctx; };
      const src = document.querySelector('script:not([src])').textContent;
      const block = src.slice(src.indexOf('// ==== SOUND ENGINE START ===='), src.indexOf('// ==== SOUND ENGINE END ===='));
      const eng = new Function(block + '; return createSoundEngine(SOUND_SETTINGS);')();
      eng.settings.sounds.test = [{ wave: 'noise', from: 3000, to: 200, at: 0, dur: 0.5, gain: 0.45, attack: 0.003 }]; eng.unlock(); eng.play('test');
      window.AudioContext = OrigAC;
      const buf = await ctx.startRendering(); const d = buf.getChannelData(0);
      const rms = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += d[i] * d[i]; return Math.sqrt(t / (b - a)); };
      // zero crossings per sample: high for a hiss, low for a rumble
      const zc = (a, b) => { let n = 0; for (let i = a + 1; i < b; i++) if ((d[i] >= 0) !== (d[i - 1] >= 0)) n++; return n / (b - a); };
      return { early: rms(0, 4410), late: rms(13230, 17640), tail: rms(30870, 44100), zcEarly: zc(0, 4410), zcLate: zc(13230, 17640) };
    }''')
    ok('rendered (a test noise note, 3000 to 200 Hz): loud at first, quieter later, silent after', loud['early'] > 0.01 and loud['late'] < loud['early'] and loud['tail'] < 0.002, str(loud))
    ok('...bright at first, a rumble later', loud['zcEarly'] > 2 * loud['zcLate'], str(loud))
    inp = pg.locator('section').nth(1).locator('input[type=number]').first
    inp.fill('1234'); inp.dispatch_event('change')
    pg.locator('section').nth(1).locator('button.play').click()
    ok('an edited pitch plays', 1234 in pg.evaluate('window.__f'))
    text = pg.evaluate('window.__settingsText()')
    pg.click('#reset')
    orig = pg.evaluate('window.__settingsText()')
    ok('no page errors', not errs, str(errs))
    b.close()
# the reset text, put in place of the tile's SOUND_SETTINGS, gives back exactly the tile's settings
html = open(os.path.join(ROOT, 'tile', 'index.html')).read()
m = re.search(r'  const SOUND_SETTINGS = \{[\s\S]*?\n  \};', html)
js = "const a = (()=>{%s; return SOUND_SETTINGS})(); const b = (()=>{%s; return SOUND_SETTINGS})(); console.log(JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'differ')" % (m.group(0), orig)
out = subprocess.run(['node', '-e', js], capture_output=True, text=True).stdout.strip()
ok('Copy settings (after Reset) pastes back as the tile\'s own settings', out == 'same')
ok('the edited copy differs', '1234' in text)
print(f'\n{sum(res)} of {len(res)} passed'); sys.exit(0 if all(res) else 1)
