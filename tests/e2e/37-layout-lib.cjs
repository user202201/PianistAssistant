// The new languages (German, Japanese, Korean) must not only be translated but also FIT: no text pushed off screen, clipped, overlapping or left in Chinese.
// Looks at the main screens on a tablet and on a phone, and saves screenshots (tests/out/work/layout-*.png) for a human look.
const h = require('./harness.cjs'); const fs = require('fs'); const path = require('path'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const data = fs.readFileSync(path.join(__dirname, '../../src/i18n-data.ts'), 'utf8');
const table = (name) => { const m = data.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`)); const t = {}; for (const line of (m ? m[1] : '').split('\n')) { const k = line.match(/^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),?$/); if (k) t[JSON.parse(k[1]).trim()] = JSON.parse(k[2]); } return t; };
const VIEWPORTS = [[1194, 834, 'tablet'], [820, 1180, 'ipad-portrait'], [744, 1133, 'ipad-mini'], [360, 740, 'small-phone'], [844, 390, 'phone-landscape']];
// a pretend App Store (trial running), so that the purchase rows and the unlock dialog can be looked at too
const fakeStore = () => { document.addEventListener('DOMContentLoaded', () => { const st0 = document.createElement('style'); st0.textContent = '*{font-family:"DejaVu Sans",Verdana,sans-serif !important}'; document.head.append(st0); }); /* a wide font on purpose: other machines / phones have other fonts, the layout must not depend on a narrow one */ const st = { firstInstall: Date.now() - 3 * 86400000, owned: false }; window.__store = st; window.Capacitor = { Plugins: { PianistStore: { status: async () => ({ firstInstall: st.firstInstall, owned: st.owned, price: '¥68.00' }), purchase: async () => ({ owned: true }), restore: async () => ({ owned: false }) } } }; };

// what is wrong with the screen right now
const inspect = (page, untranslated, chineseForbidden, W) => page.evaluate(({ untranslated, chineseForbidden, W }) => {
  const bad = []; // W = the real width of the device screen (a mobile browser stretches innerWidth when something is too wide, which would hide the problem)
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  if (document.documentElement.scrollWidth > W + 1) bad.push(`page is wider than the screen (${document.documentElement.scrollWidth} > ${W})`);
  const skip = (el) => el.closest('svg, canvas, .pdfwrap, .scorewrap, .osmd, #toasts, .modelbox, [data-user], .mq'); // (.mq = the scrolling marquee of long card titles: clipping is its job)
  for (const el of document.querySelectorAll('button, label, h1, h2, h3, select, .status, .pageind, p, .pill, .tabsbar *')) {
    if (!vis(el) || skip(el)) continue;
    const r = el.getBoundingClientRect(); const t = (el.textContent || '').trim().slice(0, 40);
    if (r.right > W + 1 || r.left < -1) bad.push(`off screen: <${el.tagName.toLowerCase()}> "${t}" (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`);
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && !(cs.textOverflow === 'ellipsis' && el.clientWidth >= 70)) bad.push(`clipped: <${el.tagName.toLowerCase()}> "${t}" (${el.scrollWidth} > ${el.clientWidth})`);
    if (el.tagName === 'BUTTON' && cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1) bad.push(`text spills out of the button "${t}"`);
  }
  // buttons of one toolbar must not overlap each other
  for (const bar of document.querySelectorAll('.pdfbar, .controls .mainrow, .editbar, .top')) {
    const bs = [...bar.querySelectorAll('button')].filter((b) => vis(b));
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i].getBoundingClientRect(), b = bs[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 3 && oy > 3 && !bs[i].contains(bs[j]) && !bs[j].contains(bs[i])) bad.push(`overlap in ${bar.className.split(' ')[0]}: "${bs[i].textContent.trim().slice(0, 20)}" and "${bs[j].textContent.trim().slice(0, 20)}"`);
    }
  }
  // the bars that must be ONE line (bottom bar, part bars, hand strip) must not wrap onto a second line
  for (const row of document.querySelectorAll('.controls, .panehead, .handstrip')) {
    if (!vis(row) || getComputedStyle(row).position === 'absolute') continue;
    const kids = []; const walk = (n) => { for (const c of n.children) { const cs = getComputedStyle(c); if (cs.display === 'contents') walk(c); else if (cs.position !== 'absolute' && cs.position !== 'fixed' && !c.matches('.panel, .editbar, .dlgfade') && c.getBoundingClientRect().width > 0) kids.push(c); } }; walk(row);
    const mids = kids.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
    if (mids.length > 1 && Math.max(...mids) - Math.min(...mids) > 14) bad.push(`${row.className.split(' ')[0]} wraps onto a second line (${kids.length} items)`);
  }
  // texts that are still the Chinese original
  const un = new Set(untranslated); const re = /[一-鿿]/;
  const walk = (n) => {
    if (n.nodeType === 3) { const v = n.nodeValue.trim(); if (v && !n.parentElement.closest('svg, [data-user], option, .card .mq') && (un.has(v) || (chineseForbidden && re.test(v)))) bad.push(`still Chinese: "${v.slice(0, 40)}"`); return; }
    if (n.nodeType !== 1 || /^(SVG|SCRIPT|STYLE|CANVAS)$/i.test(n.tagName)) return;
    for (const a of ['title', 'placeholder', 'aria-label']) { const v = (n.getAttribute(a) || '').trim(); if (v && (un.has(v) || (chineseForbidden && re.test(v)))) bad.push(`still Chinese (${a}): "${v.slice(0, 40)}"`); }
    n.childNodes.forEach(walk);
  };
  walk(document.body);
  return [...new Set(bad)].slice(0, 12);
}, { untranslated, chineseForbidden, W });

exports.inspect = inspect; exports.fakeStore = fakeStore; exports.table = table; // (the device matrix suites reuse these)
exports.run = async (loc, tname) => {
  {

    const tbl = table(tname); const zhKeys = Object.keys(tbl).filter((k) => !/\{\d+\}/.test(k) && tbl[k].trim() !== k);
    ok(zhKeys.length > 300, `${loc}: translation table loaded (${zhKeys.length} texts)`);
    for (const [w, hgt, vname] of VIEWPORTS) {
      const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['pdfs/Long3.pdf', fs.readFileSync(path.join(__dirname, '../../samples/ocr-lab/Long3.pdf'))]]);
      const { browser, page } = await h.start(store, { locale: loc, init: fakeStore, context: { viewport: { width: w, height: hgt }, hasTouch: true, isMobile: true, locale: loc } });
      const tag = `${loc}/${vname}`; const noZh = loc !== 'ja-JP'; // Japanese legitimately uses kanji
      const check = async (screen) => { await page.waitForTimeout(500); const bad = await inspect(page, zhKeys, noZh, w); await page.screenshot({ path: D + `layout-${loc}-${vname}-${screen}.png` }); ok(bad.length === 0, `${tag} ${screen}: fits${bad.length ? ' — ' + JSON.stringify(bad) : ''}`); };
      await page.evaluate(() => { window.__noAuto = true; });
      await page.waitForSelector('.card'); await check('home');
      await page.evaluate(() => document.querySelector('.top button:last-child')?.click()); await page.waitForSelector('dialog'); await check('settings'); await page.evaluate(() => document.querySelector('#setup-help-btn')?.click()); await page.waitForSelector('#github-setup'); await check('github-setup'); await page.click('#github-setup button.primary'); await page.waitForTimeout(250);
      await page.evaluate(() => document.querySelector('#feedback-btn')?.click()); await page.waitForTimeout(300); if (await page.locator('dialog >> text=/./').count()) await check('feedback');
      await page.evaluate(() => document.querySelectorAll('dialog').forEach((d) => d.close()));
      // the upload dialog for a PDF
      await page.setInputFiles('input[type=file]', { name: 'Piece.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(D + 'Test-Piece-for-OCR.pdf') });
      await page.waitForSelector('dialog.center'); await check('pdf-dialog'); await page.click('#convert-help-btn'); await page.waitForSelector('#convert-help'); await check('convert-help'); await page.click('#convert-help button.primary'); await page.waitForTimeout(250); await page.evaluate(() => document.querySelector('#pdf-cancel')?.click()); await page.waitForTimeout(300);
      // a score with its panels
      await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200); await check('player');
      for (const [i, b] of (await page.$$('.controls button.narrow')).entries()) { await b.click().catch(() => {}); await check(`player-panel${i}`); await b.click().catch(() => {}); }
      // four hands: two screens
      await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.waitForFunction(() => document.querySelectorAll('.pane').length === 2, null, { timeout: 30000 }); await page.waitForTimeout(1500); await check('duet');
      // PDF viewer: bar, annotation tools, seconds dialog
      await page.evaluate(() => (location.hash = '#/pdf/Long3.pdf')); await page.waitForFunction(() => document.querySelectorAll('.pdfsheet').length === 3, null, { timeout: 30000 }); await page.waitForTimeout(800);
      await check('pdf'); await page.click('.zone.left button'); await check('pdf-annotate');
      await page.click('button.secs'); await page.waitForSelector('#turn-settings'); await check('pdf-seconds'); await page.keyboard.press('Escape');
      // device mode: the settings with "PDF conversion" and the connect dialog
      await page.evaluate(() => { localStorage.setItem('pianist.storage', 'local'); location.hash = '#/'; }); await page.reload(); await page.waitForSelector('.top'); await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelector('.top button:last-child')?.click()); await page.waitForSelector('dialog.settings[open]'); await check('settings-local');
      await page.evaluate(() => document.querySelector('#connect-conv-btn')?.click()); await page.waitForSelector('#connect-conv[open]'); await check('connect-conv');
      await page.evaluate(() => document.querySelectorAll('dialog').forEach((d) => d.close()));
      await page.evaluate(() => { localStorage.removeItem('pianist.storage'); location.hash = '#/'; }); await page.reload(); await page.waitForSelector('.card'); await page.waitForTimeout(400);
      // the trial is over: the unlock dialog
      await page.evaluate(() => { window.__store.firstInstall = Date.now() - 15 * 86400000; location.hash = '#/'; }); await page.waitForTimeout(400);
      await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('dialog#paywall', { timeout: 10000 }); await check('unlock');
      await browser.close();
    }
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
};
