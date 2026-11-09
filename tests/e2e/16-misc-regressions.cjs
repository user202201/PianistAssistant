const h = require('./harness.cjs'); const fs = require('fs'); const { execSync } = require('child_process'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const one = fs.readFileSync(D + 'single.musicxml');
const mxl = (inner) => execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile('/tmp/t.zip','w');z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path=\\"inner.xml\\"/></rootfiles></container>');z.writestr('inner.xml',open('${D}single.musicxml').read());z.close()" && cat /tmp/t.zip`, { encoding: 'buffer' });
(async () => {
  // =============== A. a slow score that is left before it finished must not leave its bars on other screens
  let store = new Map([['scores/a.musicxml', one], ['scores/b.musicxml', one]]);
  let r = await h.start(store, { context: IPAD, rawDelay: 1800 });
  let page = r.page; page.on('dialog', d => d.accept());
  await page.click('.card .open >> text=a'); await page.waitForTimeout(300);
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.waitForTimeout(3500);                       // the slow download of "a" finishes now
  const home = await page.evaluate(() => ({ controls: document.querySelectorAll('.controls').length, home: !!document.querySelector('.home'), model: document.querySelectorAll('.modelbox').length, hash: location.hash }));
  ok(home.controls === 0 && home.home && home.model === 0, 'went back while it was loading: the late score does NOT add its play bar to the home screen');
  await page.click('.card .open >> text=a'); await page.waitForTimeout(200); await page.evaluate(() => (location.hash = '#/score/b.musicxml'));
  await page.waitForSelector('.controls .mainrow', { timeout: 15000 }); await page.waitForTimeout(3500);
  const two = await page.evaluate(() => ({ bars: document.querySelectorAll('.controls').length, title: document.querySelector('.top h1')?.textContent }));
  ok(two.bars === 1 && two.title === 'b', `opened a, then b right away: exactly one play bar, and it is for b (${two.bars} bar, "${two.title}")`);
  await r.browser.close();

  // =============== B. settings, card menu, rename
  store = new Map([['scores/foo.musicxml', one], ['scores/bar.musicxml', one], ['scores/Ode_Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')]]);
  r = await h.start(store, { context: IPAD }); page = r.page; page.on('dialog', d => d.accept());
  await page.click('button[title=设置]'); await page.waitForSelector('dialog');
  ok(await page.locator('dialog input[type=range]').count() === 0 && !(await page.textContent('dialog')).includes('音量'), 'settings: no volume slider (the iPad\'s own volume is used)');
  await page.click('dialog button.primary');
  ok(await page.locator('.card button[title=删除]').count() === 0 && await page.locator('.card button[title=更多]').count() >= 2, 'cards have one ▾ button, no trash icon');
  await page.locator('.card:has-text("foo") button[title=更多]').click();
  const menu = await page.textContent('dialog');
  ok(menu.includes('重命名') && menu.includes('设为四手联弹') && menu.includes('删除这份乐谱'), 'the ▾ menu offers rename / set as four hands / delete');
  await page.click('dialog button:has-text("重命名")'); await page.waitForSelector('dialog input[type=text]');
  await page.fill('dialog input[type=text]', 'Renamed Song'); await page.click('dialog button.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.card .open')].some(e => e.textContent.trim() === 'Renamed Song'));
  ok(store.has('scores/Renamed Song.musicxml') && !store.has('scores/foo.musicxml') && store.get('scores/Renamed Song.musicxml').equals(one), 'rename: new file has the same content, old name is gone');
  await page.locator('.card:has-text("bar") button[title=更多]').click(); await page.click('dialog button:has-text("重命名")'); await page.fill('dialog input[type=text]', 'Renamed Song'); await page.click('dialog button.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('同名')));
  ok(store.has('scores/bar.musicxml'), 'renaming onto an existing name is refused (nothing overwritten)');
  await page.locator('.card:has-text("Renamed Song") button[title=更多]').click(); await page.click('dialog button:has-text("删除这份乐谱")');
  await page.waitForFunction(() => ![...document.querySelectorAll('.card .open')].some(e => e.textContent.trim() === 'Renamed Song'));
  ok(!store.has('scores/Renamed Song.musicxml'), 'delete from the ▾ menu works');
  await r.browser.close();

  // =============== C. upload failures explain themselves, retry transient errors, accept .zip
  store = new Map(); r = await h.start(store, { context: IPAD, putPlan: [403], putMessage: 'Resource not accessible by personal access token' }); page = r.page;
  await page.setInputFiles('input[type=file]', { name: 'x.musicxml', mimeType: 'text/xml', buffer: one });
  await page.waitForSelector('dialog h2:has-text("上传失败")', { timeout: 15000 });
  const msg = await page.textContent('dialog');
  ok(msg.includes('403') && msg.includes('Resource not accessible') && msg.includes('Contents') && msg.includes('复制错误信息'), `failed upload: a dialog shows GitHub's own reason + advice + copy button`);
  await page.click('dialog button.primary'); await r.browser.close();

  store = new Map(); r = await h.start(store, { context: IPAD, putPlan: [409, 409, 201], putMessage: 'is at abc but expected def' }); page = r.page;
  await page.setInputFiles('input[type=file]', { name: 'retry.musicxml', mimeType: 'text/xml', buffer: one });
  await page.waitForFunction(() => [...document.querySelectorAll('.card .open')].some(e => e.textContent.trim() === 'retry'), null, { timeout: 15000 });
  ok(store.has('scores/retry.musicxml') && r.puts.attempts === 3, `two conflicts (409) are retried automatically and the upload succeeds (${r.puts.attempts} attempts)`);
  await r.browser.close();

  store = new Map(); r = await h.start(store, { context: IPAD }); page = r.page;
  const z = mxl();
  await page.setInputFiles('input[type=file]', [{ name: 'Fur_Elise_Easy_Piano.mxl.zip', mimeType: 'application/zip', buffer: z }]);
  await page.waitForFunction(() => [...document.querySelectorAll('.card .open')].some(e => e.textContent.includes('Fur_Elise_Easy_Piano')), null, { timeout: 15000 });
  ok(store.has('scores/Fur_Elise_Easy_Piano.musicxml') && store.get('scores/Fur_Elise_Easy_Piano.musicxml').toString().includes('score-partwise'), '"x.mxl.zip" (what iPadOS makes of a downloaded .mxl) is accepted and stored as plain MusicXML');
  await page.setInputFiles('input[type=file]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]);
  await page.waitForSelector('dialog h2:has-text("上传失败")'); ok((await page.textContent('dialog')).includes('不支持的文件'), 'an unsupported file gets a clear message');
  await page.click('dialog button.primary');
  await page.setInputFiles('input[type=file]', [{ name: 'broken.mxl', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') }]);
  await page.waitForSelector('dialog h2:has-text("上传失败")'); ok((await page.textContent('dialog')).includes('不是有效的 MusicXML') && !store.has('scores/broken.musicxml'), 'a corrupt .mxl says so and nothing is stored');
  await page.click('dialog button.primary');
  await page.setInputFiles('input[type=file]', [{ name: 'junk.musicxml', mimeType: 'text/xml', buffer: Buffer.from('<html><body>login page</body></html>') }]);
  await page.waitForSelector('dialog h2:has-text("上传失败")'); ok((await page.textContent('dialog')).includes('不是 MusicXML') && !store.has('scores/junk.musicxml'), 'a .musicxml file that is not MusicXML (e.g. a saved web page) is refused, not stored');
  await page.click('dialog button.primary'); await r.browser.close();

  // =============== D. a four-hand piece made of two files (opens as split screen)
  store = new Map([['scores/欢乐颂示例 Primo.musicxml', fs.readFileSync(D + 'Ode_Primo.musicxml')], ['scores/欢乐颂示例 Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')],
    ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: '欢乐颂（四手联弹示例）', a: '欢乐颂示例 Primo.musicxml', b: '欢乐颂示例 Secondo.musicxml' }] }))]]);
  r = await h.start(store, { context: IPAD }); page = r.page;
  await page.waitForSelector('.card.pair', { timeout: 15000 });
  await page.click('.card.pair .open'); await page.waitForSelector('.pane', { timeout: 15000 }); await page.waitForTimeout(1000);
  ok(await page.locator('.pane').count() === 2, 'the pair opens as split screen right away');

  // =============== E. fingering on paired files: two independent scores, saved separately
  ok(await page.locator('.morebtn:visible').count() === 0, 'wide screen: no "more" button, the whole bar is in one row');
  const before = { a: store.get('scores/欢乐颂示例 Primo.musicxml').toString(), b: store.get('scores/欢乐颂示例 Secondo.musicxml').toString() };
  ok(await page.locator('button[title="显示 / 隐藏指法"]:not([disabled])').count() === 1, 'fingering tools are available for the paired piece');
  await page.click('button[title=指法选项]'); await page.click('.panel:not([hidden]) button.primary');
  await page.waitForSelector('.editbar:not([hidden])');
  const spot = async (g) => page.evaluate((g) => { const t = window.__pianist.tools.parts()[g]; const s = t.spots[2]; const r = t.host.getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y, midi: s.note.midi }; }, g);
  let p = await spot(1); await page.touchscreen.tap(p.x, p.y);
  await page.click('.editbar button.fnum >> text=4');
  p = await spot(0); await page.touchscreen.tap(p.x, p.y);
  await page.click('.editbar button.fnum >> text=2');
  ok(await page.evaluate(() => window.__pianist.tools.pending.size) === 2, 'edits on both screens are collected (one in A, one in B)');
  await page.click('.editbar button:has-text("保存")'); await page.waitForFunction(() => window.__pianist.tools.pending.size === 0, null, { timeout: 15000 });
  const after = { a: store.get('scores/欢乐颂示例 Primo.musicxml').toString(), b: store.get('scores/欢乐颂示例 Secondo.musicxml').toString() };
  const fa = [...after.a.matchAll(/<fingering>(\d)<\/fingering>/g)].map(m => m[1]), fb = [...after.b.matchAll(/<fingering>(\d)<\/fingering>/g)].map(m => m[1]);
  ok(fa.join() === '2' && fb.join() === '4' && after.a !== before.a && after.b !== before.b, `each file got its own fingering: A=${fa}, B=${fb}`);
  await r.browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
