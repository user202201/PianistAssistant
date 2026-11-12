// Jianpu (numbered notation): off by default; when on, one line of digits under every staff (same height, under the notes), movable do (1 = tonic of the key).
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/fing-scale.musicxml', fs.readFileSync(D + 'fing-scale.musicxml')], ['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  // the conversion itself
  const conv = await page.evaluate(async () => { const m = await import('/PianistAssistant/src/jianpu.ts'); const P = (s, a, o) => ({ step: 'CDEFGAB'.indexOf(s), alter: a, octave: o });
    return { cMajor: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'C3'].map((n) => m.jianpuText(P(n[0], 0, +n[1]), 0)),
      gMajor: [m.jianpuText(P('G', 0, 4), 1), m.jianpuText(P('F', 1, 5), 1), m.jianpuText(P('F', 0, 5), 1), m.jianpuText(P('G', 0, 3), 1)],
      fMajor: [m.jianpuText(P('F', 0, 4), -1), m.jianpuText(P('B', -1, 4), -1), m.jianpuText(P('B', 0, 4), -1)],
      aMinor: [m.jianpuText(P('A', 0, 4), 0), m.jianpuText(P('C', 0, 5), 0), m.jianpuText(P('G', 1, 4), 0)],
      chord: (() => { const x = '<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><key><fifths>0</fifths></key></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note><note><rest/><duration>1</duration></note></measure></part></score-partwise>'; const out = m.addJianpu(x); return { n: (out.match(/<lyric/g) || []).length, text: (out.match(/<text[^>]*>([^<]*)<\/text>/) || [])[1] }; })() }; });
  ok(conv.cMajor.join(' ') === '1 2 3 4 5 6 7 1̇ 1̣', 'C major: 1 2 3 4 5 6 7, the octave above with a dot above, below with a dot below (' + conv.cMajor.join(' ') + ')');
  ok(conv.gMajor.join(' ') === '1 7 ♭7 1\u0323', 'G major (1 = G): G4 = 1, F#5 = 7, F5 = b7, G3 = 1 with a dot below (' + conv.gMajor.join(' ') + ')');
  ok(conv.fMajor[0] === '1' && conv.fMajor[1] === '4' && conv.fMajor[2] === '♯4', 'F major: F = 1, Bb = 4, B = #4 (' + conv.fMajor.join(' ') + ')');
  ok(conv.aMinor.join(' ') === '6 1̇ ♯5', 'A minor (no signature, 1 = C): A = 6, C5 = 1 with a dot above, G# = #5 (' + conv.aMinor.join(' ') + ')');
  ok(conv.chord.n === 1 && conv.chord.text === '3', 'a chord gets one digit (its highest note), tied-on notes and rests none (' + JSON.stringify(conv.chord) + ')');
  // on screen
  await page.evaluate(() => (location.hash = '#/score/fing-scale.musicxml')); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200);
  const count = () => page.evaluate(() => [...document.querySelectorAll('.osmd svg text')].filter((t) => /^[♯♭]*[1-7][̣̇]*$/.test(t.textContent.trim())).length);
  // the switch is in the settings, on the home screen as well as inside a score
  const pre = await count();
  await page.click('.controls button[title="设置"], .top button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#jianpu-opt input'), 'inside a score the Settings have the "numbered notation" switch');
  await page.click('#jianpu-opt input'); await page.waitForTimeout(2500);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).jianpu === true) && await count() - pre >= 8, 'switching it on in the Settings draws the digits at once');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.jianpu = false; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); }); await page.reload(); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1200);
  const base = await count(); // time signature and bar numbers are digits too
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}').jianpu !== true), 'off again (stored)');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1')); s.jianpu = true; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.controls .mainrow', { timeout: 20000 }); await page.waitForTimeout(1500);
  const n = await count();
  ok(n - base >= 8, `on: a digit under every note (${base} -> ${n} digits)`);
  const geo = await page.evaluate(() => { const ts = [...document.querySelectorAll('.osmd svg text')].filter((t) => /^[♯♭]*[1-7][̣̇]*$/.test(t.textContent.trim())); const ys = ts.map((t) => Math.round(t.getBoundingClientRect().top)); return { rows: [...new Set(ys)].length, first: ts[0] && ts[0].textContent }; });
  ok(geo.rows <= 2, `all digits of a line stand at the same height (${geo.rows} different heights)`);
  await page.screenshot({ path: D + 'jianpu.png' });
  // four hands: both parts get their line
  await page.evaluate(() => (location.hash = '#/duet/Ode_Primo.musicxml/Ode_Secondo.musicxml')); await page.reload(); await page.waitForSelector('.pane', { timeout: 20000 }); await page.waitForTimeout(2500);
  const per = await page.evaluate(() => [...document.querySelectorAll('.pane')].map((p) => [...p.querySelectorAll('svg text')].filter((t) => /^[♯♭]*[1-7][\u0307\u0323]*$/.test(t.textContent.trim())).length));
  ok(per.length === 2 && per.every((x) => x >= 8), `four hands: a line of digits in each part (${per.join(' / ')})`);
  await page.screenshot({ path: D + 'jianpu-duet.png' });
  await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('.top .logo'); await page.waitForTimeout(500);
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#jianpu-opt input'), 'the home screen Settings have it too (it is used when a score is opened)');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
