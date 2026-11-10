// Device matrix: the main screens at the real screen sizes of the iPhones, iPads and Macs the app will meet, upright and sideways, with a long
// language (French) and a wide font on purpose. Every screen is checked like in 37-layout-*: nothing off screen / clipped / overlapping, no bar wrapping
// onto a second line, nothing left in Chinese. Screenshots: tests/out/work/matrix-<device>-<orientation>-<screen>.png (CI keeps them as an artifact).
// NOT a real Safari / iOS: Chromium with the device's CSS size. The iOS simulator (real WebKit) comes later.
const h = require('./harness.cjs'); const fs = require('fs'); const path = require('path'); const lib = require('./37-layout-lib.cjs');
const D = process.env.D;
// CSS pixels (portrait w x h). iPhone 17 / 18 sizes are NOT confirmed: they are listed with the model they are assumed to equal.
const PHONES = [['iPhone SE', 375, 667], ['iPhone 11 / XR', 414, 896], ['iPhone 11 Pro / X / 12-13 mini', 375, 812], ['iPhone 12-14', 390, 844], ['iPhone 12-13 Pro Max / 14 Plus', 428, 926],
  ['iPhone 14 Pro-16', 393, 852], ['iPhone 14 Pro Max-16 Plus', 430, 932], ['iPhone 16 Pro (= 17 / 17 Pro assumed)', 402, 874], ['iPhone 16 Pro Max (= 17 Pro Max assumed)', 440, 956]];
const IPADS = [['iPad mini', 744, 1133], ['iPad 10.2', 810, 1080], ['iPad 10.9 / Air 11', 820, 1180], ['iPad Pro 11', 834, 1194], ['iPad Air 13', 1024, 1366], ['iPad Pro 13', 1032, 1376]];
const MACS = [['Mac window 1280x720', 1280, 720, 'landscape'], ['MacBook Air 13 (1440x780)', 1440, 780, 'landscape'], ['MacBook Pro 14 (1512x860)', 1512, 860, 'landscape'], ['MacBook Pro 16 (1728x1000)', 1728, 1000, 'landscape']];
const sets = { 'iphone-portrait': PHONES.map(([n, w, hh]) => [n, w, hh, 'portrait']), 'iphone-landscape': PHONES.map(([n, w, hh]) => [n, hh, w, 'landscape']),
  'ipad-portrait': IPADS.map(([n, w, hh]) => [n, w, hh, 'portrait']), 'ipad-landscape-mac': [...IPADS.map(([n, w, hh]) => [n, hh, w, 'landscape']), ...MACS] };
exports.sets = Object.keys(sets);
exports.run = async (group) => {
  let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
  const tbl = lib.table('FR'); const zhKeys = Object.keys(tbl).filter((k) => !/\{\d+\}/.test(k) && tbl[k].trim() !== k);
  const long = fs.readFileSync(D + 'long.musicxml');
  const store = () => { const m = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['scores/L1.musicxml', long], ['scores/L2.musicxml', long],
    ['pdfs/Long3.pdf', fs.readFileSync(path.join(__dirname, '../../samples/ocr-lab/Long3.pdf'))], ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'Merry Christmas Darling (4 hands)', a: 'L1.musicxml', b: 'L2.musicxml' }] }))]]);
    for (let i = 1; i <= 12; i++) m.set(`scores/Etude ${i}.musicxml`, long); return m; };
  const safe = (t) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const [name, w, hgt, orient] of sets[group]) {
    const mobile = !/^(Mac|MacBook)/.test(name);
    const { browser, page } = await h.start(store(), { locale: 'fr-FR', init: lib.fakeStore, context: { viewport: { width: w, height: hgt }, hasTouch: mobile, isMobile: mobile, locale: 'fr-FR' } });
    const tag = `${name} ${orient} ${w}x${hgt}`; const file = `matrix-${safe(name)}-${orient}`;
    const check = async (screen) => { await page.waitForTimeout(450); const bad = await lib.inspect(page, zhKeys, true, w); await page.screenshot({ path: D + `${file}-${screen}.png` }); ok(bad.length === 0, `${tag} ${screen}${bad.length ? ' — ' + JSON.stringify(bad) : ''}`); };
    try {
      await page.evaluate(() => { window.__noAuto = true; }); await page.waitForSelector('.card'); await check('home');
      if (orient === 'portrait' && w <= 920) { // one column: the whole page scrolls, no second scroll bar inside
        const sc = await page.evaluate(() => { const l = document.querySelector('.listbox'), hm = document.querySelector('.home'); return { ov: getComputedStyle(l).overflowY, listFull: l.scrollHeight <= l.clientHeight + 2, homeScrolls: hm.scrollHeight > hm.clientHeight + 20 }; });
        ok(sc.ov === 'visible' && sc.listFull && sc.homeScrolls, `${tag} home: one column, the whole page scrolls (list overflow ${sc.ov}, page scrolls ${sc.homeScrolls})`);
      }
      await page.evaluate(() => document.querySelector('.top button:last-child')?.click()); await page.waitForSelector('dialog'); await check('settings'); await page.evaluate(() => document.querySelectorAll('dialog').forEach((d) => d.close()));
      await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200); await check('player');
      await page.evaluate(() => (location.hash = '#/duet/L1.musicxml/L2.musicxml')); await page.waitForFunction(() => document.querySelectorAll('.pane').length === 2, null, { timeout: 30000 }); await page.waitForTimeout(1300); await check('duet');
      await page.evaluate(() => (location.hash = '#/pdf/Long3.pdf')); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 }); await page.waitForTimeout(600);
      await page.click('.zone.left button'); await check('pdf');
    } catch (e) { ok(false, `${tag}: ${String(e.message).split('\n')[0]}`); }
    await browser.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
};
