// The local error log: what goes wrong is kept on the device (last 30), secrets are removed, and it is attached to the feedback mail only when the user lets it.
const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const store = new Map([['scores/a.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 } } });
  page.removeAllListeners('pageerror'); // (the test throws on purpose)
  await page.waitForSelector('.listbox .card');
  const u = await page.evaluate(async () => { const { scrub, record, getLog, clearLog, formatLog } = await import('/PianistAssistant/src/errlog.ts');
    const s = scrub('failed with ghp_abcdefghijklmnopqrstuvwxyz0123456789 and Bearer abc.def-123 at https://x.test/?access_token=SECRET&a=1 for 「My Secret Piece」 /repos/someone/PianistScores/contents');
    clearLog(); record(new Error('first'), 'test'); record(new Error('first'), 'test'); record('second', 'test'); for (let i = 0; i < 40; i++) record('n' + i + Math.random(), 'x');
    return { s, n: getLog().length, text: formatLog(300).length };
  });
  ok(!/ghp_|abc\.def|SECRET|Secret Piece|someone/.test(u.s) && /\[token\]/.test(u.s) && /\[name\]/.test(u.s), `secrets are removed (${u.s.slice(0, 90)}…)`);
  ok(u.n === 30 && u.text <= 300, 'at most 30 entries are kept, the text for a mail is limited');
  // what the page does not catch itself is logged
  await page.evaluate(() => { localStorage.removeItem('pianist.errlog.v1'); setTimeout(() => { throw new Error('boom ghp_abcdefghijklmnopqrstuvwxyz0123456789'); }, 10); });
  await page.waitForTimeout(400);
  const lg = await page.evaluate(() => JSON.parse(localStorage.getItem('pianist.errlog.v1') || '[]'));
  ok(lg.length === 1 && /boom/.test(lg[0].msg) && !/ghp_/.test(JSON.stringify(lg)), `an uncaught error is kept on the device, without the token (${lg.length} entry)`);
  // the feedback dialog offers it
  await page.click('button[title=设置]'); await page.waitForSelector('dialog.settings'); await page.click('#feedback-btn').catch(() => {}); await page.waitForTimeout(500);
  const fb = await page.evaluate(() => ({ dlg: !!document.querySelector('dialog[open] textarea'), attach: [...document.querySelectorAll('dialog[open] label.inline')].map((l) => l.innerText).join('|') }));
  if (!fb.dlg) { console.log('NOTE: no feedback button in this build (FEEDBACK_EMAIL)'); }
  else {
    ok(/1 条/.test(fb.attach) || /1 entr/i.test(fb.attach), `the feedback dialog offers to attach it and says how many entries (${fb.attach})`);
    await page.fill('dialog[open] input[type=text]', 'Problem'); await page.fill('dialog[open] textarea', 'It broke'); await page.click('dialog[open] button.primary'); await page.waitForTimeout(300);
    const mail = decodeURIComponent(await page.evaluate(() => window.__mail || ''));
    ok(/Error log:/.test(mail) && /boom/.test(mail) && !/ghp_/.test(mail), 'with the box ticked the mail carries the log (no token in it)');
  }
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
