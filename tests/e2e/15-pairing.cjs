const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const one = fs.readFileSync(D + 'single.musicxml');
(async () => {
  const store = new Map([['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['scores/foo.musicxml', one], ['scores/bar.musicxml', one]]);
  const { browser, page, puts } = await h.start(store, { context: IPAD });
  page.on('dialog', d => d.accept());
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.grid:not(.wide) .card .open')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const pairsJson = () => store.has('config/pairs.json') ? JSON.parse(store.get('config/pairs.json').toString()).pairs : null;
  await page.waitForSelector('.suggest .banner');

  // ---- 1. the app notices the two files belong together, and only asks
  let sug = await page.textContent('.suggest');
  ok(sug.includes('Ode') && sug.includes('Ode_Primo') && sug.includes('Ode_Secondo') && sug.includes('A（上）'), `suggestion banner: ${sug.replace(/\s+/g, ' ').slice(0, 80)}…`);
  ok(pairsJson() === null && (await cards()).length >= 4, 'nothing is merged until you confirm (4 separate cards)');
  await page.screenshot({ path: D + 'pair-suggest.png' });
  await page.click('.suggest button.primary'); await page.waitForFunction(() => !document.querySelector('.suggest .banner'));
  const pj = pairsJson();
  ok(pj && pj.length === 1 && pj[0].a === 'Ode_Primo.musicxml' && pj[0].b === 'Ode_Secondo.musicxml' && pj[0].name === 'Ode', `pair saved in the private repo: ${JSON.stringify(pj)}`);
  const c1 = await cards(); console.log('cards:', JSON.stringify(c1));
  ok(c1.some(t => t.includes('四手') && t.includes('Ode')) && c1.some(t => t.startsWith('Ode_Primo')) && c1.some(t => t.startsWith('Ode_Secondo')), 'the list shows the four-hand card AND still the two original scores');
  await page.screenshot({ path: D + 'pair-home.png' });

  // ---- 2. open it: two screens, one clock
  await page.click('.card.pair .open'); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(1200);
  ok(page.url().includes('#/duet/') && await page.locator('.pane').count() === 2, 'opens as split screen');
  const info = await page.evaluate(() => { const { score, views, player } = window.__pianist; const by = [0, 0]; score.events.forEach(e => by[e.part]++); return { parts: score.parts, by, heads: [...document.querySelectorAll('.panehead')].map(h => h.textContent.replace(/\s+/g, ' ').trim()), steps: score.steps.length, own: views.map(v => v.steps.length), title: document.querySelector('.top h1').textContent }; });
  console.log(JSON.stringify(info));
  ok(info.by.join() === '38,64' && info.title === 'Ode', `both files are in the one player: A ${info.by[0]} notes, B ${info.by[1]} notes`);
  ok(info.heads[0].startsWith('A · Primo') && info.heads[1].startsWith('B · Secondo') && info.heads.every(x => x.includes('右手') && x.includes('左手')), 'each screen has its own sound / right / left controls');
  const sync = await page.evaluate(() => { const { player, score, views } = window.__pianist; let bad = 0; for (let i = 0; i < score.steps.length; i++) { player.seekStep(i); const sec = score.steps[i].sec; views.forEach(v => { let w = 0; v.steps.forEach((s, j) => { if (s.sec <= sec + 1e-4) w = j; }); if (v.cur !== w) bad++; }); } return { n: score.steps.length, bad }; });
  ok(sync.bad === 0 && info.own[0] !== info.own[1], `both screens follow the shared clock for all ${sync.n} positions`);
  await page.evaluate(() => window.__pianist.player.seekStep(0));
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const i = p.inst; const o = i.start.bind(i); i.start = e => { window.__rec.push(e.note); return o(e); }; });
  await page.click('button[title^=播放]'); await page.waitForTimeout(2200);
  const mid = await page.evaluate(() => ({ cur: window.__pianist.views.map(v => v.cur), n: window.__rec.length, low: window.__rec.some(n => n < 50), high: window.__rec.some(n => n >= 62) }));
  ok(mid.cur.every(c => c > 2) && mid.n >= 10 && mid.low && mid.high, `playing: both screens move (${mid.cur.join(' / ')}) and both players are heard (${mid.n} notes: B's bass + A's melody)`);
  await page.click('button[title^=播放]');
  await page.locator('.pane[data-part="0"] .pname').click();
  ok(await page.evaluate(() => window.__pianist.player.partOn.join()) === 'false,true', 'A can be muted: you play it, B accompanies');
  await page.locator('.pane[data-part="0"] .pname').click();
  await page.screenshot({ path: D + 'pair-player.png' });
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.waitForFunction(() => [...document.querySelectorAll('.home section')].some(s => s.textContent.includes('最近打开') && !s.hidden && s.textContent.includes('Ode')), null, { timeout: 8000 }).catch(() => {});
  ok((await page.evaluate(() => [...document.querySelectorAll('.home section')].find(s => s.textContent.includes('最近打开'))?.textContent ?? '')).includes('Ode'), 'the piece shows up under "最近打开"');

  // ---- 3. swap, dismiss, un-link
  await page.click('.card.pair button[title=更多]'); await page.click('dialog button:has-text("交换")'); await page.waitForTimeout(1200);
  ok(pairsJson()[0].a === 'Ode_Secondo.musicxml', 'swap A / B is saved');
  await page.click('.card.pair button[title=更多]'); await page.click('dialog button:has-text("取消关联")'); await page.waitForSelector('.suggest .banner');
  ok(pairsJson().length === 0 && (await cards()).some(t => t === 'Ode_Primo'), 'un-linking gives the two files back (and the app suggests them again)');
  await page.click('.suggest button:text-is("不是")'); await page.waitForFunction(() => !document.querySelector('.suggest .banner'));
  await page.reload(); await page.waitForSelector('.home'); await page.waitForTimeout(700);
  ok(await page.locator('.suggest .banner').count() === 0, '"不是" is remembered (no more suggestion for this pair)');

  // ---- 4. manual association (names give no hint)
  await page.locator('.card:has-text("foo") button[title=更多]').click(); await page.click('dialog button:has-text("设为四手联弹")');
  await page.waitForSelector('dialog select');
  await page.selectOption('dialog select >> nth=1', 'bar.musicxml'); await page.fill('dialog input[type=text]', 'My duet');
  await page.click('dialog button.primary'); await page.waitForSelector('.card.pair');
  console.log('manual:', JSON.stringify(pairsJson()));
  ok(pairsJson().length === 1 && pairsJson()[0].name === 'My duet' && pairsJson()[0].a === 'foo.musicxml' && pairsJson()[0].b === 'bar.musicxml', 'manual association: A = foo, B = bar, name "My duet"');

  // ---- 5. upload two files at once -> "is this a four-hand piece?"
  await page.setInputFiles('input[type=file]', [{ name: 'Song B.musicxml', mimeType: 'text/xml', buffer: one }, { name: 'Song A.musicxml', mimeType: 'text/xml', buffer: one }]);
  await page.waitForSelector('dialog h2:has-text("四手联弹吗")', { timeout: 15000 });
  const pre = await page.evaluate(() => ({ a: document.querySelectorAll('dialog select')[0].value, b: document.querySelectorAll('dialog select')[1].value, name: document.querySelector('dialog input[type=text]').value }));
  ok(pre.a === 'Song A.musicxml' && pre.b === 'Song B.musicxml' && pre.name === 'Song', `upload of 2 files asks, with A/B taken from the names even though B was picked first: ${JSON.stringify(pre)}`);
  await page.click('dialog button.primary'); await page.waitForFunction(() => [...document.querySelectorAll('.card.pair')].length === 2);
  ok(pairsJson().some(p => p.name === 'Song' && p.a === 'Song A.musicxml'), 'confirmed: saved as a pair');

  // ---- 6. "not a four-hand piece" keeps the files separate
  await page.setInputFiles('input[type=file]', [{ name: 'x1.musicxml', mimeType: 'text/xml', buffer: one }, { name: 'x2.musicxml', mimeType: 'text/xml', buffer: one }]);
  await page.waitForSelector('dialog h2:has-text("四手联弹吗")', { timeout: 15000 });
  await page.click('dialog button:has-text("不是，分开保存")'); await page.waitForTimeout(500);
  ok(pairsJson().length === 2 && (await cards()).includes('x1') && (await cards()).includes('x2'), '"不是，分开保存": two separate scores, no pair');

  // ---- 7. delete a pair removes both files and the record
  await page.locator('.card.pair:has-text("Song") button[title=更多]').click(); await page.click('dialog button:has-text("删除这首四手联弹")'); await page.waitForFunction(() => ![...document.querySelectorAll('.card.pair')].some(c => c.textContent.includes('Song')));
  ok(!store.has('scores/Song A.musicxml') && !store.has('scores/Song B.musicxml') && pairsJson().length === 1, 'deleting a pair removes both files and the record');
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
