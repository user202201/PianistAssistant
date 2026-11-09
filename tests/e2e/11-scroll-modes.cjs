const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')]]);
  const { browser, page } = await h.start(store, { context: IPAD });
  await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('.controls .big'); await page.waitForTimeout(600);

  // walk the cursor through every step, in the given mode
  const walk = () => page.evaluate(() => {
    const { player, score } = window.__pianist; const w = document.querySelector('.scorewrap'); const band = document.querySelector('.linehl'); const hold = document.querySelector('.score');
    const out = []; player.seekStep(0);
    for (let i = 0; i < score.steps.length; i += 1) {
      player.seekStep(i);
      const cur = document.querySelector('[id^=cursorImg]').getBoundingClientRect(); const wr = w.getBoundingClientRect(); const hr = hold.getBoundingClientRect(); const br = band.getBoundingClientRect();
      out.push({ i, scroll: w.scrollTop, curTop: Math.round(cur.top - hr.top), visible: cur.top >= wr.top - 1 && cur.bottom <= wr.bottom + 1, bandOk: Math.abs((br.top - hr.top) - (cur.top - hr.top - 8)) < 2 && band.style.display === 'block' });
    }
    return { out, height: document.querySelector('.scorewrap').clientHeight, total: document.querySelector('.osmd svg').getBoundingClientRect().height };
  });
  const setMode = async (m) => { await page.click('button[title=设置]'); await page.waitForSelector('dialog'); await page.selectOption('dialog select:has(option[value=smooth])', m); await page.click('dialog button.primary'); await page.evaluate(() => { document.querySelector('.scorewrap').scrollTop = 0; }); };

  // ---- page mode (default)
  let r = await walk(); const systems = new Set(r.out.map(x => x.curTop)).size;
  const scrolls = [...new Set(r.out.map(x => x.scroll))];
  console.log(`score height ${Math.round(r.total)}px, view ${r.height}px, ${systems} lines, scroll positions used: ${scrolls.join(', ')}`);
  ok(systems >= 6, `test score has many lines (${systems})`);
  ok(r.out.every(x => x.visible), 'page mode: the line being played is always fully on screen');
  let changes = 0; for (let k = 1; k < r.out.length; k++) if (r.out[k].scroll !== r.out[k - 1].scroll) { changes++; ok(r.out[k].curTop !== r.out[k - 1].curTop, `scroll only moves when the cursor changes line (step ${k})`) || 0; }
  ok(changes <= systems, `the view jumped ${changes} times for ${systems} lines (never within a line)`);
  const sameLineMoves = r.out.filter((x, k) => k && x.curTop === r.out[k - 1].curTop && x.scroll !== r.out[k - 1].scroll).length;
  ok(sameLineMoves === 0, 'zero scroll movements while playing inside one line');
  ok(r.out.every(x => x.bandOk), 'the current-line highlight follows the cursor');
  await page.screenshot({ path: D + 'pagemode.png' });

  // ---- jumps are instant (no gliding): the scroll position is final in the same frame
  const instant = await page.evaluate(() => { const { player, score } = window.__pianist; const w = document.querySelector('.scorewrap'); w.scrollTop = 0; player.seekStep(score.steps.length - 1); return w.scrollTop; });
  await page.waitForTimeout(500);
  ok(instant === await page.evaluate(() => document.querySelector('.scorewrap').scrollTop) && instant > 0, `page turn is instant, no animation (scrollTop ${instant} right away and after 0.5s)`);

  // ---- off
  await setMode('off'); r = await walk();
  ok(r.out.every(x => x.scroll === 0), 'off: the view never scrolls by itself');
  // ---- smooth
  await setMode('smooth'); const sm = await page.evaluate(() => { const { player, score } = window.__pianist; const w = document.querySelector('.scorewrap'); w.scrollTop = 0; player.seekStep(score.steps.length - 1); return w.scrollTop; });
  await page.waitForTimeout(900);
  const sm2 = await page.evaluate(() => document.querySelector('.scorewrap').scrollTop);
  ok(sm < sm2, `smooth: glides (scrollTop ${sm} right after, ${sm2} later)`);
  // ---- highlight toggle + remembered
  await page.click('button[title=设置]'); await page.waitForSelector('dialog'); await page.uncheck('dialog label:has-text("高亮") input'); await page.click('dialog button.primary');
  ok(await page.evaluate(() => document.querySelector('.linehl').style.display) === 'none', 'highlight can be switched off');
  ok(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); return s.scrollMode === 'smooth' && s.lineHighlight === false; }), 'choices are remembered');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
