import { toMusicXml } from "./score";

/**
 * Scores live in a PRIVATE GitHub repo (default: <you>/PianistScores, folder scores/).
 * The browser talks to the GitHub REST API directly with a fine-grained token that
 * only has Contents access to that one repo. No token = no scores.
 */
export interface ScoreInfo {
  name: string;
  size: number;
}

const AUTH_KEY = "pianist.auth.v1";
const SCORES = "scores";
const INBOX = "inbox";
const SCORE_EXT = /\.(musicxml|xml|mxl)$/i;
/** files that need optical music recognition first (done by a GitHub Action in the scores repo) */
const INBOX_EXT = /\.(pdf|png|jpe?g|tiff?|bmp)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_INBOX_BYTES = 20 * 1024 * 1024;

export interface Auth {
  token: string;
  repo: string; // owner/name
  branch?: string;
  user?: string;
}

function readAuth(store: Storage): Auth | null {
  try {
    const a = JSON.parse(store.getItem(AUTH_KEY) ?? "null");
    return a?.token && a?.repo ? a : null;
  } catch {
    return null;
  }
}
/** "Stay signed in" lives in localStorage; otherwise only in sessionStorage (gone when the tab closes). */
export function getAuth(): Auth | null {
  return readAuth(sessionStorage) ?? readAuth(localStorage);
}
export function isPersistent(): boolean {
  return readAuth(localStorage) !== null;
}
export function logout() {
  for (const st of [localStorage, sessionStorage]) {
    try {
      st.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** A link that signs another device in: the token travels in the URL #fragment (never sent to any server). */
export function makeLoginLink(a: Auth): string {
  const payload = btoa(JSON.stringify({ t: a.token, r: a.repo })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}#/link/${payload}`;
}
export function parseLink(text: string): { token: string; repo: string } | null {
  const m = text.match(/#\/link\/([\w-]+)/);
  if (!m) return null;
  try {
    const o = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
    return o.t && o.r ? { token: o.t, repo: o.r } : null;
  } catch {
    return null;
  }
}

export class AuthExpired extends Error {}
/** An API failure with what GitHub said about it (shown to the user, not swallowed). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public detail = "") {
    super(message);
  }
}
async function apiError(r: Response, what: string): Promise<ApiError> {
  let detail = "";
  try {
    const j = (await r.clone().json()) as { message?: string };
    detail = j.message ?? "";
  } catch {
    /* not JSON */
  }
  return new ApiError(`${what} (${r.status})${detail ? `：${detail}` : ""}`, r.status, detail);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Kind = "score" | "inbox";

function headers(a: Auth, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Authorization: `Bearer ${a.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh(a: Auth, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response | undefined;
  const big = typeof init.body === "string" && init.body.length > 1_500_000;
  let why = "";
  // a dropped connection (common with big uploads on iPad Wi-Fi / cellular) is retried before giving up
  for (let i = 0; i < (init.method === "PUT" ? 3 : 2) && !res; i++) {
    try {
      res = await fetch(url, init);
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
      await sleep(900 * (i + 1));
    }
  }
  if (!res) {
    const size = typeof init.body === "string" ? `（这次上传约 ${(init.body.length * 0.75 / 1048576).toFixed(1)} MB）` : "";
    throw new ApiError(
      `网络请求失败（${why || "未知"}）${size}：${big ? "文件较大，上传过程中连接被中断，换个网络或把文件压缩/缩小后再试；" : ""}也可能是网络断了或被拦截。`,
      0,
    );
  }
  if (res.status === 401) {
    logout();
    throw new AuthExpired("登录已失效，请重新登录");
  }
  return res;
}

/** Validate token + repo, then remember them on this device. */
export async function login(token: string, repo: string, remember = true): Promise<Auth> {
  const link = parseLink(token);
  if (link) ({ token, repo } = link);
  repo = repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  token = token.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("仓库格式应为 owner/name");
  if (!token) throw new Error("请输入令牌");
  const a: Auth = { token, repo };
  const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(a) });
  if (r.status === 401) throw new Error("令牌无效或已过期");
  if (r.status === 404) throw new Error("找不到该仓库，或令牌没有访问它的权限");
  if (!r.ok) throw new Error(`GitHub 返回 ${r.status}`);
  const info = (await r.json()) as { permissions?: { push?: boolean }; default_branch: string; private: boolean };
  if (!info.permissions?.push) throw new Error("令牌没有该仓库的写权限（需要 Contents: Read and write）");
  if (!info.private && !location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
    throw new Error("该仓库是公开的，琴谱会被所有人看到。请使用私有仓库。");
  }
  a.branch = info.default_branch;
  const u = await fetch("https://api.github.com/user", { headers: headers(a) });
  if (u.ok) a.user = ((await u.json()) as { login: string }).login;
  logout();
  (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(a));
  return a;
}

function need(): Auth {
  const a = getAuth();
  if (!a) throw new AuthExpired("请先登录");
  return a;
}
function url(a: Auth, dir: string, name?: string) {
  const p = name ? `${dir}/${encodeURIComponent(name)}` : dir;
  return `https://api.github.com/repos/${a.repo}/contents/${p}`;
}
const ref = (a: Auth) => `?ref=${encodeURIComponent(a.branch ?? "main")}`;

export function cleanName(raw: string, kind: Kind = "score"): string | null {
  // eslint-disable-next-line no-control-regex
  const n = raw.normalize("NFC").replace(/[\\/\u0000-\u001f<>:"|?*]/g, "_").trim();
  const re = kind === "score" ? SCORE_EXT : INBOX_EXT;
  return !n || n.startsWith(".") || n.length > 120 || !re.test(n) ? null : n;
}

async function list(dir: string): Promise<ScoreInfo[]> {
  const a = need();
  const r = await gh(a, url(a, dir) + ref(a), { headers: headers(a), cache: "no-store" });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`读取列表失败 (${r.status})`);
  const items = (await r.json()) as { name: string; size: number; type: string }[];
  return items.filter((i) => i.type === "file" && !i.name.startsWith(".")).map((i) => ({ name: i.name, size: i.size }));
}

export async function listScores(): Promise<ScoreInfo[]> {
  return (await list(SCORES)).filter((i) => SCORE_EXT.test(i.name));
}

export interface InboxItem {
  name: string; // original file name (pdf/image)
  failed: boolean;
}
/** PDFs / images waiting for conversion, plus ones whose conversion failed. */
export async function listInbox(): Promise<InboxItem[]> {
  const all = (await list(INBOX)).map((i) => i.name);
  const failed = new Set(all.filter((n) => n.endsWith(".failed.txt")).map((n) => n.slice(0, -".failed.txt".length)));
  return all.filter((n) => INBOX_EXT.test(n) && !n.endsWith(".failed.txt")).map((name) => ({ name, failed: failed.has(name) }));
}

async function getBytes(dir: string, name: string): Promise<ArrayBuffer> {
  const a = need();
  const r = await gh(a, url(a, dir, name) + ref(a), {
    headers: headers(a, "application/vnd.github.raw+json"),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`下载失败 (${r.status})`);
  return r.arrayBuffer();
}
export const downloadScore = (name: string) => getBytes(SCORES, name);
export async function readFailureLog(name: string): Promise<string> {
  return new TextDecoder().decode(await getBytes(INBOX, name + ".failed.txt"));
}

async function sha(a: Auth, dir: string, name: string): Promise<string | undefined> {
  const r = await gh(a, url(a, dir, name) + ref(a), { headers: headers(a), cache: "no-store" });
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return ((await r.json()) as { sha: string }).sha;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** reading can fail for files that live only in iCloud / another app and are not downloaded to the device yet */
async function readFile(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch {
    throw new Error(`读不到「${file.name}」的内容。如果它在 iCloud 云盘里，请先在“文件”App 里点它让它下载到本机（图标上的云消失），再重新选择上传。`);
  }
}

async function put(dir: string, name: string, data: ArrayBuffer, message: string) {
  const a = need();
  const content = toBase64(data);
  let last: ApiError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await gh(a, url(a, dir, name), {
      method: "PUT",
      headers: headers(a),
      body: JSON.stringify({ message, content, branch: a.branch, sha: await sha(a, dir, name) }),
    });
    if (r.ok) return;
    last = await apiError(r, "保存失败");
    // the branch moved under us (409), a stale sha (422) or a hiccup on GitHub's side: try again
    const retry = r.status === 409 || r.status >= 500 || (r.status === 422 && /sha/i.test(last.detail));
    if (!retry || attempt === 3) break;
    await sleep(700 * attempt);
  }
  throw last!;
}

export interface Uploaded {
  kind: Kind;
  name: string;
}

export type Conflict = "replace" | "keep" | "skip";
/** `kind`: "score" = a score with this name already exists; "convert" = converting this PDF/image would overwrite an existing score */
export type OnConflict = (info: { name: string; existing: string; kind: "score" | "convert" | "queued" }) => Promise<Conflict>;

const stemOf = (n: string) => n.replace(/\.[^.]+$/, "");

async function exists(dir: string, name: string): Promise<boolean> {
  return (await sha(need(), dir, name)) !== undefined;
}

/** "name.ext" -> "name (2).ext", "name (3).ext", ... first one that is free in every given location */
async function freeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  const m = name.match(/^(.*?)(\.[^.]+)$/);
  const [stem, ext] = m ? [m[1], m[2]] : [name, ""];
  for (let i = 2; i < 100; i++) {
    const cand = `${stem} (${i})${ext}`;
    if (!(await taken(cand))) return cand;
  }
  throw new Error("无法生成新的文件名");
}

/**
 * MusicXML / .mxl  -> stored as plain .musicxml in scores/ (editable, e.g. fingering)
 * PDF / image      -> stored in inbox/; a GitHub Action converts it to scores/<name>.musicxml
 * If something with the same name would be overwritten, `onConflict` decides. Returns null when skipped.
 */
export async function uploadScore(file: File, onConflict?: OnConflict): Promise<Uploaded | null> {
  const ask = async (name: string, existing: string, kind: "score" | "convert" | "queued"): Promise<Conflict> =>
    onConflict ? onConflict({ name, existing, kind }) : "replace";

  if (INBOX_EXT.test(file.name)) {
    let name = cleanName(file.name, "inbox");
    if (!name) throw new Error(`文件名不可用：${file.name}`);
    if (file.size > MAX_INBOX_BYTES) throw new Error("PDF / 图片超过 20 MB");
    // the converted result will be scores/<stem>.musicxml: warn before it can overwrite an existing score
    const target = stemOf(name) + ".musicxml";
    const inScores = (await exists(SCORES, target)) ? target : (await exists(SCORES, stemOf(name) + ".xml")) ? stemOf(name) + ".xml" : null;
    const inQueue = (await exists(INBOX, name)) ? name : null;
    if (inScores || inQueue) {
      const choice = await ask(name, (inScores ?? inQueue)!, inQueue ? "queued" : "convert");
      if (choice === "skip") return null;
      if (choice === "keep")
        name = await freeName(name, async (c) => (await exists(INBOX, c)) || (await exists(SCORES, stemOf(c) + ".musicxml")));
    }
    await put(INBOX, name, await readFile(file), `Queue for conversion: ${name}`);
    return { kind: "inbox", name };
  }

  // iPadOS sometimes renames a downloaded .mxl to "x.mxl.zip": it is the same container
  const isZip = /\.zip$/i.test(file.name);
  let raw = isZip ? file.name.replace(/\.zip$/i, "") : file.name;
  if (isZip && !SCORE_EXT.test(raw)) raw += ".mxl";
  let name = cleanName(raw);
  if (!name) throw new Error(`不支持的文件：${file.name}。支持 MusicXML（.musicxml / .xml / .mxl）、PDF 和图片。`);
  let data: ArrayBuffer;
  try {
    data = await readFile(file);
  } catch {
    throw new Error(`读不到文件「${file.name}」。如果它在 iCloud 里，请先在“文件”App 里点一下把它下载到本机，再重新选择。`);
  }
  if (data.byteLength > MAX_BYTES) throw new Error("文件超过 10 MB");
  if (/\.mxl$/i.test(name) || isZip) {
    let xml = "";
    try {
      xml = toMusicXml(data); // unzip so the stored file is readable and editable
    } catch {
      /* handled below */
    }
    if (!looksLikeMusicXml(xml)) throw new Error(`「${file.name}」不是有效的 MusicXML 压缩包（.mxl），文件可能已损坏。请换成 .musicxml 或 .xml 再试。`);
    data = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    name = name.replace(/\.(mxl|musicxml|xml)$/i, ".musicxml");
  } else if (!looksLikeMusicXml(new TextDecoder("utf-8").decode(data))) {
    throw new Error(`「${file.name}」的内容不是 MusicXML（找不到 score-partwise），没有上传。请确认导出的是 MusicXML 格式。`);
  }
  if (await exists(SCORES, name)) {
    const choice = await ask(name, name, "score");
    if (choice === "skip") return null;
    if (choice === "keep") name = await freeName(name, (c) => exists(SCORES, c));
  }
  await put(SCORES, name, data, `Upload score: ${name}`);
  return { kind: "score", name };
}

/** Does this look like a MusicXML document? (so garbage never gets stored as a score) */
export function looksLikeMusicXml(text: string): boolean {
  return /<score-(partwise|timewise)[\s>]/.test(text.slice(0, 200_000));
}

/** Overwrite an existing score with edited MusicXML text (e.g. after adding fingering). */
export async function saveScoreText(name: string, xml: string, message: string) {
  const n = cleanName(name);
  if (!n) throw new Error("文件名不可用");
  await put(SCORES, n, new TextEncoder().encode(xml).buffer as ArrayBuffer, message);
}

async function remove(dir: string, name: string, message: string) {
  const a = need();
  const s = await sha(a, dir, name);
  if (!s) return;
  const r = await gh(a, url(a, dir, name), {
    method: "DELETE",
    headers: headers(a),
    body: JSON.stringify({ message, sha: s, branch: a.branch }),
  });
  if (!r.ok) throw await apiError(r, "删除失败");
}
export const deleteScore = (name: string) => remove(SCORES, name, `Delete score: ${name}`);
export async function deleteInbox(name: string) {
  await remove(INBOX, name + ".failed.txt", `Clear failure note: ${name}`);
  await remove(INBOX, name + ".retry.txt", `Clear retry marker: ${name}`);
  await remove(INBOX, name, `Remove from queue: ${name}`);
}

/** Run the conversion again: clears the failure note and writes a marker file that triggers the workflow. */
export async function retryConversion(name: string) {
  await remove(INBOX, name + ".failed.txt", `Retry conversion: ${name}`);
  await put(INBOX, name + ".retry.txt", new TextEncoder().encode(String(Date.now())).buffer as ArrayBuffer, `Retry conversion: ${name}`);
}

const sinceCache = new Map<string, number>();
export const forgetSince = (name: string) => void sinceCache.delete(name);
export async function queuedSince(name: string): Promise<number | null> {
  const hit = sinceCache.get(name);
  if (hit) return hit;
  const a = need();
  const lastCommit = async (path: string): Promise<number | null> => {
    const r = await gh(a, `https://api.github.com/repos/${a.repo}/commits?path=${encodeURIComponent(path)}&per_page=1&sha=${encodeURIComponent(a.branch ?? "main")}`, {
      headers: headers(a),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = ((await r.json()) as { commit?: { committer?: { date?: string } } }[])[0]?.commit?.committer?.date;
    const ts = d ? Date.parse(d) : NaN;
    return Number.isFinite(ts) ? ts : null;
  };
  // the later of "uploaded" and "retried" (the retry marker has its own path)
  const times = [await lastCommit(`${INBOX}/${name}`), await lastCommit(`${INBOX}/${name}.retry.txt`)].filter((t): t is number => t !== null);
  if (!times.length) return null;
  const ts = Math.max(...times);
  sinceCache.set(name, ts);
  return ts;
}

/** Four-hand pieces made of two separately uploaded files (stored in the private repo as config/pairs.json). */
export interface Pair {
  name: string;
  a: string; // file of player A (upper / Primo)
  b: string; // file of player B (lower / Secondo)
}
const CONFIG = "config";
const validPair = (p: unknown): p is Pair => {
  const q = p as Pair;
  return !!q && typeof q.a === "string" && typeof q.b === "string" && typeof q.name === "string";
};
export async function readPairs(): Promise<Pair[]> {
  const a = need();
  const r = await gh(a, url(a, CONFIG, "pairs.json") + ref(a), { headers: headers(a, "application/vnd.github.raw+json"), cache: "no-store" });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`读取四手联弹配置失败 (${r.status})`);
  try {
    const j = JSON.parse(await r.text()) as { pairs?: unknown[] };
    return Array.isArray(j.pairs) ? j.pairs.filter(validPair) : [];
  } catch {
    return [];
  }
}
export async function writePairs(pairs: Pair[]) {
  const text = JSON.stringify({ pairs }, null, 2) + "\n";
  await put(CONFIG, "pairs.json", new TextEncoder().encode(text).buffer as ArrayBuffer, "Update four-hand pairs");
}
export const downloadAny = (name: string) => downloadScore(name);

/** Rename a score: GitHub has no rename in the contents API, so copy to the new name and delete the old one. */
export async function renameScore(old: string, base: string): Promise<string> {
  const ext = old.match(/\.[^.]+$/)?.[0] ?? ".musicxml";
  const name = cleanName(base.trim().replace(/\.(musicxml|xml|mxl)$/i, "") + ext);
  if (!name) throw new Error("这个名称不能用（不要包含 / \\ : * ? \" < > |）");
  if (name === old) return old;
  if (await exists(SCORES, name)) throw new Error("已经有同名的乐谱了，请换一个名字");
  const data = await getBytes(SCORES, old);
  await put(SCORES, name, data, `Rename score: ${old} -> ${name}`);
  await remove(SCORES, old, `Rename score: ${old} -> ${name}`);
  return name;
}

/** Write a score from text (used for the built-in samples); replaces a file of the same name. */
export async function putScoreText(name: string, xml: string, message: string) {
  const n = cleanName(name);
  if (!n) throw new Error("文件名不可用");
  await put(SCORES, n, new TextEncoder().encode(xml).buffer as ArrayBuffer, message);
  return n;
}
