// A .mxl is a zip file. A "zip bomb" (a few KB that unpack to hundreds of MB) must be refused, not unpacked into the memory of the device.
const h = require('./harness.cjs'); const { zipSync, strToU8 } = require('fflate'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
(async () => {
  const { browser, page } = await h.start(new Map(), { local: true });
  await page.waitForSelector('.home');
  const big = new Uint8Array(120 * 1024 * 1024); // 120 MB of zeros: compresses to about 120 KB
  const bomb = zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'), 'score.xml': big }, { level: 6 });
  const good = zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="s.xml"/></rootfiles></container>'), 's.xml': strToU8('<score-partwise/>') });
  const r = await page.evaluate(async ({ bomb, good }) => {
    const { toMusicXml } = await import(new URL('src/score.ts', document.baseURI).href);
    let bombErr = null, bombLen = -1; try { bombLen = toMusicXml(new Uint8Array(bomb).buffer).length; } catch (e) { bombErr = String(e.message || e); }
    let goodTxt = ''; try { goodTxt = toMusicXml(new Uint8Array(good).buffer); } catch (e) { goodTxt = 'ERR ' + e.message; }
    return { bombErr, bombLen, goodTxt };
  }, { bomb: Array.from(bomb), good: Array.from(good) });
  r.packed = bomb.length;
  ok(r.packed < 1024 * 1024 && r.bombErr !== null && r.bombLen === -1, `a ${(r.packed / 1024).toFixed(0)} KB file that unpacks to 120 MB is refused (${r.bombErr})`);
  ok(r.goodTxt === '<score-partwise/>', 'a normal .mxl is still read');
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
