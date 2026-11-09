const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const one = fs.readFileSync(D + 'Ode_Primo.musicxml');
  const store = new Map([['scores/Alpha.musicxml', one], ['scores/Beta.musicxml', one], ['scores/Ode_Primo.musicxml', one], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['pdfs/Sheet.pdf', Buffer.from('%PDF')],
    ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'Ode', a: 'Ode_Primo.musicxml', b: 'Ode_Secondo.musicxml' }] }))]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  await page.waitForSelector('.card'); await page.waitForTimeout(800);
  const titles = () => page.evaluate(() => [...document.querySelectorAll('.listbox .card')].map(c => c.querySelector('.mq')?.textContent));
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabsbar button')].map(b => b.querySelector('.lbl').innerText.trim()));
  ok(tabs.join() === '全部琴谱,四手联弹,PDF 乐谱,收藏', `tabs: ${tabs.join(' | ')}`);
  // every tab shows how many items are behind it; the number is always what the tab then lists
  const counts = () => page.evaluate(() => [...document.querySelectorAll('.tabsbar .seg')].map(b => ({ k: b.getAttribute('data-k'), n: Number(b.querySelector('.tabcount').textContent || 0), shown: !b.querySelector('.tabcount').hidden })));
  for (const k of ['all', 'duet', 'pdf', 'fav']) { await page.click(`.tabsbar .seg[data-k=${k}]`); await page.waitForTimeout(250); const c = (await counts()).find(x => x.k === k); ok(c.n === (await titles()).length, `tab "${k}" shows the number ${c.n} = the ${(await titles()).length} cards it lists`); }
  await page.click('.tabsbar .seg[data-k=all]'); await page.waitForTimeout(200);
  ok((await titles()).includes('Alpha') && (await titles()).includes('Ode'), `all: scores and the four-hand piece: ${(await titles()).join(', ')}`);
  await page.click('.tabsbar button:has-text("四手联弹")'); ok((await titles()).join() === 'Ode', 'four hands tab: only the pair');
  await page.click('.tabsbar button:has-text("PDF 乐谱")'); ok((await titles()).join() === 'Sheet', 'PDF tab: only PDFs');
  await page.click('.tabsbar button:has-text("收藏")'); ok((await page.textContent('.listbox')).includes('还没有收藏'), 'favourites tab: empty hint');
  await page.click('.tabsbar button:has-text("全部琴谱")');
  await page.click('.listbox .card:has-text("Beta") .star');
  ok(await page.evaluate(() => [...document.querySelectorAll('.listbox .card')].find(c => c.textContent.includes('Beta')).querySelector('.star').classList.contains('on')), 'the star lights up at once (no waiting for the server)');
  await page.click('.listbox .card:has-text("Ode") .star >> nth=0');
  await page.waitForTimeout(1200);
  const saved = store.get('config/favorites.json'); ok(saved && JSON.parse(saved.toString()).favorites.length === 2, `favourites synced to the repository: ${saved?.toString().replace(/\s+/g, ' ')}`);
  await page.click('.tabsbar button:has-text("收藏")'); ok((await titles()).length === 2, `favourites tab shows the two: ${(await titles()).join(', ')}`);
  await page.click('.listbox .card:has-text("Beta") .star'); ok((await titles()).join() === 'Ode', 'removing a favourite takes it off the tab');
  await page.reload(); await page.waitForSelector('.card'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => document.querySelector('.tabsbar button.on .lbl')?.innerText.trim()) === '收藏', 'the chosen tab is remembered');
  // only one scrollbar: the page itself does not scroll
  ok(await page.evaluate(() => { const m = document.querySelector('.home'); return m.scrollHeight <= m.clientHeight + 1; }), 'the page itself has no scrollbar (only the list scrolls)');
  // rename / delete keep the favourites in step
  await page.click('.tabsbar button:has-text("全部琴谱")');
  await page.click('.listbox .card:has-text("Alpha") .star'); await page.waitForTimeout(900);
  await page.click('.listbox .card:has-text("Alpha") .del'); await page.click('dialog button:has-text("重命名")'); await page.fill('dialog input[type=text]', 'Alpha2'); await page.click('dialog button.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.listbox .card')].some(c => c.textContent.includes('Alpha2')), null, { timeout: 10000 }); await page.waitForTimeout(1500);
  let fv = JSON.parse(store.get('config/favorites.json').toString()).favorites;
  ok(fv.includes('s:Alpha2.musicxml') && !fv.includes('s:Alpha.musicxml'), `rename moves the favourite: ${fv.join(' ')}`);
  page.on('dialog', d => d.accept());
  await page.click('.listbox .card:has-text("Alpha2") .del'); await page.click('dialog button:has-text("删除这份乐谱")');
  await page.waitForFunction(() => ![...document.querySelectorAll('.listbox .card')].some(c => c.textContent.includes('Alpha2')), null, { timeout: 10000 }); await page.waitForTimeout(2000);
  fv = JSON.parse(store.get('config/favorites.json').toString()).favorites;
  ok(!fv.some(k => k.includes('Alpha')), `delete removes the favourite: ${fv.join(' ')}`);
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
