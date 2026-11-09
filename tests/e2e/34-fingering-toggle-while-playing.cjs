// Bug: pressing the fingering button while the music plays redrew the whole score and restarted playback, with the count-in clicks again.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')]]);
  const { browser, page } = await h.start(store, { countIn: true, context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 15000 }); await page.waitForTimeout(1500);
  await page.click('button[title^=播放]'); await page.waitForTimeout(3500);
  ok(await page.evaluate(() => window.__pianist.player.playing), 'it is playing (after the count-in)');
  await page.evaluate(() => { const p = window.__pianist.player; window.__calls = []; const o = p.play.bind(p); p.play = (...a) => { window.__calls.push(a); return o(...a); }; window.__svg = document.querySelector('.scorewrap svg'); });
  await page.click('button[title="显示 / 隐藏指法"]'); await page.waitForTimeout(600);
  await page.click('button[title="显示 / 隐藏指法"]'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ playing: window.__pianist.player.playing, calls: window.__calls.length, same: document.querySelector('.scorewrap svg') === window.__svg }));
  ok(r.playing && r.calls === 0, `showing / hiding the fingering while playing does not stop or restart playback (play() called ${r.calls}×)`);
  ok(r.same, 'and does not redraw the score');
  // jumping somewhere while playing carries on there, without the count-in clicks
  await page.evaluate(() => { window.__calls.length = 0; window.__pianist.player.seekStep(3); }); await page.waitForTimeout(300);
  const c = await page.evaluate(() => window.__calls);
  ok(c.length === 1 && c[0][0] === false, 'jumping while playing resumes without the count-in');
  await page.click('button[title^=暂停]').catch(() => {});
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
