// The structure check of recogniser output (scripts/ocr-validate.py, used by the ocr-real workflow): needs no reference score.
// Input: the real homr result for the etude + fugue PDF, as it came out (before the repair) and after merge-pages.py.
const { execFileSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; return c; };
const root = path.join(__dirname, '..', '..'); const run = (f) => JSON.parse(execFileSync('python3', [path.join(root, 'scripts/ocr-validate.py'), f, '--json']).toString());
const raw = run(path.join(root, 'tests/fixtures/homr-etude-fugue.musicxml'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-')); fs.mkdirSync(dir + '/in'); fs.copyFileSync(path.join(root, 'tests/fixtures/homr-etude-fugue.musicxml'), dir + '/in/p-001.musicxml');
execFileSync('python3', [path.join(root, 'scores-repo-template/merge-pages.py'), dir + '/in', dir + '/out.musicxml']);
const fixed = run(dir + '/out.musicxml');
ok(raw.measures === 89 && raw.notes > 600, `it reads the file (${raw.measures} measures, ${raw.notes} notes)`);
ok(raw.stavesUsed === 2 && raw.stavesDeclared === 1, 'it sees that two staves are used but only one is declared');
ok(raw.okPercent < 90 && raw.badMeasures.includes(79) && raw.badMeasures.includes(1), `it finds the wrong bars of the raw result (${raw.okPercent} % add up; bars 1 and 79 are wrong)`);
ok(fixed.stavesDeclared === 2 && fixed.okPercent > raw.okPercent + 10 && !fixed.badMeasures.includes(79), `after the repair far more bars add up (${raw.okPercent} -> ${fixed.okPercent} %) and the fugue is fine`);
fs.writeFileSync(path.join(root, 'tests/out/ocr-validate.txt'), JSON.stringify({ raw, fixed }, null, 1));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
