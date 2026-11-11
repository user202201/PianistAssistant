// First start: an empty library shows a short welcome with a button that adds example scores (one of them a four-hand piece); the welcome is gone once
// there is something in the library or when it is dismissed.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  // local mode, empty
  const { browser, page, store } = await h.start(new Map(), { local: true, context: { viewport: { width: 1194, height: 834 } } });
  await page.waitForTimeout(800);
  ok(await page.isVisible('.welcome'), 'an empty library shows the welcome card');
  ok((await page.textContent('.welcome')).includes('添加示例曲目'), 'with a button to add example scores');
  await page.screenshot({ path: D + 'welcome.png' });
  await page.click('#add-samples'); await page.waitForTimeout(3500);
  const names = await page.evaluate(() => [...document.querySelectorAll('.listbox .card')].map((c) => c.innerText.trim().split('\n')[0]));
  ok(names.length >= 3, `the example scores are in the list (${names.join(' | ')})`);
  ok(!(await page.isVisible('.welcome')), 'and the welcome card is gone');
  await page.click('.tabsbar .seg[data-k=duet]'); await page.waitForTimeout(300);
  ok((await page.textContent('.listbox')).includes('Ode to Joy (4 hands)'), 'the two Ode parts are already a four-hand piece');
  await page.click('.tabsbar .seg[data-k=all]');
  // it opens and plays
  await page.click('.listbox .card .open >> nth=0'); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => !!window.__pianist && window.__pianist.player.score.events.length > 8), 'an example score opens and has notes');
  await page.evaluate(() => (location.hash = '#/')); await page.reload(); await page.waitForSelector('.home'); await page.waitForTimeout(800);
  ok(!(await page.isVisible('.welcome')), 'after a reload the welcome does not come back');
  await browser.close();
  // dismissing without samples
  const b2 = await h.start(new Map(), { local: true, context: { viewport: { width: 390, height: 780 } } });
  await b2.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.lang = 'de'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); }); await b2.page.reload(); await b2.page.waitForSelector('.welcome');
  await b2.page.waitForTimeout(800);
  const small = await b2.page.evaluate(() => { const w = document.querySelector('.welcome'); const r = w.getBoundingClientRect(); const bad = [...w.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > r.right + 1 || (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible')).length; return { inside: r.left >= 0 && r.right <= 391 && bad === 0, scrollX: document.documentElement.scrollWidth <= 390 }; });
  await b2.page.screenshot({ path: D + 'welcome-de.png' });
  ok(small.inside && small.scrollX, 'on a phone, in German, the card fits the screen and nothing sticks out');
  await b2.page.click('#skip-welcome'); await b2.page.waitForTimeout(300);
  ok(!(await b2.page.isVisible('.welcome')), '"No thanks" closes it');
  await b2.page.reload(); await b2.page.waitForSelector('.home'); await b2.page.waitForTimeout(600);
  ok(!(await b2.page.isVisible('.welcome')) && !(await b2.page.textContent('.listbox')).includes('Ode'), 'and it stays closed, nothing was added');
  await b2.browser.close();
  // a library that is not empty never shows it
  const b3 = await h.start(new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { context: { viewport: { width: 1194, height: 834 } } });
  await b3.page.waitForTimeout(600);
  ok(!(await b3.page.isVisible('.welcome')), 'a library with scores does not show the welcome');
  await b3.browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
