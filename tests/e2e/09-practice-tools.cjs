const h = require('./harness.cjs'); const fs = require('fs'); const D = process.env.D;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const store = new Map([['scores/dyn.musicxml', fs.readFileSync(D + 'dyn.musicxml')], ['scores/plain.musicxml', fs.readFileSync(D + 'single.musicxml')]]);
  const { browser, page } = await h.start(store, { context: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true } });
  const open = async (n) => { await page.evaluate((n) => (location.hash = '#/score/' + n + '.musicxml'), n); await page.waitForSelector('.controls .big'); await page.waitForTimeout(500); };
  await open('dyn');
  const ev = await page.evaluate(() => { const s = window.__pianist.score; return { x: s.expression, rh: s.events.filter(e => e.staff === 0).map(e => ({ m: e.measure, k: Math.round(e.onset * 4), v: e.vel, d: +e.dur.toFixed(3), d0: +e.dur0.toFixed(3) })) }; });
  console.log('found:', JSON.stringify(ev.x));
  const v = (m, k) => ev.rh.find(e => e.m === m && e.k === k);
  console.log('m1 (p):', [0, 1, 2, 3].map(k => v(0, k).v).join(' '), '| m2:', [0, 1, 2, 3].map(k => v(1, k).v).join(' '), '| m3:', [0, 1, 2, 3].map(k => v(2, k).v).join(' '), '| m4 (f):', [0, 1, 2, 3].map(k => v(3, k).v).join(' '), '| m5:', [0, 1, 2, 3].map(k => v(4, k).v).join(' '));
  ok(ev.x.dynamics === 4 && ev.x.wedges === 1 && ev.x.articulations === 2 && ev.x.pedals === 1, `markings counted: ${JSON.stringify(ev.x)}`);
  ok(v(0, 0).v < v(3, 0).v - 30, `piano (${v(0, 0).v}) is clearly softer than forte (${v(3, 0).v})`);
  const cres = [v(1, 0), v(1, 1), v(1, 2), v(1, 3), v(2, 0), v(2, 1), v(2, 2), v(2, 3)].map(e => e.v);
  ok(cres[7] - cres[0] > 25 && cres.filter((x, i) => i > 0 && x < cres[i - 1] - 4).length === 0, `crescendo rises smoothly over 2 bars: ${cres.join(' ')}`);
  ok(v(3, 2).v >= v(3, 3).v + 8, `accent: E=${v(3, 2).v} is louder than the next note F=${v(3, 3).v}`);
  ok(v(3, 1).d < v(3, 1).d0 * 0.6, `staccato note is short: ${v(3, 1).d}s of ${v(3, 1).d0}s`);
  ok(v(4, 0).v >= v(3, 0).v + 15 && v(4, 1).v < v(3, 0).v - 25, `sfz spikes (${v(4, 0).v}) then pp (${v(4, 1).v})`);
  const ped = [0, 1, 2, 3].map(k => v(5, k));
  ok(ped.every((e, k) => Math.abs(e.d - (4 - k) * 0.5) < 0.03), `pedal: bar-6 notes ring until the pedal is released: ${ped.map(e => e.d).join(' ')}s (expect 2 1.5 1 0.5)`);
  ok(v(1, 3).d < 0.5, 'no pedal -> notes are not extended');

  // flat toggle really plays every note the same
  await page.evaluate(() => { const p = window.__pianist.player; window.__rec = []; const i = p.inst; const o = i.start.bind(i); i.start = e => { window.__rec.push({ n: e.note, v: e.velocity, d: e.duration }); return o(e); }; });
  ok(await page.evaluate(() => { const a = document.querySelector('button[title=练习]').closest('.group').getBoundingClientRect(); const b = document.querySelector('button[title="显示 / 隐藏指法"]').closest('.group').getBoundingClientRect(); return Math.abs(a.height - b.height) < 2; }), 'the practice button has the same size and look as the fingering button');
  await page.click('button[title=练习]');
  { const t = await page.textContent('.panel:not([hidden])'); ok(!t.includes('表情记号') && !t.includes('没有力度/踏板记号'), 'the practice panel shows no statistics line about expression marks'); }
  await page.click('button[title^=播放]'); await page.waitForTimeout(1600); await page.click('button[title^=播放]');
  const exprRec = await page.evaluate(() => window.__rec.map(r => r.v));
  ok(new Set(exprRec).size > 1, `expressive playback uses varying velocities: ${[...new Set(exprRec)].join(',')}`);
  await page.evaluate(() => { window.__rec.length = 0; });
  await page.check('.panel label:has-text("按乐谱表情演奏") input', { force: true }).catch(() => {});
  await page.uncheck('.panel label:has-text("按乐谱表情演奏") input');
  await page.click('button[title="回到开头"]').catch(() => {});
  await page.click('button[title^=播放]'); await page.waitForTimeout(1600); await page.click('button[title^=播放]');
  const flatRec = await page.evaluate(() => window.__rec.map(r => r.v));
  ok(flatRec.length > 3 && new Set(flatRec).size === 1 && flatRec[0] === 80, `with the switch off every note is the same (${flatRec[0]})`);

  // a score without any markings still gets shape
  await page.click('button[title=返回]').catch(() => {}); await page.waitForSelector('.home'); await open('plain');
  const pl = await page.evaluate(() => { const s = window.__pianist.score; return { x: s.expression, v: s.events.filter(e => e.staff === 0).slice(0, 4).map(e => e.vel) }; });
  ok(new Set(pl.v).size > 1 && pl.v[0] > pl.v[1], `no markings: strong beat > weak beat (${pl.v.join(' ')})`);
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
})();
