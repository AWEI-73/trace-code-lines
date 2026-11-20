# UI trial driver (runs inside the no-network namespace; only loopback is up).
# Opens the dev server, looks for a control whose text/label names each target (PDF, PPTX …),
# opening menus whose label says download/export/more when the control is hidden, clicks it and
# keeps the download. Config from TCL_UI (JSON); prints one line prefixed @@TCL_UI_DRIVER@@.
import json, os, re, time, sys
from urllib.parse import urlparse, urljoin
cfg = json.loads(os.environ.get('TCL_UI', '{}'))
out = {'pages': [], 'targets': [], 'requests': {'loopback': 0, 'outside': []}, 'console': [], 'error': None}
try:
    from playwright.sync_api import sync_playwright
except Exception as e:  # no driver
    out['error'] = 'no-playwright: ' + str(e)
    print('@@TCL_UI_DRIVER@@' + json.dumps(out)); sys.exit(0)
MENU = re.compile(cfg.get('menuRe', r'download|export|share|more|menu|下載|匯出|分享|更多'), re.I)
base = cfg['base']; dl_dir = cfg['downloadDir']; budget = time.time() + cfg.get('budgetS', 240)
def same_origin(u): return urlparse(u).netloc == urlparse(base).netloc
def visible_match(page, rx):
    for role in ('menuitem', 'button', 'link', 'option'):
        loc = page.get_by_role(role, name=rx)
        for i in range(min(loc.count(), 6)):
            el = loc.nth(i)
            try:
                if el.is_visible() and el.is_enabled(): return el, role
            except Exception: pass
    loc = page.get_by_text(rx)
    for i in range(min(loc.count(), 6)):
        el = loc.nth(i)
        try:
            if el.is_visible(): return el, 'text'
        except Exception: pass
    return None, None
def label_of(el):
    try: return (el.get_attribute('aria-label') or el.inner_text() or el.get_attribute('title') or '').strip()[:80]
    except Exception: return ''
with sync_playwright() as p:
    kw = {'args': ['--no-sandbox', '--disable-dev-shm-usage']}
    if cfg.get('chrome'): kw['executable_path'] = cfg['chrome']
    try: b = p.chromium.launch(**kw)
    except Exception as e:
        out['error'] = 'browser-launch: ' + str(e)[:300]; print('@@TCL_UI_DRIVER@@' + json.dumps(out)); sys.exit(0)
    ctx = b.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 900})
    def on_req(r):
        h = urlparse(r.url).hostname or ''
        if r.url.startswith(('data:', 'blob:', 'about:')) or h in ('127.0.0.1', 'localhost', '::1'): out['requests']['loopback'] += 1
        elif len(out['requests']['outside']) < 20: out['requests']['outside'].append(r.url[:200])
    ctx.on('request', on_req)
    # window.print() opens a dialog a headless browser cannot show: count the call, keep the page as it is, and let the driver print it
    ctx.add_init_script('window.__tclPrint = 0; window.print = function () { window.__tclPrint = (window.__tclPrint || 0) + 1; };')
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and len(out['console']) < 12 and out['console'].append(m.text[:200]))
    page.on('pageerror', lambda e: len(out['console']) < 12 and out['console'].append('pageerror: ' + str(e)[:200]))
    def goto(u):
        try:
            page.goto(u, wait_until='load', timeout=60000); page.wait_for_timeout(cfg.get('settleMs', 1500))
            out['pages'].append({'url': u, 'title': page.title()[:80]}); return True
        except Exception as e:
            out['pages'].append({'url': u, 'error': str(e)[:200]}); return False
    last_hit = None
    for t in cfg['targets']:
        rx = re.compile(t['re'], re.I); res = {'term': t['term'], 'file': t.get('file'), 'clicked': None, 'via': [], 'download': None, 'error': None, 'pagesTried': []}
        t_start = time.time()
        # start where the previous target's control was found (same menu, usually), then the home page
        queue, seen = ([last_hit] if last_hit else []) + [base + '/'], set()
        while queue and not res['download'] and time.time() < budget and len(res['pagesTried']) < cfg.get('maxPages', 6):
            u = queue.pop(0)
            if u in seen: continue
            seen.add(u)
            if not goto(u): continue
            res['pagesTried'].append(u)
            el, role = visible_match(page, rx); via = []
            if not el:  # open menus whose label says download / export / more
                trig = page.locator('[aria-label],[title],button')
                for i in range(min(trig.count(), 60)):
                    tr = trig.nth(i)
                    try:
                        lab = (tr.get_attribute('aria-label') or tr.get_attribute('title') or '')
                        if not MENU.search(lab) or not tr.is_visible() or not tr.is_enabled(): continue
                        tr.click(timeout=3000); page.wait_for_timeout(400)
                        el, role = visible_match(page, rx)
                        if el: via = [lab[:60]]; break
                        page.keyboard.press('Escape'); page.wait_for_timeout(200)
                    except Exception: pass
            if el:
                res['clicked'] = {'role': role, 'label': label_of(el)}; res['via'] = via
                try:
                    got = []; page.on('download', lambda d: got.append(d))
                    page.evaluate('window.__tclPrint = 0')
                    el.click(timeout=5000); end = time.time() + cfg.get('downloadTimeoutMs', 120000) / 1000
                    while time.time() < end and not got:
                        page.wait_for_timeout(500)
                        if page.evaluate('window.__tclPrint || 0'):
                            # the control calls window.print(): save what the print dialog would, as the browser's "Save as PDF" does
                            page.wait_for_timeout(500); dest = os.path.join(dl_dir, t['term'] + '-print.pdf')
                            page.emulate_media(media='print'); page.pdf(path=dest, prefer_css_page_size=True, print_background=True); page.emulate_media(media='screen')
                            page.evaluate("window.dispatchEvent(new Event('afterprint'))")
                            res['download'] = {'name': '（列印對話框）', 'path': dest, 'bytes': os.path.getsize(dest), 'failure': None, 'viaPrint': True}; break
                    if got and not res['download']:
                        dl = got[0]; name = dl.suggested_filename; dest = os.path.join(dl_dir, t['term'] + '-' + name)
                        dl.save_as(dest); res['download'] = {'name': name, 'path': dest, 'bytes': os.path.getsize(dest), 'failure': dl.failure()}
                    if not res['download']: res['error'] = 'no-download: 按下後 ' + str(cfg.get('downloadTimeoutMs', 120000) // 1000) + ' 秒內沒有下載，也沒有叫出列印'
                except Exception as e:
                    res['error'] = 'click-failed: ' + str(e)[:200]
                break
            # follow same-origin links (one level deeper than the home page)
            if len(res['pagesTried']) == 1:
                hrefs = page.eval_on_selector_all('a[href]', 'els => els.map(e => e.href)')
                for h in hrefs:
                    h = h.split('#')[0]
                    if same_origin(h) and h not in seen and h not in queue and h.rstrip('/') != base: queue.append(h)
                queue = queue[:cfg.get('maxPages', 6)]
        if res['clicked']: last_hit = res['pagesTried'][-1] if res['pagesTried'] else None
        res['ms'] = int((time.time() - t_start) * 1000)
        if not res['clicked'] and not res['error']: res['error'] = 'no-control: 沒找到寫著「' + t['term'] + '」的按鈕或選單'
        out['targets'].append(res)
    b.close()
print('@@TCL_UI_DRIVER@@' + json.dumps(out, ensure_ascii=False))
