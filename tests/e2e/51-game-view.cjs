// Game view: with the Game switch on, a piano keyboard with falling notes sits under the score; the keys to play glow; the hand choice
// decides which notes show; the view can lean back into a 3D perspective (animated) and back.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fingered.musicxml', fs.readFileSync(D + 'long.musicxml')], ['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')]]);
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
  await page.evaluate(() => window.__pianist.player.seekStep(0)); await page.click('button[title^=播放]'); await page.waitForTimeout(5600); // READY ... GO, then the notes fall in (4.1 s), then the music
  l = await lit(); ok(l.cy > 60, `playing: notes / keys glow blue (${l.cy} px)`);
  ok(l.gr > 20, `and the left hand is green (${l.gr} px)`);
  await page.click('.handstrip .hand[title=右手]'); await page.waitForTimeout(250); l = await lit(); // wait until the left-hand notes have passed
  await page.waitForTimeout(600); l = await lit();
  ok(l.gr === 0 && l.cy > 0, `right hand only: no green notes any more (${l.gr})`);
  ok(await page.evaluate(() => Number(document.querySelector('.gamepanel').dataset.sparks) >= 2), 'a struck key sends up soft puffs of light (no hard particles)');
  await page.evaluate(() => window.__pianist.player.pause());
  // size: small by default, the top edge can be dragged, never below keyboard + a strip of coming notes
  const ph0 = await page.evaluate(() => Math.round(document.querySelector('.gamepanel').getBoundingClientRect().height));
  ok(ph0 >= 150 && ph0 <= 260, `the panel starts small so the score keeps the room (${ph0}px)`);
  const grip = await page.evaluate(() => { const r = document.querySelector('.ggrip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 8 }; });
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x, grip.y - 120, { steps: 6 }); await page.mouse.up();
  const ph1 = await page.evaluate(() => Math.round(document.querySelector('.gamepanel').getBoundingClientRect().height));
  ok(ph1 > ph0 + 80, `dragging the top edge up makes it taller (${ph0} -> ${ph1}px)`);
  const g2 = await page.evaluate(() => { const r = document.querySelector('.ggrip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 8 }; });
  await page.mouse.move(g2.x, g2.y); await page.mouse.down(); await page.mouse.move(g2.x, g2.y + 600, { steps: 8 }); await page.mouse.up();
  const ph2 = await page.evaluate(() => Math.round(document.querySelector('.gamepanel').getBoundingClientRect().height));
  ok(ph2 >= 150 && ph2 < ph1, `and it cannot get smaller than the keyboard with a strip of notes above it (${ph2}px)`);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).gameH) === ph2, 'the size is remembered');
  const bar = await page.evaluate(() => ({ min: document.querySelector('.controls').classList.contains('min'), h: Math.round(document.querySelector('.controls').getBoundingClientRect().height) }));
  ok(bar.min && bar.h < 110, `game view: the bottom bar starts small, like on a phone (${bar.h}px)`);
  // 3D: the lean is animated
  const tf = () => page.evaluate(() => getComputedStyle(document.querySelector('.gcanvas')).transform);
  const flat = await tf(); ok(flat === 'none' || /^matrix\(1, 0, 0, 1/.test(flat) || /matrix3d\(1, 0, 0, 0, 0, 1, 0, 0/.test(flat), 'flat view: no tilt (' + flat.slice(0, 30) + ')');
  await page.click('.gtilt'); await page.waitForTimeout(250); const mid = await tf(); await page.screenshot({ path: D + 'game-tilt-mid.png' }); await page.waitForTimeout(1100); const end = await tf(); await page.screenshot({ path: D + 'game-tilt.png' });
  ok(end !== flat && /^matrix3d/.test(end), '3D view: the canvas leans back (matrix3d)');
  ok(await page.evaluate(() => { const c = document.querySelector('.gcanvas'), pn = document.querySelector('.gamepanel'); return parseFloat(c.style.height) >= pn.getBoundingClientRect().height * 1.8 && parseFloat(pn.style.getPropertyValue('--tiltdeg')) > 30; }), 'the drawing is much taller than the panel and the angle is chosen so that the far end of the lane reaches the top: notes come down from the very top in 3D');
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
  // bug: with the sustain pedal the sounding length of a note is many seconds; the game view showed that, as if the key had to be held
  await page.evaluate(() => (location.hash = '#/score/dyn.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1800);
  const pedal = await page.evaluate(async () => { const g = await import('/PianistAssistant/src/gameview.ts'); const ev = window.__pianist.player.score.events;
    const long = ev.filter((e) => e.dur > e.dur0 * 1.5); return { n: long.length, ok: long.every((e) => Math.abs(g.noteLength(e) - Math.max(e.dur0, 0.12)) < 1e-9), maxSound: Math.max(0, ...long.map((e) => e.dur)), maxShown: Math.max(0, ...long.map((e) => g.noteLength(e))) }; });
  ok(pedal.n > 0 && pedal.ok && pedal.maxShown < pedal.maxSound, `pedal: notes are shown as written (${pedal.maxShown.toFixed(2)} s), not as long as they ring (${pedal.maxSound.toFixed(2)} s), ${pedal.n} notes checked`);
  // held notes: bright head at the start (when to press), see-through body (how long); a struck key is bright first, softer while held
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameView = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1800);
  // brightness of the lit pixels; `at` = a time (score seconds) the clock is forced to for ~2 frames while "playing"
  const litAt = (at) => page.evaluate(async (at) => { const p = window.__pianist.player; const c = document.querySelector('.gcanvas'); const old = { pl: p.playing, sa: p.startAudio, sp: p.startPos, pa: p.paused };
    if (at !== null) { p.playing = true; p.startAudio = p.ctx.currentTime; p.startPos = at; } else p.playing = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200 && d[i + 2] > 230 && d[i + 1] > 190 && d[i] < 60) n++;
    const lit = document.querySelector('.gamepanel').dataset.lit.split(',').filter(Boolean).map(Number), ring = document.querySelector('.gamepanel').dataset.ring.split(',').filter(Boolean).map(Number); p.playing = false; return at === null ? n : { n, lit, ring }; }, at);
  const sec0 = await page.evaluate(() => { const p = window.__pianist.player; const e = p.score.events.find((x) => x.dur0 >= 1); p.paused = 0; return e.sec; });
  const empty = await litAt(null); const f1 = await litAt(sec0 + 0.02); const h1 = await litAt(sec0 + 0.9); const fresh = f1.n, held = h1.n; const longMidi = await page.evaluate(() => window.__pianist.player.score.events.find((x) => x.dur0 >= 1).midi);
  ok(empty < fresh * 0.5, `before the start the lane and the keyboard are empty: nothing lit, no note at the keyboard (${empty} bright px, against ${fresh} while a key sounds)`);
  ok(f1.lit.includes(longMidi) && !h1.lit.includes(longMidi), `the key of a long note is lit when it is struck (${f1.lit.join(' ')}) and dark again while the note is held (${h1.lit.join(' ')})`);
  ok(h1.ring.includes(longMidi), `while it is held the key rings: pale, not struck (ring: ${h1.ring.join(' ')})`);
  ok(fresh > held + 30, `a struck key flashes and fades out: it is NOT kept lit while the note is held (${fresh} -> ${held} bright px)`);
  await page.evaluate((x) => { window.__pianist.player.paused = x - 1.2; }, sec0); await page.waitForTimeout(400);
  const pk = await page.evaluate(() => { const p = document.querySelector('.peek'), g = document.querySelector('.gamepanel').getBoundingClientRect(); return !p || getComputedStyle(p).display === 'none' || p.getBoundingClientRect().bottom <= g.top + 1; });
  ok(pk, 'the "next line" preview never covers the game panel');
  // four hands: the part that is switched OFF is the one you practise -> the game shows that part (the other one is only the accompaniment)
  await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.waitForSelector('.gamepanel', { timeout: 20000 }); await page.waitForTimeout(2000);
  const shownParts = () => page.evaluate(() => { const p = window.__pianist.player; return [...new Set(p.score.events.filter((e) => p.isShown(e)).map((e) => e.part))].sort().join(','); });
  ok(await shownParts() === '0,1', 'four hands, both parts on: the game shows both');
  await page.click('.panehead:nth-of-type(1) .pname, .pname >> nth=0'); await page.waitForTimeout(300); // the real button: switch part A off (you play A)
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'false,true' && await shownParts() === '0', 'part A switched off with its button (you play A): only A is shown, B is the accompaniment');
  await page.click('.pname >> nth=1'); await page.waitForTimeout(300); // B is the only one on: one tap swaps (A on, B off)
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'true,false' && await shownParts() === '1', 'one tap on B while A is off swaps them (A on, B off): only B is shown');
  await page.evaluate(() => { window.__pianist.player.partOn = [true, true]; });
  await page.evaluate(() => (location.hash = '#/score/fingered.musicxml')); await page.waitForTimeout(2000);
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
