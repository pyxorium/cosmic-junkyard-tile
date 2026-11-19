"""tools/sound-tuning.html opens from a file, every Play makes notes, editing a number changes what plays, and
"Copy settings" gives text that, pasted into the tile, is the same settings.  python test/browser/check_tuning.py"""
import os, re, json, sys, subprocess
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPY = "(() => { const AC = window.AudioContext; window.__f = []; window.AudioContext = class extends AC { createOscillator() { const o = super.createOscillator(); const set = o.frequency.setValueAtTime.bind(o.frequency); o.frequency.setValueAtTime = (v, t) => { window.__f.push(v); return set(v, t); }; return o; } }; })();"
res = []
def ok(n, c): res.append(c); print(('PASS ' if c else 'FAIL ') + n)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page()
    pg.add_init_script(SPY)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + os.path.join(ROOT, 'tools', 'sound-tuning.html'))
    names = pg.eval_on_selector_all('section h2', 'els => els.map(e => e.firstChild.textContent)')
    ok('six sounds listed', names == ['start', 'catch', 'alien', 'hit', 'end', 'click'])
    for i, n in enumerate(names):
        before = pg.evaluate('window.__f.length')
        pg.locator('section').nth(i).locator('button.play').click()
        ok(f'Play {n} makes notes', pg.evaluate('window.__f.length') > before)
    inp = pg.locator('section').nth(1).locator('input[type=number]').first
    inp.fill('1234'); inp.dispatch_event('change')
    pg.locator('section').nth(1).locator('button.play').click()
    ok('an edited pitch plays', 1234 in pg.evaluate('window.__f'))
    text = pg.evaluate('window.__settingsText()')
    pg.click('#reset')
    orig = pg.evaluate('window.__settingsText()')
    ok('no page errors', not errs)
    b.close()
# the reset text, put in place of the tile's SOUND_SETTINGS, gives back exactly the tile's settings
html = open(os.path.join(ROOT, 'tile', 'index.html')).read()
m = re.search(r'  const SOUND_SETTINGS = \{[\s\S]*?\n  \};', html)
js = "const a = (()=>{%s; return SOUND_SETTINGS})(); const b = (()=>{%s; return SOUND_SETTINGS})(); console.log(JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'differ')" % (m.group(0), orig)
out = subprocess.run(['node', '-e', js], capture_output=True, text=True).stdout.strip()
ok('Copy settings (after Reset) pastes back as the tile\'s own settings', out == 'same')
ok('the edited copy differs', '1234' in text)
print(f'\n{sum(res)} of {len(res)} passed'); sys.exit(0 if all(res) else 1)
