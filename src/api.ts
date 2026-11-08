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
const DIR = "scores";
const EXT = /\.(musicxml|xml|mxl)$/i;
const MAX_BYTES = 10 * 1024 * 1024;

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

function headers(a: Auth, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Authorization: `Bearer ${a.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh(a: Auth, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, init);
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
function url(a: Auth, name?: string) {
  const p = name ? `${DIR}/${encodeURIComponent(name)}` : DIR;
  return `https://api.github.com/repos/${a.repo}/contents/${p}`;
}
const ref = (a: Auth) => `?ref=${encodeURIComponent(a.branch ?? "main")}`;

export function cleanName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const n = raw.normalize("NFC").replace(/[\\/\u0000-\u001f<>:"|?*]/g, "_").trim();
  return !n || n.startsWith(".") || n.length > 120 || !EXT.test(n) ? null : n;
}

export async function listScores(): Promise<ScoreInfo[]> {
  const a = need();
  const r = await gh(a, url(a) + ref(a), { headers: headers(a), cache: "no-store" });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`读取列表失败 (${r.status})`);
  const items = (await r.json()) as { name: string; size: number; type: string }[];
  return items.filter((i) => i.type === "file" && EXT.test(i.name)).map((i) => ({ name: i.name, size: i.size }));
}

export async function downloadScore(name: string): Promise<ArrayBuffer> {
  const a = need();
  const r = await gh(a, url(a, name) + ref(a), {
    headers: headers(a, "application/vnd.github.raw+json"),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`下载失败 (${r.status})`);
  return r.arrayBuffer();
}

async function sha(a: Auth, name: string): Promise<string | undefined> {
  const r = await gh(a, url(a, name) + ref(a), { headers: headers(a), cache: "no-store" });
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

export async function uploadScore(file: File): Promise<string> {
  const a = need();
  const name = cleanName(file.name);
  if (!name) throw new Error(`不支持的文件：${file.name}（请用 .musicxml / .xml / .mxl）`);
  if (file.size > MAX_BYTES) throw new Error("文件超过 10 MB");
  const r = await gh(a, url(a, name), {
    method: "PUT",
    headers: headers(a),
    body: JSON.stringify({
      message: `Upload score: ${name}`,
      content: toBase64(await file.arrayBuffer()),
      branch: a.branch,
      sha: await sha(a, name),
    }),
  });
  if (!r.ok) throw new Error(`上传失败 (${r.status})`);
  return name;
}

export async function deleteScore(name: string): Promise<void> {
  const a = need();
  const s = await sha(a, name);
  if (!s) return;
  const r = await gh(a, url(a, name), {
    method: "DELETE",
    headers: headers(a),
    body: JSON.stringify({ message: `Delete score: ${name}`, sha: s, branch: a.branch }),
  });
  if (!r.ok) throw new Error(`删除失败 (${r.status})`);
}
