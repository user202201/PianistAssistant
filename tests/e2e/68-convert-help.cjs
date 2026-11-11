// "How to make a PDF a playable score" help page: pointers to outside tools (nothing of them is in the app). Reachable from the PDF card menu (also in the store /
// device mode, where there is no cloud conversion) and from the "what to do with this PDF" question.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  // 1. GitHub mode: card menu + the question dialog
  let { browser, page } = await h.start(new Map([['pdfs/z-first.pdf', Buffer.from('%PDF')], ['scores/single.musicxml', fs.readFileSync(D + 'single.musicxml')]]), { context: { viewport: { width: 1194, height: 834 } } });
  await page.waitForSelector('.listbox .card'); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForSelector('.card.pdf'); await page.waitForTimeout(500);
  const menu = async () => { await page.click('.card button.del[title="更多"]'); await page.waitForSelector('dialog.dismiss[open]'); return page.evaluate(() => [...document.querySelectorAll('dialog.dismiss[open] .rowbtn')].map((b) => b.innerText.trim())); };
  let items = await menu();
  ok(items.includes('怎么转成可播放乐谱？') && items.some((x) => x.startsWith('转换成可播放乐谱')), 'the PDF card menu has the help entry next to the cloud conversion (' + items.join(' | ') + ')');
  await page.click('dialog.dismiss[open] .rowbtn:has-text("怎么转成可播放乐谱？")'); await page.waitForSelector('#convert-help[open]');
  const info = await page.evaluate(() => { const d = document.querySelector('#convert-help'); return { title: d.querySelector('h2').innerText, links: [...d.querySelectorAll('a')].map((a) => ({ t: a.innerText, ext: a.target === '_blank' && /noopener/.test(a.rel) && a.href.startsWith('https://') })), h3: [...d.querySelectorAll('h3')].map((x) => x.innerText) }; });
  ok(info.title === '把 PDF 变成可播放的乐谱' && info.h3.length === 4, 'the help dialog opens with its four parts');
  ok(info.links.length >= 6 && info.links.every((l) => l.ext), `the outside tools are links that open in a new tab (${info.links.map((l) => l.t).join(', ')})`);
  await page.mouse.click(5, 5); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('#convert-help[open]')), 'a tap outside does not close it (a message dialog has its own button)');
  await page.screenshot({ path: D + 'convert-help.png' });
  await page.click('#convert-help button.primary'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.querySelector('#convert-help')), 'the button closes it');
  await page.evaluate(() => { window.__noAuto = true; }); // the harness otherwise answers the question by itself
  await page.setInputFiles('input[type=file]', { name: 'Piece.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(D + 'Test-Piece-for-OCR.pdf') });
  await page.waitForSelector('dialog.center[open]');
  await page.click('#convert-help-btn'); await page.waitForSelector('#convert-help[open]');
  await page.click('#convert-help button.primary'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('dialog.center[open]')), 'from the "what to do with this PDF" question the help opens on top and the question is still there afterwards');
  await browser.close();
  // 2. device mode (the store builds): no cloud conversion, but the help entry is there and the message points to it
  ({ browser, page } = await h.start(new Map(), { local: true, context: { viewport: { width: 1194, height: 834 } } }));
  await page.evaluate(() => { window.__noAuto = true; });
  await page.setInputFiles('input[type=file]', { name: 'Piece2.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(D + 'Test-Piece-for-OCR.pdf') });
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('怎么转成可播放乐谱'))), 'uploading a PDF in device mode says where to find the help');
  await page.waitForSelector('.tabsbar .seg[data-k=pdf]'); await page.click('.tabsbar .seg[data-k=pdf]'); await page.waitForSelector('.card.pdf'); await page.waitForTimeout(400);
  items = await menu();
  ok(items.includes('怎么转成可播放乐谱？') && !items.some((x) => x.startsWith('转换成可播放乐谱')), 'device mode: only the help entry (no cloud conversion): ' + items.join(' | '));
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
