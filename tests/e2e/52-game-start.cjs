// Game mode: pressing play shows READY ... GO! (with its own little jingle) instead of the metronome count-in; the notes fall in meanwhile
// and the music starts at GO. Practice mode is unchanged (metronome count-in).
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'long.musicxml')]]);
  const { browser, page } = await h.start(store, { countIn: true, context: { viewport: { width: 1194, height: 834 } } });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__osc = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; });
  const word = () => page.evaluate(() => { const w = document.querySelector('.gostart .word'); return w ? { t: w.textContent, cls: w.className, op: Number(getComputedStyle(w).opacity) } : null; });
  await page.click('button[title^=播放]');
  await page.waitForTimeout(700);
  let w = await word(); ok(w && w.t === 'READY' && w.op > 0.3, `play: the screen says READY (${w && w.t})`);
  const pos = await page.evaluate(() => window.__pianist.player.position());
  ok(pos < 0 && await page.evaluate(() => window.__pianist.player.playing), `the music has not started yet, the clock is counting up to it (${pos.toFixed(2)} s)`);
  await page.screenshot({ path: D + 'game-ready.png' });
  ok(await page.evaluate(() => document.querySelector('.countin') === null), 'no metronome count-in numbers in the game view');
  await page.waitForTimeout(2700);
  w = await word(); ok(w && w.t === 'GO!', `then GO! (${w && w.t})`);
  await page.screenshot({ path: D + 'game-go.png' });
  ok(await page.evaluate(() => window.__osc) >= 8, `the start jingle is played (${await page.evaluate(() => window.__osc)} synth voices)`);
  await page.waitForTimeout(1500);
  ok(await word() === null && await page.evaluate(() => window.__pianist.player.position()) > 0.2, 'afterwards the words are gone and the music is playing');
  // pausing during the lead cancels everything
  await page.evaluate(() => window.__pianist.player.pause()); await page.waitForTimeout(200);
  await page.click('button[title^=播放]'); await page.waitForTimeout(600); await page.click('button[title^=播放]'); await page.waitForTimeout(400);
  ok(await word() === null && !(await page.evaluate(() => window.__pianist.player.playing)), 'pausing during READY cancels it');
  // practice mode: the usual metronome count-in
  await page.click('.modetoggle .seg[data-mode=practice]'); await page.waitForTimeout(300);
  await page.click('button[title^=播放]'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => document.querySelector('.countin') !== null && document.querySelector('.gostart') === null), 'practice mode: the numbers of the metronome count-in, no READY / GO');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
