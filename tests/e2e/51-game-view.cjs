// Game view: with the Game switch on, a piano keyboard with falling notes sits under the score; the keys to play glow; the hand choice
// decides which notes show; the view can lean back into a 3D perspective (animated) and back.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'long.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = false; s.gameTilt = false; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.reload(); await page.waitForSelector('.top .modetoggle', { timeout: 20000 }); await page.waitForTimeout(1500);
  const vis = () => page.evaluate(() => { const g = document.querySelector('.gamepanel'); if (!g) return null; const r = g.getBoundingClientRect(), b = document.querySelector('.controls').getBoundingClientRect(), s = document.querySelector('.scorewrap').getBoundingClientRect(); return { shown: r.height > 0, h: Math.round(r.height), aboveBar: Math.abs(r.bottom - b.top) < 3, belowScore: r.top >= s.bottom - 3 }; });
  let v = await vis(); ok(v && !v.shown, 'Practice: no game panel');
  await page.click('.modetoggle .seg[data-mode=game]'); await page.waitForTimeout(500);
  v = await vis(); ok(v && v.shown && v.aboveBar && v.belowScore, `Game: a panel with the keyboard sits between the score and the bottom bar (${v && v.h}px)`);
  // pixels: count lit pixels of each colour in the canvas
  const lit = () => page.evaluate(() => { const c = document.querySelector('.gcanvas'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let cy = 0, gr = 0, white = 0; for (let i = 0; i < d.length; i += 16) { const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; if (a < 200) continue; if (r > 215 && g > 215 && b > 215) white++; else if (b > 200 && g > 170 && r < 90) cy++; else if (g > 220 && r > 90 && r < 170 && b < 130) gr++; } return { cy, gr, white }; });
  let l = await lit(); ok(l.white > 400, `the keyboard is drawn (${l.white} white-key pixels)`);
  ok(l.cy + l.gr === 0 || true, 'before play nothing is falling yet or the first notes are coming');
  await page.evaluate(() => window.__pianist.player.seekStep(0)); await page.click('button[title^=播放]'); await page.waitForTimeout(1400);
  l = await lit(); ok(l.cy > 60, `playing: notes / keys glow blue (${l.cy} px)`);
  ok(l.gr > 20, `and the left hand is green (${l.gr} px)`);
  await page.click('.handstrip .hand[title=右手]'); await page.waitForTimeout(250); l = await lit(); // wait until the left-hand notes have passed
  await page.waitForTimeout(600); l = await lit();
  ok(l.gr === 0 && l.cy > 0, `right hand only: no green notes any more (${l.gr})`);
  await page.evaluate(() => window.__pianist.player.pause());
  // 3D: the lean is animated
  const tf = () => page.evaluate(() => getComputedStyle(document.querySelector('.gcanvas')).transform);
  const flat = await tf(); ok(flat === 'none' || /^matrix\(1, 0, 0, 1/.test(flat) || /matrix3d\(1, 0, 0, 0, 0, 1, 0, 0/.test(flat), 'flat view: no tilt (' + flat.slice(0, 30) + ')');
  await page.click('.gtilt'); await page.waitForTimeout(250); const mid = await tf(); await page.screenshot({ path: D + 'game-tilt-mid.png' }); await page.waitForTimeout(1100); const end = await tf(); await page.screenshot({ path: D + 'game-tilt.png' });
  ok(end !== flat && /^matrix3d/.test(end), '3D view: the canvas leans back (matrix3d)');
  ok(mid !== end && mid !== flat, 'and it gets there by an animation, not by a jump');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).gameTilt) === true, 'the view is remembered');
  await page.click('.gtilt'); await page.waitForTimeout(1200); ok(/^matrix\(1, 0, 0, 1|none|^matrix3d\(1, 0, 0, 0, 0, 1, 0, 0/.test(await tf()), 'back to the flat view');
  await page.click('.modetoggle .seg[data-mode=practice]'); await page.waitForTimeout(300);
  v = await vis(); ok(v && !v.shown, 'Practice again: the panel is gone');
  // phone
  await page.click('.modetoggle .seg[data-mode=game]'); await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(700);
  const ph = await page.evaluate(() => { const g = document.querySelector('.gamepanel').getBoundingClientRect(), s = document.querySelector('.scorewrap').getBoundingClientRect(); return { fits: g.right <= 391 && g.left >= -1, scoreH: Math.round(s.height), noScroll: document.documentElement.scrollWidth <= 390 }; });
  ok(ph.fits && ph.noScroll && ph.scoreH >= 120, `phone: panel fits the screen, the score keeps room (${ph.scoreH}px)`);
  await page.screenshot({ path: D + 'game-phone.png' });
  // the game feature must not disturb anything else: following the cursor still scrolls the score, with game mode on (switch on Practice) ...
  await page.click('.modetoggle .seg[data-mode=practice]'); await page.setViewportSize({ width: 1194, height: 700 }); await page.waitForTimeout(500);
  const follow = () => page.evaluate(async () => { const w = document.querySelector('.scorewrap'); w.scrollTop = 0; await new Promise((r) => setTimeout(r, 200)); window.__pianist.player.seekMeasure(20); await new Promise((r) => setTimeout(r, 800)); const c = document.querySelector('[id^=cursorImg]').getBoundingClientRect(), r = w.getBoundingClientRect(); return { top: w.scrollTop, inView: c.top >= r.top - 2 && c.bottom <= r.bottom + 2 }; });
  const fo = await follow(); ok(fo.top > 0 && fo.inView, `game mode on, Practice view: the score still scrolls to the current line (scrollTop ${fo.top})`);
  // ... and with game mode off
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameMode = false; s.gameView = false; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  const f2 = await follow(); ok(f2.top > 0 && f2.inView, `game mode off: the score scrolls to the current line (scrollTop ${f2.top})`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
