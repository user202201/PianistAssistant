#!/usr/bin/env node
// Turns the results of tests/run-all.sh (tests/out/) into a readable report:
//   tests/out/report.md     -> goes into the GitHub "job summary" (what is wrong, in plain words)
//   tests/out/report.html   -> self-contained page: problems + the screenshots of the screens that failed (embedded)
//   tests/out/gallery.html  -> every screenshot of the layout / device-matrix suites (needs tests/out/work/*.png next to it)
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'out'); const WORK = path.join(OUT, 'work');
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const rows = read(path.join(OUT, 'summary.txt')).split('\n').map((l) => l.match(/^(PASS|FAIL)\s+(\S+)/)).filter(Boolean).map((m) => ({ ok: m[1] === 'PASS', name: m[2] }));
const logOf = (name) => read(path.join(OUT, path.basename(name) + '.log'));
const safe = (t) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
// which screenshot belongs to a failing line (the suites name them in their messages)
const shotOf = (line) => {
  let m = line.match(/^(\S+?)\/(\S+) (\S+?)(?: — |:)/); // layout suites: "fr-FR/small-phone home: fits — ..."
  if (m) { const f = `layout-${m[1]}-${m[2]}-${m[3].replace(/:$/, '')}.png`; if (fs.existsSync(path.join(WORK, f))) return f; }
  m = line.match(/^(.+?) (portrait|landscape) (\d+x\d+) (\S+?)(?: — |$)/); // device matrix: "iPhone SE portrait 375x667 duet — ..."
  if (m) { const f = `matrix-${safe(m[1])}-${m[2]}-${m[4]}.png`; if (fs.existsSync(path.join(WORK, f))) return f; }
  return null;
};
const problems = [];
for (const r of rows.filter((x) => !x.ok)) {
  const log = logOf(r.name); const fails = [...new Set(log.split('\n').filter((l) => /^FAIL /.test(l)).map((l) => l.slice(5)))];
  const lines = fails.length ? fails : log.split('\n').filter(Boolean).slice(-4); // a crash has no FAIL line: show the end of the log
  problems.push({ name: r.name, lines: lines.slice(0, 40).map((l) => ({ text: l.length > 420 ? l.slice(0, 420) + '…' : l, shot: shotOf(l) })), more: Math.max(0, lines.length - 40) });
}
const passed = rows.filter((r) => r.ok).length, failed = rows.length - passed;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// ---- markdown (job summary)
let md = `# Test report — ${failed ? '❌' : '✅'} ${passed} of ${rows.length} suites passed${failed ? `, **${failed} failed**` : ''}\n\n_${stamp}_\n\n`;
if (problems.length) { md += `## What is wrong\n\n`; for (const p of problems) { md += `### ${p.name}\n`; for (const l of p.lines) md += `- ${l.text}${l.shot ? `  _(screenshot: \`${l.shot}\`)_` : ''}\n`; if (p.more) md += `- … and ${p.more} more\n`; md += '\n'; } md += `Screenshots of every checked screen are in the artifact **e2e-report** of this run.\n\n`; }
md += `## All suites\n\n| | suite |\n|---|---|\n` + rows.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.name} |`).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'report.md'), md);

// ---- html (problems + embedded screenshots of the failed screens)
const img = (f) => { try { return `<img alt="${f}" src="data:image/png;base64,${fs.readFileSync(path.join(WORK, f)).toString('base64')}">`; } catch { return ''; } };
let embedded = 0;
const html = `<!doctype html><meta charset="utf-8"><title>Test report</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px}h1{font-size:1.5rem}.ok{color:#188038}.bad{color:#c5221f}code{background:#eee;padding:1px 5px;border-radius:4px}li{margin:4px 0}img{max-width:320px;max-height:420px;border:1px solid #ccc;border-radius:6px;display:block;margin:6px 0}table{border-collapse:collapse}td{padding:2px 12px 2px 0}</style>
<h1>${failed ? '❌' : '✅'} ${passed} of ${rows.length} suites passed${failed ? `, <span class="bad">${failed} failed</span>` : ''}</h1><p>${stamp}</p>
${problems.length ? '<h2>What is wrong</h2>' + problems.map((p) => `<h3 class="bad">${esc(p.name)}</h3><ul>${p.lines.map((l) => `<li>${esc(l.text)}${l.shot && embedded++ < 14 ? img(l.shot) : l.shot ? ` <em>(${l.shot})</em>` : ''}</li>`).join('')}${p.more ? `<li>… and ${p.more} more</li>` : ''}</ul>`).join('') + '<p>The screenshots of all checked screens: gallery.html (in the same artifact).</p>' : '<p class="ok">Nothing is wrong.</p>'}
<h2>All suites</h2><table>${rows.map((r) => `<tr><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✅ passed' : '❌ FAILED'}</td><td>${esc(r.name)}</td></tr>`).join('')}</table>`;
fs.writeFileSync(path.join(OUT, 'report.html'), html);

// ---- gallery of all screenshots
const shots = fs.existsSync(WORK) ? fs.readdirSync(WORK).filter((f) => /^(layout|matrix)-.*\.png$/.test(f)).sort() : [];
fs.writeFileSync(path.join(OUT, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Screens</title><style>body{font:13px system-ui;margin:12px}figure{display:inline-block;margin:6px;vertical-align:top}img{max-width:240px;max-height:360px;border:1px solid #ccc}figcaption{max-width:240px;word-break:break-all}</style><h1>${shots.length} screens</h1>` + shots.map((f) => `<figure><a href="work/${f}"><img loading="lazy" src="work/${f}"></a><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join(''));
console.log(`report: ${passed}/${rows.length} passed, ${failed} failed, ${shots.length} screenshots`);
