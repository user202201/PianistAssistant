const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const IPAD = { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
(async () => {
  const store = new Map([
    ['scores/plain.musicxml', fs.readFileSync(D + 'single.musicxml')],
    ['scores/fingered.musicxml', fs.readFileSync(D + 'fingered.musicxml')],
    ['inbox/queued.pdf', Buffer.from('x')],
    ['inbox/broken.jpg', Buffer.from('x')],
    ['inbox/broken.jpg.failed.txt', Buffer.from('Conversion failed (exit 3): broken.jpg\n-----\nno staves')],
  ]);
  const { browser, page, puts } = await h.start(store, { context: IPAD });

  // ---- home: queue + uploads
  await page.waitForSelector('.card.busy'); await page.waitForSelector('.card.failed');
  ok(await page.locator('.card.busy').count() === 1 && await page.locator('.card.failed').count() === 1, 'home shows 1 converting + 1 failed item');
  await page.click('.card.failed button[title=查看原因]'); await page.waitForSelector('dialog .log');
  ok((await page.textContent('dialog .log')).includes('no staves'), 'failure reason dialog shows the log');
  await page.click('dialog button.primary');
  await page.screenshot({ path: D + 'ipad-home.png' });
  await page.setInputFiles('input[type=file]', [D + 'packed.mxl', D + 'fake.pdf']);
  await page.waitForFunction(() => [...document.querySelectorAll('.card .open')].some(e => e.textContent.includes('packed')));
  ok(store.has('scores/packed.musicxml') && !store.has('scores/packed.mxl'), '.mxl upload is unzipped and stored as plain .musicxml');
  ok(store.get('scores/packed.musicxml').toString().includes('<score-partwise'), 'stored file is MusicXML text');
  ok(store.has('inbox/fake.pdf'), 'PDF upload goes to inbox/ for conversion');
  await page.waitForFunction(() => document.querySelectorAll('.card.busy').length === 2);
  ok(true, 'queue now shows 2 converting items');
  await page.click('.card.failed button[title=删除]').catch(() => {}); // confirm dialog is auto-dismissed below
  page.on('dialog', d => d.accept());
  await page.click('.card.failed button[title=删除]'); await page.waitForFunction(() => document.querySelectorAll('.card.failed').length === 0);
  ok(!store.has('inbox/broken.jpg') && !store.has('inbox/broken.jpg.failed.txt'), 'deleting a failed item removes file and note');

  // ---- score without fingering: auto suggestions + editing
  await page.click('.card .open >> text=plain'); await page.waitForSelector('.controls .big'); await page.waitForTimeout(500);
  let st = await page.evaluate(() => { const t = window.__pianist.tools; return { xml: t.xmlCount, auto: t.showAuto, badges: document.querySelectorAll('.fbadge.auto').length, notes: t.notes.filter(n => !n.tieStop).length }; });
  ok(st.xml === 0 && st.auto === true, 'no XML fingering -> auto suggestion on by default');
  ok(st.badges === st.notes, `blue badges drawn for every note (${st.badges}/${st.notes})`);
  await page.screenshot({ path: D + 'ipad-auto.png' });

  // master switch
  await page.screenshot({ path: D + 'ipad-landscape-controls.png' });
  await page.click('button[title="显示 / 隐藏指法"]');
  ok(await page.evaluate(() => document.querySelectorAll('.fbadge').length) === 0 && await page.evaluate(() => window.__pianist.osmd.EngravingRules.RenderFingerings) === false, 'master switch OFF hides suggestions and notation fingering');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.settings.v1')).fingers) === false, 'switch state is remembered');
  await page.click('button[title="显示 / 隐藏指法"]');
  ok(await page.evaluate(() => document.querySelectorAll('.fbadge.auto').length) === st.badges, 'master switch ON brings them back');
  await page.click('button[title=指法选项]'); await page.click('.panel:not([hidden]) button.primary');
  await page.waitForSelector('.editbar:not([hidden])');
  const pt = await page.evaluate(() => { const t = window.__pianist.tools; const s = t.spots.find(s => s.note.midi === 60 && s.note.hand === 'R'); const r = document.querySelector('.score').getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; });
  await page.touchscreen.tap(pt.x, pt.y);
  ok(await page.evaluate(() => window.__pianist.tools.selected !== null), 'touch tap on a note selects it');
  await page.screenshot({ path: D + 'ipad-edit.png' });
  await page.click('.editbar .fnum >> text=3');
  let pend = await page.evaluate(() => [...window.__pianist.tools.pending]);
  ok(pend.length === 1 && pend[0][1] === 3, 'tapping 3 sets the fingering of the selected note');
  ok(await page.evaluate(() => window.__pianist.tools.selected) === 1, 'selection advanced to the next note');
  await page.click('.editbar .fnum >> text=2'); await page.click('button[title=撤销]');
  ok(await page.evaluate(() => window.__pianist.tools.pending.size) === 1, 'undo removes the last edit');
  await page.keyboard.press('4');
  ok(await page.evaluate(() => window.__pianist.tools.pending.size) === 2, 'keyboard digit also sets fingering (external keyboard)');
  await page.click('.editbar button >> text=/^保存/');
  await page.waitForFunction(() => window.__pianist.tools.pending.size === 0);
  const saved = store.get('scores/plain.musicxml').toString();
  const fingers = [...saved.matchAll(/<fingering>(\d)<\/fingering>/g)].map(m => m[1]);
  console.log('saved fingerings', fingers);
  ok(fingers.length === 2 && fingers[0] === '3' && fingers[1] === '4', 'saved XML now contains the fingerings I set');
  ok(puts.includes('scores/plain.musicxml'), 'saved back to the scores repo');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__pianist.tools.xmlCount) === 2, 'XML fingerings counted after save');
  const nBadges = () => page.evaluate(() => document.querySelectorAll('.fbadge.auto').length);
  ok(await nBadges() === 9, 'overlay survives the re-render after saving (9 blue badges for notes without fingering)');
  await page.click('button[title=放大]'); await page.waitForTimeout(200);
  ok(await nBadges() === 9, 'overlay survives zoom');
  const align = await page.evaluate(() => { const t = window.__pianist.tools; const hr = document.querySelector('.score').getBoundingClientRect(); const bs = [...document.querySelectorAll('.fbadge.auto')]; const far = bs.filter(b => { const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2 - hr.left, cy = r.top + r.height / 2 - hr.top; return Math.min(...t.spots.map(s => Math.hypot(s.x - cx, s.y - cy))) > 70; }).length; return { dx: far, n: t.spots.length }; });
  ok(align.n === 11 && align.dx === 0, `every badge sits next to its note after zoom (${align.dx} too far)`);
  await page.screenshot({ path: D + 'ipad-saved.png' });

  // ---- reopen: XML fingering takes priority, auto stays off, blue only for notes without
  await page.click('button >> text=完成'); await page.click('button[title=返回]'); await page.waitForSelector('.home');
  await page.click('.card .open >> text=plain'); await page.waitForSelector('.controls .big'); await page.waitForTimeout(500);
  st = await page.evaluate(() => { const t = window.__pianist.tools; return { xml: t.xmlCount, auto: t.showAuto, badges: document.querySelectorAll('.fbadge.auto').length }; });
  ok(st.xml === 2 && st.auto === false && st.badges === 0, 'reopened score: reads fingering from XML, auto suggestion off');
  await page.click('button[title=指法选项]'); await page.check('.panel:not([hidden]) label:has-text("自动建议") input');
  st = await page.evaluate(() => ({ badges: document.querySelectorAll('.fbadge.auto').length, notes: window.__pianist.tools.notes.filter(n => !n.tieStop).length }));
  ok(st.badges === st.notes - 2, `auto fills only the notes without fingering (${st.badges} = ${st.notes} - 2)`);

  // ---- portrait iPad screenshot
  await page.setViewportSize({ width: 834, height: 1194 }); await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.querySelectorAll('.fbadge.auto').length) === st.badges, 'overlay survives rotating to portrait');
  await page.screenshot({ path: D + 'ipad-portrait.png' });
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
