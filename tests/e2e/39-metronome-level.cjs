// Bug: the metronome / count-in click was far louder than the piano (0.5 vs ~0.2 for a note), most obvious on the first beat of a piece where the
// click stacks with the notes. The click is now calibrated below the notes, softer at the start, never scheduled in the past, and has its own volume.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/long.musicxml', fs.readFileSync(D + 'long.musicxml')]]);
  const { browser, page } = await h.start(store, { countIn: true, context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.evaluate(() => (location.hash = '#/score/long.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  // record the loudness of every click: a click is an oscillator at 1000 / 1500 Hz whose gain ramps up to its level
  await page.evaluate(() => {
    window.__clicks = []; window.__notes = [];
    const lin = AudioParam.prototype.linearRampToValueAtTime; const exp = AudioParam.prototype.exponentialRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (v, t) { if (v > 0.0001) window.__clicks.push({ level: v, ahead: t - 0.004 - window.__pianist.player.ctx.currentTime }); return lin.call(this, v, t); };
    AudioParam.prototype.exponentialRampToValueAtTime = function (v, t) { if (v > 0.05) window.__notes.push(v); return exp.call(this, v, t); };
    window.__pianist.player.metronome = true;
  });
  const run = async (ms) => { await page.evaluate(() => { window.__clicks.length = 0; window.__notes.length = 0; }); await page.click('button[title^=播放]'); await page.waitForTimeout(ms); await page.evaluate(() => window.__pianist.player.pause()); await page.waitForTimeout(300); return page.evaluate(() => ({ clicks: window.__clicks.slice(), notes: window.__notes.slice() })); };
  let r = await run(4200);
  const levels = r.clicks.map(c => c.level); const accents = levels.filter((_, i) => i % 4 === 0), normal = levels.filter((_, i) => i % 4 !== 0);
  ok(levels.length >= 6, `clicks were recorded (${levels.length})`);
  ok(Math.max(...levels) <= 0.2, `no click is louder than 0.2 (it was 0.5): max ${Math.max(...levels).toFixed(3)}`);
  ok(Math.max(...accents) / Math.max(...normal) > 1.1 && Math.max(...accents) / Math.max(...normal) < 1.6, `the downbeat is only a little stronger (x${(Math.max(...accents) / Math.max(...normal)).toFixed(2)})`);
  ok(new Set(accents.map(x => x.toFixed(3))).size === 1, 'the first click is as loud as every other downbeat (no louder first one)');
  ok(Math.min(...r.clicks.map(c => c.ahead)) >= -0.001, `no click is scheduled in the past (earliest ${Math.min(...r.clicks.map(c => c.ahead)).toFixed(3)} s ahead)`);
  ok(Math.max(...levels) <= Math.max(...r.notes), `a click is not louder than a note (click ${Math.max(...levels).toFixed(2)}, note ${Math.max(...r.notes).toFixed(2)})`);
  // the click has its own volume
  await page.evaluate(() => { const s = document.querySelector('input.clickvol'); s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  r = await run(2800); const loud = Math.max(...r.clicks.map(c => c.level));
  ok(loud > Math.max(...levels) * 1.4, `the slider makes it louder (${Math.max(...levels).toFixed(2)} -> ${loud.toFixed(2)})`);
  await page.evaluate(() => { const s = document.querySelector('input.clickvol'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  r = await run(2800); ok(r.clicks.length === 0, 'at 0 there is no click at all');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).clickVolume) === 0, 'the choice is remembered');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
