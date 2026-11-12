// Device mode + a GitHub repository connected ONLY for PDF conversion: the scores stay on the device; a PDF the user converts goes into the repository
// (under a name of its own), the converter there makes the MusicXML, it comes back to the device and everything left in the repository is deleted.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const xml = fs.readFileSync(D + 'single.musicxml');
  const store = new Map([['scores/Piece.musicxml', Buffer.from('MY OWN SCORE IN THE REPO')], ['inbox/Piece.pdf', Buffer.from('%PDF my own queued file')]]);
  const { browser, page, puts } = await h.start(store, { local: true, context: { viewport: { width: 1194, height: 1000 } } });
  // a fake converter on the "GitHub" side
  const converter = async (mode) => { for (let i = 0; i < 80; i++) { const k = [...store.keys()].find((x) => /^inbox\/relay[^/]*\.pdf$/.test(x)); if (k) { const uniq = k.slice(6); await sleep(1500); /* the conversion takes a while */ store.delete(k); if (mode === 'fail') store.set(`inbox/${uniq}.failed.txt`, Buffer.from('Conversion failed (exit 3): no staves')); else store.set(`scores/${uniq.replace(/\.pdf$/, '.musicxml')}`, xml); return uniq; } await sleep(150); } return null; };
  await page.waitForSelector('.top'); await page.evaluate(() => { window.__noAuto = false; });
  await page.evaluate(async () => { const m = await import('/PianistAssistant/src/api.ts'); m.RELAY_WAIT.every = 300; });
  // 1. not connected yet
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#connect-conv-btn') && !(await page.isVisible('#usage-btn')) && !(await page.isVisible('#disconnect-conv')), 'not connected: settings offer "connect GitHub for PDF conversion" (no usage yet)');
  await page.click('#connect-conv-btn'); await page.waitForSelector('#connect-conv[open]');
  await page.fill('#conv-token', 'bad'); await page.fill('#conv-repo', 'user202201/PianistScores'); await page.click('#conv-connect'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !localStorage.getItem('pianist.conv.v1')) && await page.isVisible('#connect-conv'), 'a wrong token is refused and nothing is stored');
  await page.fill('#conv-token', 'good'); await page.click('#conv-connect'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => !!localStorage.getItem('pianist.conv.v1')) && !(await page.isVisible('#connect-conv')), 'the right token connects: stored on the device');
  ok(await page.evaluate(() => localStorage.getItem('pianist.storage') === 'local'), 'the library stays on the device (storage mode unchanged)');
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]');
  ok(await page.isVisible('#usage-btn') && await page.isVisible('#disconnect-conv') && (await page.textContent('dialog.settings')).includes('已连接'), 'settings now show the connection, the usage and "disconnect"');
  await page.mouse.click(5, 5); await page.waitForTimeout(300);
  // 2. convert a PDF
  const pdf = { name: 'Piece.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(D + 'Test-Piece-for-OCR.pdf') };
  const conv = converter('ok');
  await page.setInputFiles('input[type=file]', pdf);
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => [...document.querySelectorAll('#toasts .toast.working')].some((x) => x.innerText.includes('正在转换'))), 'while it works: a message with a spinner says it is converting and the app should stay open');
  const uniq = await conv;
  ok(!!uniq && uniq.startsWith('relay') && uniq.endsWith('-Piece.pdf'), 'the PDF went into the repository under a name of its own (' + uniq + ')');
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('已转换：')), null, { timeout: 20000 });
  ok(!(await page.evaluate(() => !!document.querySelector('#toasts .toast.working'))), 'the spinner is gone when the result is shown');
  await page.waitForSelector('.listbox .card'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => [...document.querySelectorAll('.listbox .card')].some((c) => c.innerText.includes('Piece'))), 'the converted score is in the library on the device');
  ok(![...store.keys()].some((k) => k.includes('relay')), 'nothing of the transfer is left in the repository (' + [...store.keys()].join(', ') + ')');
  ok(store.get('scores/Piece.musicxml').toString() === 'MY OWN SCORE IN THE REPO' && store.has('inbox/Piece.pdf'), "the user's own files in that repository were not touched");
  // 3. the converter reports a failure
  const conv2 = converter('fail'); await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((x) => x.remove()));
  await page.setInputFiles('input[type=file]', { ...pdf, name: 'Broken.pdf' });
  await conv2; await page.waitForSelector('dialog[open] .log', { timeout: 20000 });
  ok((await page.textContent('dialog[open] .log')).includes('exit 3'), 'a failure: the converter\'s message is shown');
  await page.click('dialog[open] button.primary'); await page.waitForTimeout(400);
  ok(![...store.keys()].some((k) => k.includes('relay')), 'and its files are removed from the repository too');
  // 4. another engine: its note goes before the file
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pianist.settings.v1') || '{}'); s.ocrEngine = 'homr'; localStorage.setItem('pianist.settings.v1', JSON.stringify(s)); }); await page.reload(); await page.waitForSelector('.top'); await page.evaluate(async () => { const m = await import('/PianistAssistant/src/api.ts'); m.RELAY_WAIT.every = 300; });
  puts.length = 0; const conv3 = converter('ok'); await page.setInputFiles('input[type=file]', { ...pdf, name: 'Homr.pdf' }); await conv3;
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('已转换：Homr')), null, { timeout: 20000 });
  const iNote = puts.findIndex((k) => /\.engine\.txt$/.test(k)), iPdf = puts.findIndex((k) => /\.pdf$/.test(k));
  ok(iNote >= 0 && iPdf > iNote && store.get(puts[iNote]) === undefined, 'homr: the engine note is written before the PDF (the PDF starts the converter), and removed afterwards');
  // 5. disconnect
  await page.click('button[title="设置"]'); await page.waitForSelector('dialog.settings[open]'); await page.click('#disconnect-conv'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !localStorage.getItem('pianist.conv.v1')), 'disconnecting removes the token from the device');
  await page.setInputFiles('input[type=file]', { ...pdf, name: 'Kept.pdf' }); await page.waitForTimeout(900);
  ok(await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('PDF 只能保存和查看'))), 'without a connection a PDF is only kept, and the message says where to connect');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
