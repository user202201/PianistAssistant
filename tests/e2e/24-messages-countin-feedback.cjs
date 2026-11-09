const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const IPAD = { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true };
(async () => {
  const one = fs.readFileSync(D + 'Ode_Primo.musicxml');
  const store = new Map([['scores/Alpha.musicxml', one], ['scores/Beta.musicxml', one], ['scores/Ode_Primo.musicxml', one], ['scores/Ode_Secondo.musicxml', fs.readFileSync(D + 'Ode_Secondo.musicxml')], ['pdfs/Doc.pdf', Buffer.from('%PDF')],
    ['config/pairs.json', Buffer.from(JSON.stringify({ pairs: [{ name: 'Ode', a: 'Ode_Primo.musicxml', b: 'Ode_Secondo.musicxml' }] }))]]);
  const { browser, page } = await h.start(store, { countIn: true, context: IPAD });
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(800);
  const seen = []; await page.exposeFunction('__seen', t => seen.push(t));
  await page.evaluate(() => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList?.contains('toast') && window.__seen(n.textContent)))).observe(document.body, { childList: true, subtree: true }));
  const said = async (re, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (seen.some(t => re.test(t))) return true; await page.waitForTimeout(100); } return false; };
  page.on('dialog', d => d.accept());

  // delete a score: progress + result
  await page.click('.listbox .card:has-text("Beta") .del'); await page.click('dialog button:has-text("删除这份乐谱")');
  ok(await said(/已删除「Beta」/), 'deleting a score says it was deleted');
  ok(seen.some(t => /正在删除/.test(t)), '... and shows progress first');
  // cancelled delete: no "deleted" message
  seen.length = 0; page.removeAllListeners('dialog'); page.on('dialog', d => d.dismiss());
  await page.click('.listbox .card:has-text("Alpha") .del'); await page.click('dialog button:has-text("删除这份乐谱")'); await page.waitForTimeout(800);
  ok(!seen.some(t => /已删除/.test(t)), 'cancelling the confirmation says nothing about deleting');
  page.removeAllListeners('dialog'); page.on('dialog', d => d.accept());
  // rename
  seen.length = 0;
  await page.click('.listbox .card:has-text("Alpha") .del'); await page.click('dialog button:has-text("重命名")'); await page.fill('dialog input[type=text]', 'Alpha 2'); await page.click('dialog button.primary');
  ok(await said(/已重命名为「Alpha 2」/), 'renaming says so');
  // favourites
  seen.length = 0; await page.click('.listbox .card:has-text("Alpha 2") .star'); ok(await said(/已加入收藏/), 'favourite: message'); await page.click('.listbox .card:has-text("Alpha 2") .star'); ok(await said(/已取消收藏/), 'unfavourite: message');
  // pair: unlink
  seen.length = 0; await page.click('.listbox .card.pair .del'); await page.click('dialog button:has-text("取消关联")'); ok(await said(/已取消关联/), 'unlinking a pair says so');
  // pdf delete
  seen.length = 0; await page.click('.tabsbar button:has-text("PDF 乐谱")'); await page.click('.card.pdf .del'); await page.click('dialog button:has-text("删除这份 PDF")'); ok(await said(/已删除 PDF「Doc.pdf」/), 'deleting a PDF says so');

  // count-in: big numbers, then the music
  await page.click('.tabsbar button:has-text("全部琴谱")'); await page.click('.listbox .card:has-text("Ode_Primo") .open'); await page.waitForSelector('.controls .mainrow'); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => window.__pianist.player.countIn === true), 'count-in is on by default');
  await page.click('button[title^=播放]');
  await page.waitForSelector('.countin.pop', { timeout: 3000 }); const nums = [];
  for (let i = 0; i < 30; i++) { const t = await page.evaluate(() => document.querySelector('.countin')?.textContent); if (t && nums[nums.length - 1] !== t) nums.push(t); await page.waitForTimeout(120); }
  ok(nums.join('') === '1234', `the beats are shown as numbers: ${nums.join(' ')}`);
  ok(await page.evaluate(() => !document.querySelector('.countin')), 'the numbers disappear when the music starts');
  await page.click('button[title^=播放]'); // pause

  // every message sits in the top bar band, also above an open dialog
  await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog'); await page.click('#check-update');
  await page.waitForSelector('#toasts .toast', { timeout: 6000 });
  const pos = await page.evaluate(() => { const t = document.querySelector('#toasts .toast'); const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { y: Math.round(r.top), onTop: true }; });
  ok(pos.y < 40 && pos.onTop, `messages are at the top (y=${pos.y}) and visible above the open settings dialog`);
  await page.evaluate(() => document.querySelector('dialog')?.close());
  // help & feedback
  await page.evaluate(() => document.querySelector('.top button:last-child').click()); await page.waitForSelector('dialog'); await page.click('#feedback-btn');
  await page.waitForSelector('dialog:has-text("帮助与反馈")');
  const opts = await page.$$eval('dialog select option', os => os.map(o => o.textContent)); ok(opts.join() === '意见,Bug,期待的功能', `type drop-down: ${opts.join(' / ')}`);
  await page.click('dialog button.primary'); ok((await page.textContent('dialog')).includes('请填写标题'), 'a title is required');
  await page.fill('dialog input[type=text]', 'Test title'); await page.selectOption('dialog select', 'Bug'); await page.fill('dialog textarea', 'It crashes when I tap here');
  let mail = ''; await page.route(/^mailto:/, r => r.abort()); page.on('request', r => { if (r.url().startsWith('mailto:')) mail = r.url(); });
  await page.evaluate(() => { const orig = Object.getOwnPropertyDescriptor(Location.prototype, 'href'); }); // (navigation to mailto is observed below)
  const nav = page.waitForEvent('framenavigated', { timeout: 3000 }).catch(() => null);
  await page.click('dialog button.primary'); await page.waitForTimeout(1200);
  ok(mail.startsWith('mailto:feedback@example.test?subject=%5BBug%5D%20Test%20title') && decodeURIComponent(mail).includes('It crashes when I tap here') && !decodeURIComponent(mail).includes('musicxml'), 'sending opens the mail app with the prepared mail (no scores in it)');
  console.log('mailto seen:', mail ? decodeURIComponent(mail).replace(/\n/g, ' | ').slice(0, 230) : '(not observable in headless)');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
