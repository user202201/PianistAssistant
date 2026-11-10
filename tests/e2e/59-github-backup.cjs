// Signed in (GitHub) mode: backup downloads every file of the repository as one zip; restoring puts the files back (after asking).
// Cancelling the question changes nothing and shows no "done" message.
const h = require('./harness.cjs'); const fs = require('fs'); const { unzipSync } = require('fflate'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const one = fs.readFileSync(D + 'single.musicxml'), two = fs.readFileSync(D + 'fingered.musicxml');
  const store = new Map([['scores/Etude.musicxml', one], ['scores/Ode.musicxml', two], ['pdfs/Book.pdf', Buffer.from('%PDF-1.4 test')], ['pdfs/Book.pdf.ann.json', Buffer.from('{"p1":[]}')], ['config/favorites.json', Buffer.from('["s:Etude.musicxml"]')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  await page.waitForSelector('.listbox .card');
  const openSettings = async () => { await page.click('button[title=设置]'); await page.waitForSelector('dialog.settings'); await page.waitForTimeout(300); };
  await openSettings();
  ok(await page.isVisible('#backup-btn') && await page.isVisible('#restore-btn'), 'signed in: the settings have a Backup block with both buttons');
  ok(!(await page.textContent('dialog.settings')).includes('谱子保存在这台设备上'), 'and it says the scores are in the GitHub repository');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-btn')]);
  const zipPath = D + 'github-backup.zip'; await dl.saveAs(zipPath);
  const z = unzipSync(new Uint8Array(fs.readFileSync(zipPath))); const names = Object.keys(z).sort();
  ok(names.join('|') === 'config/favorites.json|pdfs/Book.pdf|pdfs/Book.pdf.ann.json|scores/Etude.musicxml|scores/Ode.musicxml', `the backup holds every file of the repository (${names.join(', ')})`);
  ok(Buffer.from(z['scores/Etude.musicxml']).equals(one) && Buffer.from(z['pdfs/Book.pdf']).toString().startsWith('%PDF'), 'with the real contents');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('备份已生成'))), 'a message says the backup is ready');
  // lose a score and the favourites, then restore
  store.delete('scores/Etude.musicxml'); store.delete('config/favorites.json');
  await page.keyboard.press('Escape'); await page.reload(); await page.waitForSelector('.listbox .card'); await page.waitForTimeout(800);
  ok(!(await page.textContent('.listbox')).includes('Etude'), 'the score is gone from the repository (pretend)');
  await openSettings();
  // cancel the question
  page.once('dialog', (d) => d.dismiss());
  await page.setInputFiles('dialog.settings input[type=file]', zipPath); await page.waitForTimeout(800);
  ok(!store.has('scores/Etude.musicxml') && !(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('已恢复')))), 'cancelling the question: nothing is restored and no "restored" message');
  // accept
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await page.setInputFiles('dialog.settings input[type=file]', zipPath); await page.waitForTimeout(2500);
  ok(/5/.test(asked) && /GitHub/.test(asked), `it asks first, naming the number of files (${asked.slice(0, 40)}…)`);
  ok(store.has('scores/Etude.musicxml') && Buffer.from(store.get('scores/Etude.musicxml')).equals(one) && store.has('config/favorites.json'), 'accepting: the files are back in the repository, unchanged');
  ok(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('已恢复 5'))), 'a message says how many files were restored');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector('.listbox .card'); await page.waitForTimeout(800);
  ok((await page.textContent('.listbox')).includes('Etude'), 'after a reload the restored score is in the list again');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
