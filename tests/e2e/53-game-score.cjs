// Game mode, score mode: the scoring logic (windows, combo, accuracy, stars), the MIDI input (parsing + a pretend keyboard), the demo / score switch,
// the floating score window, and a whole round played with pretend key presses.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });

  // ---- 1. the scoring logic on its own
  const logic = await page.evaluate(async () => {
    const { GameScore, WINDOWS, isComboMilestone } = await import('/PianistAssistant/src/gamescore.ts');
    const miles = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 1000].map((n) => isComboMilestone(n)); const notMiles = [9, 11, 99, 201, 299, 301].map((n) => isComboMilestone(n));
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
    const easy = new GameScore([ev(1, 60)], 'easy', 1).strike(60, 1.14).kind; // 0.14 s: perfect when easy
    const hard = new GameScore([ev(1, 60)], 'hard', 1).strike(60, 1.14).kind; // 0.14 s: only "late" when hard
    // each note can be hit once
    const twice = new GameScore([ev(1, 60)], 'normal', 1); twice.strike(60, 1); const second = twice.strike(60, 1.01).kind;
    const full = new GameScore(notes, 'normal', 1); for (const n of notes) full.strike(n.midi, n.sec);
    // a part that is switched off is not the player's: its notes are neither judged nor counted
    const two = [{ ...ev(1, 60), part: 0 }, { ...ev(1, 48), part: 1 }, { ...ev(2, 62), part: 0 }, { ...ev(2, 50), part: 1 }];
    const pg = new GameScore(two, 'normal', 1, (e) => e.part === 0);
    const startTotal = pg.stats.total; pg.strike(60, 1);
    const pm = pg.advance(99).map((j) => j.kind);
    const partial = { startTotal, pm, total: pg.stats.total, miss: pg.stats.miss, perfect: pg.stats.perfect, stars: pg.stats.perfect, finished: pg.finished };
    return { miles, notMiles, partial, r, combo, s, slowKind, easy, hard, second, fullStars: full.stars(), fullAcc: full.accuracy(true), finished: full.finished, noneStars: new GameScore(notes).stars() };
  });
  ok(logic.r.slice(0, 4).join() === 'perfect,good,early,wrong', `windows: ${logic.r.slice(0, 4).join(' ')}`);
  ok(logic.r[4] === 'miss' && logic.s.miss === 2 && logic.r[5] === 'wrong', `a note nobody struck is a Miss once its window is over, a key far off is a wrong key (${logic.r.slice(4).join(' ')})`);
  ok(logic.combo === 0 && logic.s.maxCombo === 3, `the combo runs up with hits and breaks at a miss / wrong key (max ${logic.s.maxCombo})`);
  ok(logic.slowKind === 'good' && logic.easy === 'perfect' && logic.hard === 'late', `windows are real time: slower playing does not make them longer (${logic.slowKind}); easy is wider (${logic.easy}), hard is narrower (${logic.hard})`);
  ok(logic.partial.startTotal === 2 && logic.partial.miss === 1 && logic.partial.total === 2 && logic.partial.finished, `only the notes of the part you play are judged: the other part is no Miss (${JSON.stringify(logic.partial)})`);
  ok(logic.miles.join() === 'true,true,true,true,true,true,false,true,true,true,true' && logic.notMiles.every((x) => x === false), 'the combo banner continues past 200: 300, 400, 500 ... (every 100), not at other numbers');
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
  ok(await page.evaluate(() => { const hud = document.querySelector('.hudscorebox'); return !!hud && !hud.hidden && hud.getBoundingClientRect().width > 0; }), 'demo mode shows the score numbers too (an imaginary player), so the effects can be watched');
  ok(await page.evaluate(() => document.querySelector('.hudchip').hidden), 'but the piano button is only for score mode');
  ok(await page.evaluate(() => [...document.querySelectorAll('.gamepanel .gmode .seg')].map((b) => b.innerText.trim()).join('|')) === '演示|计分', 'the panel has a Demo / Score switch');
  await page.click('button[title^=播放]'); await page.waitForTimeout(8200); // READY, GO, then the imaginary player plays
  const demoScore = await page.evaluate(() => { return { score: Number(document.querySelector('.hudscore').innerText), acc: '' }; });
  const st = await page.evaluate(() => window.__gs());
  ok(st.perfect >= 8 && st.good + st.early + st.late + st.miss + st.wrong === 0, `the demo player is perfect by default (${st.perfect} perfect, no other kind)`);
  ok(demoScore.score > 100, `demo mode: the imaginary player scores (${demoScore.score}, ${demoScore.acc})`);
  await page.screenshot({ path: D + 'game-demo-score.png' });
  // with "mistakes in the demo" on, the imaginary player also slips (to watch those effects)
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameDemoMistakes = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.click('button[title^=播放]'); await page.waitForTimeout(12000);
  const st2 = await page.evaluate(() => window.__gs());
  ok(st2.good + st2.early + st2.late + st2.miss + st2.wrong >= 1, `with the setting on it makes mistakes too (${st2.good} good, ${st2.early + st2.late} early/late, ${st2.miss} missed, ${st2.wrong} wrong)`);
  // the judgement words can be switched off (a complex piece is not covered by them)
  const wordsAfter = async (on) => { await page.evaluate((on) => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameJudgeText = on; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); }, on);
    await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1200);
    await page.click('button[title^=播放]'); await page.evaluate(() => { window.__pmax = 0; setInterval(() => { window.__pmax = Math.max(window.__pmax, Number(document.querySelector('.gamepanel').dataset.popups || 0)); }, 30); }); await page.waitForTimeout(8000); const n = await page.evaluate(() => window.__pmax); await page.evaluate(() => window.__pianist.player.stop()); return n; };
  const withWords = await wordsAfter(true), withoutWords = await wordsAfter(false);
  ok(withWords > 0 && withoutWords === 0, `the words PERFECT / MISS ... can be switched off in the settings (${withWords} shown -> ${withoutWords})`);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameJudgeText = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.gameDemoMistakes = false; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.gamepanel:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.__pianist.player.stop()); await page.waitForTimeout(300);
  await page.click('.gamepanel .gmode .seg[data-gmode=score]'); await page.waitForTimeout(700);
  const hud0 = await page.evaluate(() => { const s = document.querySelector('.hudscorebox').getBoundingClientRect(), c = document.querySelector('.hudcombobox').getBoundingClientRect(), tb = document.querySelector('.gtilt').getBoundingClientRect(), m = document.querySelector('.gmode').getBoundingClientRect(), pn = document.querySelector('.gamepanel').getBoundingClientRect();
    return { scoreLeftOfBtn: s.right <= tb.left && tb.left - s.right < 30, sameRow: Math.abs((s.top + s.height / 2) - (tb.top + tb.height / 2)) < 4, sameHeight: Math.abs(s.height - tb.height) < 4, comboUnderSwitch: c.top >= m.bottom - 1 && Math.abs(c.left - m.left) < 4, inPanel: s.top >= pn.top && c.bottom <= pn.bottom, accuracy: !!document.querySelector('.hudline'), h: Math.round(c.height) }; });
  ok(hud0.scoreLeftOfBtn && hud0.sameRow && hud0.sameHeight, 'the total score sits next to the 3D button, as tall as it');
  ok(hud0.comboUnderSwitch && hud0.inPanel, 'the combo sits at the left, under the demo / score switch');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.hudcombo')).color) === 'rgb(143, 233, 255)', 'the combo is in the blue of the rest (not yellow)');
  ok(!hud0.accuracy, 'no accuracy during play (it is in the summary)');
  ok(await page.evaluate(() => ['.hudscorebox', '.hudcombobox'].every((q) => { const c = getComputedStyle(document.querySelector(q)); return c.backgroundColor === 'rgba(0, 0, 0, 0)' && c.boxShadow === 'none'; })), 'no background behind the numbers');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => !document.querySelector('.gamesetup').hidden) === false, 'a connected piano: the setup card does not pop up by itself');
  await page.click('.hudchip'); await page.waitForTimeout(200);
  const su = await page.evaluate(() => { const c = document.querySelector('.gamesetup'); return { open: !c.hidden, status: c.querySelector('.hudstatus').innerText.replace(/\s+/g, ' ').trim(), level: c.querySelector('.hudlevel .on').innerText.trim(), dot: document.querySelector('.hudchip').classList.contains('connected') }; });
  ok(su.open && /已连接.*Test Piano/.test(su.status) && su.dot, `the piano button opens a small card with the connection (${su.status})`);
  ok(su.level === '轻松', 'the level starts easy (children)');
  const hid = await page.evaluate(() => { const m = document.querySelector('.gamesetup .hudmore').getBoundingClientRect(); return { h: Math.round(m.height), hasHandle: !!document.querySelector('.gamesetup .hudmorehandle') }; });
  ok(hid.h === 0 && hid.hasHandle, 'the latency compensation is hidden behind a handle at the bottom edge of the card');
  await page.click('.gamesetup .hudmorehandle'); await page.waitForTimeout(450);
  const vis = await page.evaluate(() => { const r = document.querySelector('.gamesetup .hudlat').getBoundingClientRect(), c = document.querySelector('.gamesetup').getBoundingClientRect(); return { h: Math.round(r.height), inside: r.bottom <= c.bottom + 1 && r.right <= c.right + 1 }; });
  ok(vis.h > 30 && vis.inside, 'pulling / tapping the handle shows it, fully inside the card');
  await page.click('.gamesetup .hudlat .hudbtn >> nth=1'); await page.click('.gamesetup .hudlat .hudbtn >> nth=1');
  const lat = await page.evaluate(() => ({ shown: document.querySelector('.gamesetup .hudlat b').innerText, saved: JSON.parse(localStorage.getItem('pianist.settings.v1')).gameLatency }));
  ok(lat.saved === 20 && /20/.test(lat.shown), `latency compensation: + + = ${lat.shown}, remembered`);
  await page.click('.gamesetup .hudlat .hudbtn >> nth=0'); await page.click('.gamesetup .hudlat .hudbtn >> nth=0');
  await page.click('.gamesetup .hudmorehandle'); await page.waitForTimeout(400);
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
  await page.evaluate(() => { window.__bn = 0; new MutationObserver(() => {}); const p = document.querySelector('.gamepanel'); const t = setInterval(() => { window.__bn = Math.max(window.__bn, Number(p.dataset.banners || 0)); }, 30); window.__bt = t; });
  const n = await page.evaluate(async () => { const ev = window.__ev; const out = [];
    for (let i = 0; i < 10; i++) { await window.__wait(ev[i].sec); window.__key(ev[i].midi); await new Promise((r) => setTimeout(r, 60)); window.__key(ev[i].midi, false); out.push(ev[i].midi); }
    window.__key(23); window.__key(23, false); window.__key(23); // two keys that belong to no note, at the same place
    const opac = () => Number(getComputedStyle(document.querySelector('.hudcombo')).opacity);
    await new Promise((r) => setTimeout(r, 130)); window.__opMid = opac(); window.__bits = Number(document.querySelector('.gamepanel').dataset.bits); window.__comboTxt = document.querySelector('.hudcombo b').innerText;
    await new Promise((r) => setTimeout(r, 300)); window.__words = Number(document.querySelector('.gamepanel').dataset.popups); await new Promise((r) => setTimeout(r, 450)); window.__opEnd = opac();
    return out; });
  const st1 = await page.evaluate(() => { return { score: Number(document.querySelector('.hudscore').innerText), combo: document.querySelector('.hudcombo').classList.contains('on') ? 1 : 0, mid: window.__opMid, bits: window.__bits, end: window.__opEnd, txt: window.__comboTxt }; });
  ok(st1.bits > 10 && st1.end === 0 && /^\d+$/.test(st1.txt) && Number(st1.txt) >= 9, `when the run breaks the combo number bursts into pieces that fly apart (${st1.bits} pieces after 130 ms) and the number is gone at the end (opacity ${st1.end})`);
  const hNow = await page.evaluate(() => Math.round(document.querySelector('.hudcombobox').getBoundingClientRect().height));
  ok(hNow === hud0.h, `the score window keeps its size while the combo comes and goes (${hud0.h} -> ${hNow}px)`);
  ok(st1.score > 800 && st1.combo === 0, `ten keys struck on time are scored (${st1.score}); the stray keys broke the combo`);
  ok(await page.evaluate(() => window.__words) <= 1, 'a new word makes the older one fade out at once: one word at a time, never two on top of each other');
  ok(await page.evaluate(() => window.__bn) >= 1, 'a run of 10 hits sets off the combo banner');
  await page.screenshot({ path: D + 'game-score-play.png' });
  ok(await page.evaluate(() => window.__started) === 0, 'the app does not play the notes you have to play (you play them on your piano)');
  // the next note is left out: after its window it is a miss
  await page.waitForTimeout(2600);
  // the round ends: the rest is missed and the summary appears
  await page.evaluate(() => { const p = window.__pianist.player; p.pause(); p.paused = p.score.duration; });
  await page.waitForTimeout(500);
  const rs = await page.evaluate(() => { const c = document.querySelector('.gameresult'); const n = (l) => Number([...c.querySelectorAll('.hudcount')].find((x) => x.querySelector('span').innerText === l).querySelector('b').innerText); const r = c.getBoundingClientRect();
    return { open: !c.hidden, stars: c.querySelector('.hudstars').innerText, perfect: n('完美'), wrong: n('错键'), miss: n('漏掉'), centred: Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 3 }; });
  ok(rs.open && rs.perfect >= 9 && rs.wrong === 2 && rs.miss >= 1 && rs.centred, `at the end the summary shows: stars ${rs.stars}, ${rs.perfect} perfect, ${rs.wrong} wrong key, ${rs.miss} missed`);
  await page.screenshot({ path: D + 'game-score-result.png' });
  await page.click('.gameresult .hudbtn:not(.primary)'); ok(await page.evaluate(() => document.querySelector('.gameresult').hidden), 'the summary can be closed');
  // level buttons
  await page.click('.hudchip'); await page.click('.gamesetup .hudlevel .seg >> nth=1'); ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).gameLevel) === 'normal', 'the level can be changed in the window and is remembered');
  // back to demo: the window is gone
  await page.click('.gamepanel .gmode .seg[data-gmode=demo]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector('.hudchip').hidden && !document.querySelector('.hudscorebox').hidden), 'back to Demo: the piano button is gone, the numbers stay');
  ok(await page.evaluate(() => window.__pianist.player.practiceMute) === false, 'and the app plays the notes again');
  // phone
  await page.click('.gamepanel .gmode .seg[data-gmode=score]'); await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(600);
  const ph = await page.evaluate(() => { const r = document.querySelector('.hudscorebox').getBoundingClientRect(), c = document.querySelector('.hudchip').getBoundingClientRect(), m = document.querySelector('.gmode').getBoundingClientRect(), tb = document.querySelector('.gtilt').getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= 391 && r.right <= tb.left, noScroll: document.documentElement.scrollWidth <= 390, noOverlap: c.left >= m.right - 1 }; });
  ok(ph.inside && ph.noScroll && ph.noOverlap, 'phone: the numbers and the piano button stay on the screen and do not overlap the switch');
  await page.screenshot({ path: D + 'game-score-phone.png' });
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
