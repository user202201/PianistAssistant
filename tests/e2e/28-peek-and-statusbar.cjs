const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const long = fs.readFileSync(D + 'long.musicxml');
  const store = new Map([['scores/L1.musicxml', long], ['scores/L2.musicxml', long], ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'LL', a: 'L1.musicxml', b: 'L2.musicxml' }] }))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, left: 0, bottom: 0, right: 0 } });
  await page.evaluate(() => (location.hash = '#/duet/L1.musicxml/L2.musicxml')); await page.waitForFunction(() => document.querySelectorAll('.pane').length === 2 && window.__pianist, null, { timeout: 15000 }); await page.waitForTimeout(1500);
  const scan = () => page.evaluate(() => { const { player, score, views } = window.__pianist; let shown = 0; for (let i = 0; i < score.steps.length; i++) { player.seekStep(i); if (views.some(v => v.peek.style.display === 'block')) shown++; } return shown; });
  ok(await scan() === 0, 'both parts side by side: no next-line preview');
  await page.locator('.pane >> nth=0').locator('.pname').click(); await page.waitForTimeout(700); // I play A, B is folded
  ok(await scan() > 0, 'the other part folded: the single big window shows the next-line preview again');
  await page.locator('.pane >> nth=0').locator('.pname').click(); await page.waitForTimeout(500);
  // full screen of one part keeps the room of the iPad status bar
  ok(await page.evaluate(() => [...document.querySelectorAll('.collbtn')].every(b => b.getBoundingClientRect().width === 0)), 'no fold button is visible while nothing is folded');
  console.log('state before focus:', await page.evaluate(() => JSON.stringify({ on: window.__pianist.player.partOn, folded: [...document.querySelectorAll('.pane')].map(p => p.classList.contains('collapsed')), btns: [...document.querySelectorAll('.collbtn')].map(b => !b.hidden) })));
  await page.evaluate(() => window.__setFocus(0)); await page.waitForTimeout(600);
  const top = await page.evaluate(() => Math.round(document.querySelector('.pane.focused .panehead').getBoundingClientRect().top));
  ok(top >= 24, `full screen: the button row starts below the status bar area (top=${top}px, status bar 24px)`);
  await page.screenshot({ path: D + 'focus-safe.png' });
  ok(await scan() > 0, 'full screen of one part: preview available too');
  await page.evaluate(() => window.__setFocus(null)); await page.waitForTimeout(400);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
