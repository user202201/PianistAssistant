const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/duet.musicxml', fs.readFileSync(D + 'Four-Hands-Duet.musicxml')]]);
  const { browser, page } = await h.start(store, { context: IPAD });
  const open = async (n) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), n); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(900); };
  await open('long');

  // walk through the first step of every line and record what the preview does
  const rows = await page.evaluate(() => {
    const { player, score, views } = window.__pianist; const v = views[0]; const out = []; const seen = new Set();
    score.steps.forEach((s, i) => { player.seekStep(i); const cur = document.querySelector('[id^=cursorImg]').getBoundingClientRect(); const wr = v.wrap.getBoundingClientRect(); const key = Math.round(v.wrap.scrollTop + cur.top);
      if (seen.has(key)) return; seen.add(key);
      const pk = v.peek; const shown = pk.style.display === 'block'; const r = pk.getBoundingClientRect();
      out.push({ line: out.length + 1, scroll: Math.round(v.wrap.scrollTop), shown, top: shown ? Math.round(r.top - wr.top) : null, h: shown ? Math.round(r.height) : null, href: shown ? pk.querySelector('use')?.getAttribute('href') : null, curBottom: Math.round(cur.bottom - wr.top), viewH: Math.round(wr.height) }); });
    return out;
  });
  console.log(rows.map(r => `line ${r.line}: scroll ${r.scroll} peek ${r.shown ? `top ${r.top} h ${r.h}` : 'hidden'}`).join('\n'));
  ok(rows.length >= 6, `walked through ${rows.length} lines`);
  ok(rows.some(r => r.shown), 'the preview appears when the next line is not fully on screen');
  ok(rows.filter(r => r.shown).every(r => r.href === '#osmdSvgPage1' && r.top >= 0 && r.top + r.h <= 834), 'preview stays inside the screen and shows this score');
  ok(rows.filter(r => r.shown).every(r => r.top >= r.curBottom - 12), 'it sits right below the current line (may float over the control bar), never over it');
  ok(await page.evaluate(() => { const w = window.__pianist.views[0].wrap; return w.scrollWidth <= w.clientWidth + 1; }), 'the preview adds no horizontal scrollbar');
  ok(!rows[rows.length - 1].shown, 'no preview after the last line');
  ok(rows.some(r => !r.shown), 'and it is gone when the next line fits on the screen (after the page turn)');

  // show one in a screenshot
  const showAt = rows.find(r => r.shown);
  await page.evaluate(() => { const { player, score } = window.__pianist; player.seekStep(score.steps.findIndex(s => s.measure === 9 && s.onset === 0.25)); });
  await page.waitForTimeout(300); await page.screenshot({ path: D + 'peek.png' });

  // settings: off / other modes
  await page.click('button[title=设置]'); await page.waitForSelector('dialog');
  await page.uncheck('dialog label:has-text("预览下一行") input'); await page.click('dialog button.primary');
  ok(await page.evaluate(() => window.__pianist.views[0].peek.style.display) === 'none', 'switched off in settings: no preview');
  await page.click('button[title=设置]'); await page.check('dialog label:has-text("预览下一行") input'); await page.selectOption('dialog select:has(option[value=smooth])', 'smooth'); await page.click('dialog button.primary');
  ok(await page.evaluate(() => { const { player, score, views } = window.__pianist; player.seekStep(score.steps.length - 5); return views[0].peek.style.display; }) === 'none', 'only in page-turn mode (not with smooth scrolling)');
  await page.click('button[title=设置]'); await page.selectOption('dialog select:has(option[value=smooth])', 'page'); await page.click('dialog button.primary');

  // split view: each screen has its own preview that points at its own drawing
  await page.click('button[title=返回]'); await page.waitForSelector('.home'); await open('duet');
  // small screens so that a preview is needed on both
  await page.setViewportSize({ width: 1194, height: 600 }); await page.waitForTimeout(900);
  const sp = await page.evaluate(() => { const { player, score, views } = window.__pianist; player.seekStep(Math.floor(score.steps.length / 2)); return views.map(v => { const id = v.holder.querySelector('svg').id; return { id, display: v.peek.style.display, href: v.peek.querySelector('use')?.getAttribute('href') ?? null, same: document.querySelectorAll('[id="' + id + '"]').length }; }); });
  console.log('split previews:', JSON.stringify(sp));
  ok(sp.every(x => x.display !== 'block'), 'no next-line preview in the four-hand split view');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
