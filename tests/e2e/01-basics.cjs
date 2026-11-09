const { chromium } = require('playwright');
const fs = require('fs');
const D = process.env.D;
const files = new Map(); // name -> Buffer
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 800 } });
  await page.addInitScript(() => { try { const k = 'pianist.settings.v1'; const x = JSON.parse(localStorage.getItem(k) || '{}'); if (x.countIn === undefined) { x.countIn = false; localStorage.setItem(k, JSON.stringify(x)); } } catch {} });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

  // sample hosts unreachable -> force fallback synth
  await page.route(/github\.io|jsdelivr|gleitz/, r => r.abort());
  await page.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const auth = req.headers()['authorization'];
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (o, s = 200) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(o) });
    if (auth !== 'Bearer good') return json({ message: 'Bad credentials' }, 401);
    const p = u.pathname;
    if (p === '/repos/user202201/PianistScores') return json({ permissions: { push: true }, default_branch: 'main', private: true });
    if (p === '/user') return json({ login: 'tester' });
    const m = p.match(/^\/repos\/user202201\/PianistScores\/contents\/scores(?:\/(.+))?$/);
    if (m) {
      const name = m[1] && decodeURIComponent(m[1]);
      if (!name) return files.size ? json([...files].map(([n, b]) => ({ name: n, size: b.length, type: 'file' }))) : json({}, 404);
      if (req.method() === 'GET') {
        if (!files.has(name)) return json({}, 404);
        if ((req.headers()['accept'] || '').includes('raw')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: files.get(name) });
        return json({ sha: 'abc' });
      }
      if (req.method() === 'PUT') { files.set(name, Buffer.from(JSON.parse(req.postData()).content, 'base64')); return json({}, 201); }
      if (req.method() === 'DELETE') { files.delete(name); return json({}); }
    }
    return json({ message: 'nf' }, 404);
  });

  await page.goto('http://localhost:5173/');
  ok(await page.locator('.login').isVisible(), 'login page shown when not authenticated');
  await page.fill('input[type=password]', 'bad'); await page.click('button.primary');
  await page.waitForSelector('.error:not(:empty)');
  ok((await page.textContent('.error')).includes('无效'), 'bad token rejected: ' + await page.textContent('.error'));
  await page.fill('input[type=password]', 'good'); await page.click('button.primary');
  await page.waitForSelector('.home');
  ok(true, 'login with good token -> home');

  await page.setInputFiles('input[type=file]', [D + 'single.musicxml', D + 'four.musicxml']);
  // two scores at once: the app asks whether they are one four-hand piece -> no, keep them apart
  await page.click('dialog button:has-text("不是，分开保存")', { timeout: 15000 });
  await page.waitForSelector('.card');
  await page.waitForFunction(() => document.querySelectorAll('#app .card').length >= 2);
  ok(files.size === 2, 'uploaded 2 scores to (mock) repo: ' + [...files.keys()]);
  await page.screenshot({ path: D + 'home.png' });

  // ---- single piece
  await page.click('.card .open >> text=single');
  await page.waitForSelector('.controls .big');
  const info = await page.evaluate(() => { const s = window.__pianist.score; return { ev: s.events.length, steps: s.steps.length, dur: s.duration, bpm: s.baseBpm, parts: s.parts, mc: s.measureCount, meas: s.steps.map(x => x.measure).join(',') }; });
  console.log(JSON.stringify(info));
  ok(info.bpm === 120, 'tempo 120 parsed');
  ok(info.ev === 22, `repeat expanded & tied note merged: ${info.ev} events (expect 22)`);
  ok(Math.abs(info.dur - 16) < 0.01, `duration ${info.dur}s (expect 16)`);
  await page.screenshot({ path: D + 'player.png' });

  // record scheduled notes
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const inst = p.inst; const o = inst.start.bind(inst); inst.start = e => { window.__rec.push({ n: e.note, d: e.duration }); return o(e); }; });
  await page.click('button[title^=播放]');
  await page.waitForTimeout(2600);
  let st = await page.evaluate(() => ({ m: window.__pianist.player.measureIndex, playing: window.__pianist.player.playing, rec: window.__rec.length }));
  ok(st.playing && st.m === 1, `playing, cursor advanced to measure index ${st.m} after 2.6s`);
  ok(st.rec >= 7, `notes scheduled so far: ${st.rec}`);
  await page.click('button[title^=播放]'); // pause
  st = await page.evaluate(() => window.__pianist.player.playing);
  ok(st === false, 'pause works');

  // right hand only
  await page.click('button.seg >> text=右手'); await page.click('button[title="回到开头"]');
  await page.evaluate(() => { window.__rec.length = 0; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(1200);
  let notes = await page.evaluate(() => window.__rec.map(r => r.n));
  console.log('RH notes', notes);
  ok(notes.length > 0 && notes.every(n => n >= 60), 'right hand only: no bass notes');
  await page.click('button[title^=播放]');
  await page.click('button.seg >> text=左手'); await page.click('button[title="回到开头"]');
  await page.evaluate(() => { window.__rec.length = 0; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(1200);
  notes = await page.evaluate(() => window.__rec.map(r => r.n));
  console.log('LH notes', notes);
  ok(notes.length > 0 && notes.every(n => n < 60), 'left hand only: bass notes only');
  await page.click('button[title^=播放]');
  await page.click('button.seg >> text=双手');

  // speed 50% -> after 2.6s should still be measure 0
  await page.click('button[title="回到开头"]');
  await page.evaluate(() => window.__pianist.player.setSpeed(0.5));
  await page.click('button[title^=播放]'); await page.waitForTimeout(2600);
  st = await page.evaluate(() => window.__pianist.player.measureIndex);
  ok(st === 0, `50% speed: still in measure index ${st} after 2.6s (full speed would be 1)`);
  await page.click('button[title^=播放]');

  // loop measure 2..2 (index 1)
  await page.evaluate(() => window.__pianist.player.setSpeed(1));
  await page.click('button[title="回到开头"]');
  await page.click('button >> text=练习');
  await page.fill('.panel input[type=number] >> nth=0', '2'); await page.fill('.panel input[type=number] >> nth=1', '2');
  await page.locator('.panel .line:has(input[type=number])').first().locator('input[type=checkbox]').check();
  await page.screenshot({ path: D + 'practice.png' });
  await page.click('button >> text=练习');
  await page.evaluate(() => { window.__rec.length = 0; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(5200);
  st = await page.evaluate(() => ({ m: window.__pianist.player.measureIndex, rec: window.__rec.length, playing: window.__pianist.player.playing }));
  ok(st.playing && st.m === 1, `loop on measure 2: cursor still on index ${st.m}`);
  ok(st.rec >= 2 * 4, `loop repeated notes: ${st.rec} scheduled in 5.2s (>=8 means >2 passes)`);
  await page.click('button[title^=播放]');
  await page.screenshot({ path: D + 'loop.png' });

  // ---- four hands
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.click('.card .open >> text=four');
  await page.waitForSelector('.controls .big');
  ok((await page.locator('.panehead .pname').count()) === 2, 'four hands: Primo / Secondo each get their own screen with a sound switch');
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const inst = p.inst; const o = inst.start.bind(inst); inst.start = e => { window.__rec.push(e.note); return o(e); }; });
  await page.click('.panehead .pname >> text=Primo');
  await page.click('button[title^=播放]'); await page.waitForTimeout(1300);
  notes = await page.evaluate(() => window.__rec);
  console.log('Secondo-only notes', notes);
  ok(notes.length > 0 && notes.every(n => n <= 60), 'Primo muted -> only Secondo plays');
  await page.screenshot({ path: D + 'four.png' });

  // zoom keeps working
  if (await page.locator('.morebtn:visible').count()) await page.click('.morebtn'); await page.click('button[title=放大]');
  ok(true, 'zoom ok');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
  process.exit(fail ? 1 : 0);
})();
