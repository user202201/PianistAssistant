// Fails when a Chinese UI text in src/ has no translation (English, French, German, Japanese, Korean) in src/i18n-data.ts.
// Run: npm run check:i18n   (also part of `npm run build`, so a missing translation cannot be deployed)
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const dir = new URL("../src/", import.meta.url).pathname;
const cjk = /[一-鿿　-〿＀-￯]/;
// not UI texts: translation tables themselves, and keywords used to recognise "primo / secondo" file names
const SKIP_FILES = new Set(["i18n-data.ts", "pairs.ts"]);

const texts = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".d.ts") && !SKIP_FILES.has(x))) {
  const sf = ts.createSourceFile(f, fs.readFileSync(path.join(dir, f), "utf8"), ts.ScriptTarget.Latest, true);
  const add = (t) => {
    if (!cjk.test(t)) return;
    // an HTML fragment (innerHTML): check the texts between the tags
    if (/^\s*</.test(t)) for (const m of t.matchAll(/>([^<>]*[\u4e00-\u9fff][^<>]*)</g)) texts.set(m[1].trim(), f);
    else texts.set(t.trim(), f);
  };
  (function walk(n) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) add(n.templateSpans.reduce((s, sp, i) => s + `{${i}}` + sp.literal.text, n.head.text));
    ts.forEachChild(n, walk);
  })(sf);
}

const data = fs.readFileSync(path.join(dir, "i18n-data.ts"), "utf8");
const table = (name) => {
  const m = data.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`));
  const keys = new Set();
  for (const line of (m?.[1] ?? "").split("\n")) {
    const k = line.match(/^\s*("(?:[^"\\]|\\.)*"):/);
    if (k) keys.add(JSON.parse(k[1]).trim());
  }
  return keys;
};
const LANGS = ["EN", "FR", "DE", "JA", "KO"];
const tables = Object.fromEntries(LANGS.map((l) => [l, table(l)]));
// texts that are only used as a language's own name, or are part of an HTML fragment / not shown as such
const ALLOW = new Set(["中文", "日本語", "语言 / Language"]);
let bad = 0;
for (const [t, f] of texts) {
  if (ALLOW.has(t)) continue;
  const missing = LANGS.filter((l) => !tables[l].has(t));
  if (missing.length) {
    bad++;
    console.error(`missing ${missing.join("+")} translation (${f}): ${JSON.stringify(t)}`);
  }
}
if (bad) {
  console.error(`\n${bad} text(s) without translation. Add them to src/i18n-data.ts (EN, FR, DE, JA, KO) and run again.`);
  process.exit(1);
}
console.log(`i18n ok: ${texts.size} texts, all translated to English, French, German, Japanese and Korean`);
