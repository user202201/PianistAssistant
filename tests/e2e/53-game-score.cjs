// Game mode, score mode: the scoring logic (windows, combo, accuracy, stars), the MIDI input (parsing + a pretend keyboard), the demo / score switch,
// the floating score window, and a whole round played with pretend key presses.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });

  // ---- 1. the scoring logic on its own
  const logic = await page.evaluate(async () => {
    const { GameScore, WINDOWS } = await import('/PianistAssistant/src/gamescore.ts');
    const ev = (sec, midi) => ({ sec, midi, dur: 1, dur0: 1, part: 0, staff: 0, step: 0, measure: 0, onset: 0, spw: 2, vel: 80 });
    const notes = [ev(1, 60), ev(2, 62), ev(3, 64), ev(4, 65), ev(5, 67)];
    const g = new GameScore(notes, 'normal', 1); const [pw, gw, ow] = WINDOWS.normal;
    const r = [];
    r.push(g.strike(60, 1 + pw / 2).kind);          // perfect
    r.push(g.strike(62, 2 + (pw + gw) / 2).kind);    // good (late)
    r.push(g.strike(64, 3 - (gw + ow) / 2).kind);    // early
    r.push(g.strike(99, 3.5).kind);                  // no such note: wrong key
    const missed = g.advance(4 + ow + 0.01).map((j) => j.kind); // 65 was never struck
    r.push(...missed);
    const combo = g.stats.combo;
    r.push(g.strike(67, 5 + ow + 0.2).kind);         // far too late for 67: wrong
    g.advance(99);
    const s = g.stats;
    // speed 0.5: the windows are in REAL seconds: 0.1 s of real time = 0.05 s of score time
    const slow = new GameScore([ev(1, 60)], 'normal', 0.5);
    const slowKind = slow.strike(60, 1 + 0.12 * 0.5).kind; // 0.12 real s: good, not perfect
    const easy = new GameScore([ev(1, 60)], 'easy', 1).strike(60, 1.1).kind; // 0.1 s: perfect when easy
    const hard = new GameScore([ev(1, 60)], 'hard', 1).strike(60, 1.1).kind; // 0.1 s: only "late" when hard
    // each note can be hit once
    const twice = new GameScore([ev(1, 60)], 'normal', 1); twice.strike(60, 1); const second = twice.strike(60, 1.01).kind;
    const full = new GameScore(notes, 'normal', 1); for (const n of notes) full.strike(n.midi, n.sec);
    return { r, combo, s, slowKind, easy, hard, second, fullStars: full.stars(), fullAcc: full.accuracy(true), finished: full.finished, noneStars: new GameScore(notes).stars() };
  });
  ok(logic.r.slice(0, 4).join() === 'perfect,good,early,wrong', `windows: ${logic.r.slice(0, 4).join(' ')}`);
  ok(logic.r[4] === 'miss' && logic.s.miss === 2 && logic.r[5] === 'wrong', `a note nobody struck is a Miss once its window is over, a key far off is a wrong key (${logic.r.slice(4).join(' ')})`);
  ok(logic.combo === 0 && logic.s.maxCombo === 3, `the combo runs up with hits and breaks at a miss / wrong key (max ${logic.s.maxCombo})`);
  ok(logic.slowKind === 'good' && logic.easy === 'perfect' && logic.hard === 'late', `windows are real time: slower playing does not make them longer (${logic.slowKind}); easy is wider (${logic.easy}), hard is narrower (${logic.hard})`);
  ok(logic.second === 'wrong', 'one key hits one note only');
  ok(logic.fullStars === 3 && logic.fullAcc === 1 && logic.finished && logic.noneStars === 0, 'all perfect = 3 stars, nothing played = 0 stars');
  ok(logic.s.score > 0 && logic.s.perfect === 1, `points are counted (${logic.s.score})`);

  // ---- 2. MIDI parsing
  const parsed = await page.evaluate(async () => { const { parseMidi } = await import('/PianistAssistant/src/midi.ts');
    return [parseMidi([0x90, 60, 100], 5), parseMidi([0x90, 60, 0], 6), parseMidi([0x80, 60, 40], 7), parseMidi([0xB0, 64, 127], 8), parseMidi([0x93, 72, 90], 9)]; });
  ok(parsed[0].type === 'on' && parsed[0].note === 60 && parsed[0].velocity === 100 && parsed[1].type === 'off' && parsed[2].type === 'off' && parsed[3] === null && parsed[4].note === 72 && parsed[4].type === 'on', 'MIDI messages: note on, note on with velocity 0 = off, note off, pedal ignored, any channel');

  // ---- 3. a pretend keyboard (Web MIDI) and a whole round
  await page.addInitScript(() => {
    const input = { name: 'Test Piano', onmidimessage: null };
    window.__midiIn = input;
    navigator.requestMIDIAccess = async () => ({ inputs: new Map([['1', input]]), onstatechange: null });
  });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.gameMode = true; s.gameView = true; s.gameScoring = false; s.gameLevel = 'easy'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => (location.hash = '#/score/dyn.musicxml')); await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => { const hud = document.querySelector('.gamehud'); return !hud || hud.hidden || getComputedStyle(hud).display === 'none'; }), 'demo mode: no score window');
  ok(await page.evaluate(() => [...document.querySelectorAll('.gamepanel .gmode .seg')].map((b) => b.innerText.trim()).join('|')) === '演示|计分', 'the panel has a Demo / Score switch');
  await page.click('.gamepanel .gmode .seg[data-gmode=score]'); await page.waitForTimeout(700);
  const hud0 = await page.evaluate(() => { const hud = document.querySelector('.gamehud'); const r = hud.getBoundingClientRect(); return { shown: !hud.hidden && r.width > 0, right: Math.round(window.innerWidth - r.right), status: hud.querySelector('.hudstatus').innerText.replace(/\s+/g, ' ').trim(), level: hud.querySelector('.hudlevel .on').innerText.trim() }; });
  ok(hud0.shown && hud0.right < 40, `score mode: a floating score window at the side (${hud0.right}px from the edge)`);
  ok(/已连接.*Test Piano/.test(hud0.status), `it asks the browser for MIDI and shows the piano (${hud0.status})`);
  ok(hud0.level === '轻松', 'the level starts easy (children)');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).gameScoring) === true, 'the switch is remembered');
  await page.screenshot({ path: D + 'game-score-idle.png' });

  // the app must not play the notes that you have to play
  await page.evaluate(() => { const p = window.__pianist.player; window.__started = 0; const i = p.inst; const o = i.start.bind(i); i.start = (e) => { window.__started++; return o(e); }; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(500);
  // helpers inside the page: wait for a score time, then press / release a key
  await page.evaluate(() => {
    window.__wait = (sec) => new Promise((res) => { const f = () => (window.__pianist.player.position() >= sec ? res() : requestAnimationFrame(f)); f(); });
    window.__key = (n, on = true) => window.__midiIn.onmidimessage({ data: [on ? 0x90 : 0x80, n, 90], timeStamp: performance.now() });
    window.__ev = window.__pianist.player.score.events.filter((e) => window.__pianist.player.isShown(e)).sort((a, b) => a.sec - b.sec);
  });
  await page.waitForTimeout(3600); // READY, GO, the notes fall in
  const n = await page.evaluate(async () => { const ev = window.__ev; const out = [];
    for (let i = 0; i < 3; i++) { await window.__wait(ev[i].sec); window.__key(ev[i].midi); await new Promise((r) => setTimeout(r, 60)); window.__key(ev[i].midi, false); out.push(ev[i].midi); }
    window.__key(23); // a key that belongs to no note
    return out; });
  const st1 = await page.evaluate(() => { const h2 = document.querySelector('.gamehud'); const num = (label) => { const c = [...h2.querySelectorAll('.hudcount')].find((x) => x.querySelector('span').innerText === label); return Number(c.querySelector('b').innerText); };
    return { score: Number(h2.querySelector('.hudscore').innerText), combo: Number(h2.querySelector('.hudcombo b').innerText), perfect: num('完美'), wrong: num('错键') }; });
  ok(st1.perfect >= 2 && st1.score > 150 && st1.wrong === 1, `three keys struck on time are judged (perfect ${st1.perfect}, score ${st1.score}), the stray key is a wrong key (${st1.wrong})`);
  await page.screenshot({ path: D + 'game-score-play.png' });
  ok(await page.evaluate(() => window.__started) === 0, 'the app does not play the notes you have to play (you play them on your piano)');
  // the next note is left out: after its window it is a miss
  await page.waitForTimeout(2600);
  const st2 = await page.evaluate(() => { const h2 = document.querySelector('.gamehud'); const num = (label) => { const c = [...h2.querySelectorAll('.hudcount')].find((x) => x.querySelector('span').innerText === label); return Number(c.querySelector('b').innerText); }; return { miss: num('漏掉'), combo: Number(h2.querySelector('.hudcombo b').innerText) }; });
  ok(st2.miss >= 1 && st2.combo === 0, `notes that were not played are misses and break the combo (${st2.miss} missed)`);
  // finish: the rest is missed, the result shows stars
  await page.evaluate(() => { const p = window.__pianist.player; p.seekStep(p.score.steps.length - 1); });
  await page.waitForTimeout(300);
  await page.click('button[title^=播放]').catch(() => {}); await page.waitForTimeout(200);
  await page.evaluate(() => window.__pianist.player.pause());
  // level buttons
  await page.click('.gamehud .hudlevel .seg >> nth=1'); ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).gameLevel) === 'normal', 'the level can be changed in the window and is remembered');
  // back to demo: the window is gone
  await page.click('.gamepanel .gmode .seg[data-gmode=demo]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const hud = document.querySelector('.gamehud'); return hud.hidden || getComputedStyle(hud).display === 'none'; }), 'back to Demo: the score window is gone');
  ok(await page.evaluate(() => window.__pianist.player.practiceMute) === false, 'and the app plays the notes again');
  // phone
  await page.click('.gamepanel .gmode .seg[data-gmode=score]'); await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(600);
  const ph = await page.evaluate(() => { const r = document.querySelector('.gamehud').getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= 391, noScroll: document.documentElement.scrollWidth <= 390, folded: document.querySelector('.gamehud').classList.contains('min') || r.height < 80 }; });
  ok(ph.inside && ph.noScroll, 'phone: the score window stays on the screen');
  await page.screenshot({ path: D + 'game-score-phone.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
