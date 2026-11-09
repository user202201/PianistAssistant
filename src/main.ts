import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import QRCode from "qrcode";
import type { Smplr } from "smplr";
import * as api from "./api";
import { SOUNDS, createSynth, unlockIOSAudio } from "./audio";
import { icon as ic } from "./icons";
import { FingerGroup, FingerTools, type FingerApi } from "./fingerui";
import { Player } from "./player";
import { applyExpression } from "./expression";
import { defaultPairName, pairLabels, roleOf, suggestPairs } from "./pairs";
import { extractScore, mergeScores, toMusicXml } from "./score";
import odePrimo from "./samples/Ode_Primo.musicxml?raw";
import odeSecondo from "./samples/Ode_Secondo.musicxml?raw";
import { clearNew, clearQueued, getRecent, isNew, loadSettings, markNew, markQueued, pushRecent, queuedAt, renameRecent, saveSettings } from "./settings";

const app = document.getElementById("app")!;
const settings = loadSettings();
settings.volume = 1; // loudness is the iPad's own volume; the app always plays at full level

/** light / dark: the system decides unless the user picked one */
function applyTheme() {
  if (settings.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
applyTheme();

// ---------- tiny helpers ----------
/** a one-line text that glides back and forth when it is too long for its box (armed by armMarquee once it is on screen) */
function marquee(text: string): HTMLElement {
  return h("span", { class: "mq", title: text }, h("span", { class: "mqi" }, text));
}
function armMarquee() {
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>(".mq").forEach((m) => {
      const i = m.firstElementChild as HTMLElement;
      const over = i.scrollWidth - m.clientWidth;
      if (over > 2 && m.clientWidth > 0) {
        m.style.setProperty("--d", `-${over + 6}px`);
        m.style.setProperty("--t", `${Math.max(4, (over / 28) * 1).toFixed(1)}s`);
        m.classList.add("glide");
      } else m.classList.remove("glide");
    });
  });
}
window.addEventListener("resize", () => armMarquee());

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (v !== undefined && v !== false) (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}
const toast = (msg: string, ms = 3500) => {
  const t = h("div", { class: "toast" }, msg);
  t.addEventListener("click", () => t.remove());
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts" });
    document.body.append(box);
  }
  box.append(t); // several messages stack instead of lying on top of each other
  setTimeout(() => t.remove(), ms);
  return () => t.remove(); // dismiss early (e.g. a "working…" message once the work is done)
};
const displayName = (n: string) => n.replace(/\.(musicxml|xml|mxl)$/i, "");

// ---------- audio (shared) ----------
let ctx: AudioContext | null = null;
const instruments = new Map<string, Smplr>();
function audioCtx(): AudioContext {
  return (ctx ??= new AudioContext({ latencyHint: "interactive" }));
}
async function getInstrument(id: string, onStatus: (s: string) => void): Promise<Smplr> {
  const hit = instruments.get(id);
  if (hit) return hit;
  const preset = SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
  onStatus("音色加载中…");
  try {
    const inst = preset.create(audioCtx());
    await Promise.race([
      inst.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 45000)),
    ]);
    instruments.set(preset.id, inst);
    onStatus("");
    return inst;
  } catch {
    toast("音色下载失败，暂用内置合成音色（联网后重新打开即可）");
    onStatus("");
    return createSynth(audioCtx()); // not cached, so the next open retries the download
  }
}

// ---------- login ----------
function renderLogin(message = "") {
  cleanup();
  const token = h("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off" });
  const repo = h("input", { type: "text", value: "user202201/PianistScores", autocomplete: "off" });
  const err = h("p", { class: "error" }, message);
  const remember = h("input", { type: "checkbox", checked: true });
  const btn = h("button", { class: "primary" }, "登录");
  const submit = async () => {
    btn.disabled = true;
    err.textContent = "";
    try {
      await api.login(token.value, repo.value, remember.checked);
      route();
    } catch (e) {
      err.textContent = (e as Error).message;
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", submit);
  token.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  app.replaceChildren(
    h(
      "div",
      { class: "login" },
      h("h1", { class: "brand big" }, h("span", { class: "logo" }, ic("note", 24)), "Pianist Assistant"),
      h("p", { class: "muted" }, "琴谱存放在你的私有 GitHub 仓库中，需要访问令牌才能查看。"),
      h("label", {}, "琴谱仓库", repo),
      h("label", {}, "GitHub 访问令牌（也可粘贴“登录链接”）", token),
      h("label", { class: "inline" }, remember, "保持登录（取消勾选则关闭页面后需重新登录，适合公用设备）"),
      btn,
      err,
      h(
        "details",
        {},
        h("summary", {}, "第一次使用？怎么获取令牌"),
        h(
          "ol",
          {},
          h("li", {}, "在 GitHub 新建一个", h("b", {}, "私有"), "仓库（例如 PianistScores）。"),
          h(
            "li",
            {},
            "打开 ",
            h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "创建 Fine-grained token"),
            "：Repository access 选 Only select repositories → 只选该私有仓库；Permissions → Contents 选 Read and write。",
          ),
          h("li", {}, "复制生成的令牌粘贴到上面。令牌只保存在这台设备的浏览器里，可随时在 GitHub 撤销。"),
          h("li", {}, "已有一台登录好的设备？在它的“设置 → 登录与设备”里用手机扫码，或复制登录链接粘贴到上面，就不用重新生成令牌。"),
        ),
      ),
    ),
  );
  token.focus();
}

// ---------- settings dialog ----------
function openSettings(onSound?: () => void, onLayout?: () => void) {
  const dlg = h("dialog", { class: "dlg" });
  const sound = h("select", {}, ...SOUNDS.map((s) => h("option", { value: s.id, selected: s.id === settings.sound }, s.label)));
  sound.addEventListener("change", () => {
    settings.sound = sound.value;
    saveSettings(settings);
    onSound?.();
  });
  const scrollSelect = h(
    "select",
    {},
    h("option", { value: "page", selected: settings.scrollMode === "page" }, "整屏翻页：画面不动，换行时一次翻到位（推荐，不晕）"),
    h("option", { value: "smooth", selected: settings.scrollMode === "smooth" }, "平滑滚动：画面跟着光标缓缓移动"),
    h("option", { value: "off", selected: settings.scrollMode === "off" }, "不滚动：自己翻"),
  );
  scrollSelect.addEventListener("change", () => {
    settings.scrollMode = scrollSelect.value as typeof settings.scrollMode;
    saveSettings(settings);
    onViewSetting();
  });
  const hlBox = h("input", { type: "checkbox", checked: settings.lineHighlight });
  hlBox.addEventListener("change", () => {
    settings.lineHighlight = hlBox.checked;
    saveSettings(settings);
    onViewSetting();
  });
  const splitBox = h("input", { type: "checkbox", checked: settings.splitView });
  splitBox.addEventListener("change", () => {
    settings.splitView = splitBox.checked;
    saveSettings(settings);
    dlg.close();
    onLayout?.();
  });
  const peekBox = h("input", { type: "checkbox", checked: settings.peekNext });
  peekBox.addEventListener("change", () => {
    settings.peekNext = peekBox.checked;
    saveSettings(settings);
    onViewSetting();
  });
  const themeBtns = (["system", "light", "dark"] as const).map((t) =>
    h("button", { class: "seg" + (settings.theme === t ? " on" : ""), onclick: () => {
      settings.theme = t;
      saveSettings(settings);
      applyTheme();
      themeBtns.forEach((b, i) => b.classList.toggle("on", (["system", "light", "dark"] as const)[i] === t));
    } }, t === "system" ? "跟随系统" : t === "light" ? "浅色" : "深色"),
  );
  const a = api.getAuth();
  dlg.append(
    // the heading takes the initial focus: on iPad focusing a drop-down opens its list straight away
    h("h2", { tabIndex: -1, autofocus: true }, "设置"),
    h("h3", {}, "声音"),
    h("label", {}, "钢琴音色", sound),
    h("h3", {}, "外观"),
    h("div", { class: "group wide" }, ...themeBtns),
    h("h3", {}, "乐谱显示"),
    h("label", {}, "画面怎么跟着播放走", scrollSelect),
    h("label", { class: "inline" }, "高亮正在弹的这一行", hlBox),
    h("label", { class: "inline" }, "提前显示下一行（浮在下方，翻页后消失）", peekBox),
    ...(onLayout ? [h("label", { class: "inline" }, "多声部（四手联弹）分屏显示", splitBox)] : []),
    h("h3", {}, "示例"),
    h("button", { class: "rowbtn", id: "add-samples", onclick: () => { dlg.close(); void addSamples(); } }, ic("note", 20), "添加示例乐谱（欢乐颂，含四手联弹）"),
    h("h3", {}, "应用"),
    h("button", { class: "rowbtn", id: "check-update", onclick: () => void checkUpdate() }, ic("refresh", 20), "检查更新"),
    h("button", { class: "rowbtn", id: "hard-refresh", title: "一直显示旧版本时使用，不会退出登录", onclick: () => void hardRefresh() }, ic("trash", 20), "强制刷新（清除缓存）"),
    h("p", { class: "muted small ver" }, `当前版本 ${__BUILD__}`),
    h("h3", {}, "登录与设备"),
    h(
      "p",
      { class: "muted" },
      a ? `本设备：${a.user ?? "GitHub"} · ${a.repo} · ${api.isPersistent() ? "保持登录" : "仅本次"}` : "",
    ),
    h("button", { class: "rowbtn", id: "qr-btn", onclick: () => showQr() }, ic("qr", 20), "手机扫码登录"),
    h("button", { class: "rowbtn", id: "copy-link", onclick: async () => {
      const cur = api.getAuth();
      if (!cur) return;
      try { await navigator.clipboard.writeText(api.makeLoginLink(cur)); toast("登录链接已复制，粘贴到另一台设备的登录页即可"); }
      catch { toast("复制失败，请改用扫码"); }
    } }, ic("hand", 20), "复制登录链接"),
    h(
      "p",
      { class: "muted small" },
      "所有设备共用同一个令牌，所以无法单独移除某一台。如果设备丢失或怀疑泄露：到 ",
      h("a", { href: "https://github.com/settings/personal-access-tokens", target: "_blank", rel: "noopener" }, "GitHub 令牌管理"),
      " 删除令牌，所有设备会立即失效，再生成新令牌重新登录即可。",
    ),
    h(
      "div",
      { class: "row" },
      h("button", { class: "danger", onclick: () => { api.logout(); dlg.close(); renderLogin(); } }, "退出本设备"),
      h("div", { class: "grow" }),
      h("button", { class: "primary", onclick: () => dlg.close() }, "完成"),
    ),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur(); // no focus ring on the first control
}

// ---------- QR sign-in for another device ----------
async function showQr() {
  const a = api.getAuth();
  if (!a) return;
  const link = api.makeLoginLink(a);
  const img = h("img", { class: "qr", alt: "登录二维码", src: await QRCode.toDataURL(link, { margin: 2, width: 280, errorCorrectionLevel: "M" }) });
  img.dataset.link = link;
  const dlg = h("dialog", { class: "dlg center" });
  const left = h("span", {}, "60");
  let n = 60;
  const timer = window.setInterval(() => {
    n--;
    left.textContent = String(n);
    if (n <= 0) dlg.close();
  }, 1000);
  dlg.append(
    h("h2", {}, "用手机扫描登录"),
    h("p", { class: "muted" }, "用另一台设备的相机扫描下面的二维码，会自动打开并登录。"),
    img,
    h("p", { class: "error small" }, "二维码等同于你的登录钥匙，请勿截图或让他人拍到。"),
    h("p", { class: "muted small" }, h("span", {}, "将在 "), left, " 秒后自动关闭"),
    h("button", { class: "primary", onclick: () => dlg.close() }, "关闭"),
  );
  dlg.addEventListener("close", () => { clearInterval(timer); dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur(); // no focus ring on the first control
  }

// ---------- what to do with an uploaded PDF ----------
function askPdfMode(name: string): Promise<"convert" | "keep" | "both" | "cancel"> {
  return new Promise((resolve) => {
    let answer: "convert" | "keep" | "both" | "cancel" = "cancel";
    const pick = (a: typeof answer) => () => { answer = a; dlg.close(); };
    const dlg = h(
      "dialog",
      { class: "dlg center" },
      h("h2", {}, "这份 PDF 怎么处理？"),
      h("p", { class: "small" }, name),
      h("p", { class: "muted small" }, "转换成可播放乐谱靠自动识别（需要几分钟），识别结果不一定准，常有音符、调号或节奏出错。保留 PDF 则原样存放，可以像图片谱一样直接看，但不能播放、也没有指法。"),
      h(
        "div",
        { class: "row wrap stack" },
        h("button", { class: "primary", onclick: pick("both") }, "两个都要（转换并保留 PDF）"),
        h("button", { onclick: pick("keep") }, "只保留 PDF，当作乐谱查看"),
        h("button", { onclick: pick("convert") }, "只转换成可播放乐谱"),
        h("button", { onclick: pick("cancel") }, "取消"),
      ),
    );
    dlg.addEventListener("close", () => { dlg.remove(); resolve(answer); });
    document.body.append(dlg);
    dlg.showModal();
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

// ---------- same-name upload ----------
function askConflict(info: { name: string; existing: string; kind: "score" | "convert" | "queued" }): Promise<api.Conflict> {
  return new Promise((resolve) => {
    let answer: api.Conflict = "skip";
    const msg =
      info.kind === "queued"
        ? `「${info.existing}」已经在转换队列中（转换通常需要 3–10 分钟），不需要重复上传。`
        : info.kind === "convert"
          ? `已有乐谱「${displayName(info.existing)}」。这份 PDF / 图片转换完成后会覆盖它（包括你在其中标注的指法）。`
          : `已有同名文件「${displayName(info.existing)}」。`;
    const done = (a: api.Conflict) => () => {
      answer = a;
      dlg.close();
    };
    const dlg = h(
      "dialog",
      { class: "dlg center" },
      h("h2", {}, "文件名重复"),
      h("p", {}, msg),
      h("p", { class: "muted small" }, "替换：用新文件覆盖旧的（旧版本仍可在 GitHub 历史里找回）。保留两份：新文件自动改名，比如“名称 (2)”。"),
      h(
        "div",
        { class: "row wrap stack" },
        ...(info.kind === "queued"
          ? [h("button", { class: "primary", onclick: done("skip") }, "好的，等它转换"), h("button", { onclick: done("replace") }, "重新上传"), h("button", { onclick: done("keep") }, "另存一份")]
          : [h("button", { class: "primary", onclick: done("keep") }, "保留两份"), h("button", { class: "danger", onclick: done("replace") }, "替换"), h("button", { onclick: done("skip") }, "取消")]),
      ),
    );
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(answer);
    });
    document.body.append(dlg);
    dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur(); // no focus ring on the first control
  });
}

// ---------- four hands from two files ----------
const dismissedKey = "pianist.pair.dismissed";
const getDismissed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissedKey) ?? "[]"));
  } catch {
    return new Set();
  }
};
const dismissPair = (a: string, b: string) => {
  const d = getDismissed();
  d.add(`${a}|${b}`);
  try {
    localStorage.setItem(dismissedKey, JSON.stringify([...d]));
  } catch {
    /* private mode */
  }
};
const duetHash = (p: { a: string; b: string }) => `#/duet/${encodeURIComponent(p.a)}/${encodeURIComponent(p.b)}`;
const pairKey = (p: { a: string; b: string }) => `pair:${p.a}|${p.b}`;

/** Choose which file is A (upper / Primo) and which is B (lower / Secondo), and the name of the piece. */
function openPairDialog(opts: {
  scores: string[];
  a?: string;
  b?: string;
  name?: string;
  title: string;
  intro?: string;
  okLabel: string;
  cancelLabel?: string;
}): Promise<{ a: string; b: string; name: string } | null> {
  return new Promise((resolve) => {
    let result: { a: string; b: string; name: string } | null = null;
    const options = (sel?: string) => opts.scores.map((n) => h("option", { value: n, selected: n === sel }, displayName(n)));
    const selA = h("select", {}, ...options(opts.a));
    const selB = h("select", {}, ...options(opts.b ?? opts.scores.find((n) => n !== opts.a)));
    const nameIn = h("input", { type: "text", value: opts.name ?? "", placeholder: "这首歌的名字" });
    const err = h("p", { class: "error small" }, "");
    const swap = h("button", { class: "icon", title: "交换 A / B", onclick: () => { const t = selA.value; selA.value = selB.value; selB.value = t; } }, ic("refresh", 20));
    const touched = { name: !!opts.name };
    nameIn.addEventListener("input", () => (touched.name = true));
    const autoName = () => { if (!touched.name) nameIn.value = defaultPairName(selA.value, selB.value); };
    selA.addEventListener("change", autoName);
    selB.addEventListener("change", autoName);
    if (!opts.name) autoName();
    const dlg = h(
      "dialog",
      { class: "dlg" },
      h("h2", { tabIndex: -1, autofocus: true }, opts.title),
      opts.intro ? h("p", { class: "muted" }, opts.intro) : null,
      h("label", {}, "A 声部（上面一屏，Primo / 高音）", selA),
      h("div", { class: "row", style: "justify-content:center" }, swap, h("span", { class: "muted small" }, "交换 A / B")),
      h("label", {}, "B 声部（下面一屏，Secondo / 低音）", selB),
      h("label", {}, "名称", nameIn),
      err,
      h(
        "div",
        { class: "row wrap" },
        h("button", { onclick: () => dlg.close() }, opts.cancelLabel ?? "取消"),
        h("div", { class: "grow" }),
        h("button", { class: "primary", onclick: () => {
          if (selA.value === selB.value) { err.textContent = "A 和 B 不能是同一个文件"; return; }
          result = { a: selA.value, b: selB.value, name: nameIn.value.trim() || defaultPairName(selA.value, selB.value) };
          dlg.close();
        } }, opts.okLabel),
      ),
    );
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Built-in test pieces: "Ode to Joy" as two four-hand parts (already paired) so the four-hand mode can be tried at once. */
async function addSamples() {
  const a = "欢乐颂示例 Primo.musicxml";
  const b = "欢乐颂示例 Secondo.musicxml";
  try {
    toast("正在添加示例乐谱…", 6000);
    await api.putScoreText(a, odePrimo, "Add sample: Ode to Joy (Primo)");
    await api.putScoreText(b, odeSecondo, "Add sample: Ode to Joy (Secondo)");
    const ps = await api.readPairs();
    if (!ps.some((p) => p.a === a && p.b === b)) await api.writePairs([...ps, { name: "欢乐颂（四手联弹示例）", a, b }]);
    toast("已添加示例：欢乐颂（四手联弹）", 5000);
    refreshHome?.();
  } catch (e) {
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    showError("添加示例失败", e);
  }
}

/** A failure the user can read, with what to try, and copy to send to someone. */
function showError(title: string, e: unknown) {
  const err = e as Error & { status?: number };
  const msg = err.message || String(e);
  const hint =
    err.status === 403 ? "GitHub 拒绝了请求：可能是令牌没有“Contents: Read and write”权限，或短时间内操作太频繁，等一两分钟再试。"
    : err.status === 404 ? "找不到仓库或目录：检查令牌是否只授权了正确的私有仓库，以及仓库名有没有改过。"
    : err.status === 409 || err.status === 422 ? "GitHub 上的文件刚刚被别处改过，已自动重试仍未成功：请刷新后再试一次。"
    : err.status === 413 ? "文件太大。"
    : err.status === 0 ? "请检查 iPad 的网络，或公司网络是否拦截了 api.github.com。"
    : "";
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", { tabIndex: -1, autofocus: true }, title),
    h("pre", { class: "log" }, msg),
    hint ? h("p", { class: "muted" }, hint) : null,
    h(
      "div",
      { class: "row wrap" },
      h("button", { onclick: async () => { try { await navigator.clipboard.writeText(`${title}\n${msg}`); toast("已复制"); } catch { toast("复制失败"); } } }, "复制错误信息"),
      h("div", { class: "grow" }),
      h("button", { class: "primary", onclick: () => dlg.close() }, "知道了"),
    ),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** Ask for one line of text (rename). */
function askText(title: string, value: string, okLabel = "好"): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h("input", { type: "text", value });
    const dlg = h(
      "dialog",
      { class: "dlg" },
      h("h2", { tabIndex: -1, autofocus: true }, title),
      input,
      h("div", { class: "row wrap", style: "margin-top:14px" }, h("button", { onclick: () => dlg.close() }, "取消"), h("div", { class: "grow" }), h("button", { class: "primary", onclick: () => { result = input.value.trim() || null; dlg.close(); } }, okLabel)),
    );
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { result = input.value.trim() || null; dlg.close(); } });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Small action sheet of a card. */
function openCardMenu(title: string, actions: { label: string; icon: string; danger?: boolean; run: () => void }[]) {
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", { tabIndex: -1, autofocus: true }, title),
    ...actions.map((a) => h("button", { class: "rowbtn" + (a.danger ? " danger" : ""), onclick: () => { dlg.close(); a.run(); } }, ic(a.icon, 20), a.label)),
    h("div", { class: "row" }, h("div", { class: "grow" }), h("button", { class: "primary", onclick: () => dlg.close() }, "关闭")),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- home ----------
async function renderHome() {
  cleanup();
  const token = renderSeq;
  // a section that can be folded away (the state is remembered); `scroll` = long list with its own scrollbar
  const fold = (key: string, title: string, body: HTMLElement[], scroll: boolean) => {
    const k = `pianist.fold.${key}`;
    let closed = false;
    try { closed = localStorage.getItem(k) === "1"; } catch { /* ignore */ }
    const count = h("span", { class: "foldcount" });
    const bodyEl = h("div", { class: "foldbody" + (scroll ? " scroll" : "") }, ...body);
    const sec = h("section", { class: "fold" + (closed ? " closed" : "") });
    const head = h("button", { class: "foldhead", "aria-expanded": String(!closed), onclick: () => {
      closed = !closed;
      sec.classList.toggle("closed", closed);
      head.setAttribute("aria-expanded", String(!closed));
      try { localStorage.setItem(k, closed ? "1" : "0"); } catch { /* ignore */ }
    } }, ic("chevron-down", 16), h("span", {}, title), count);
    sec.append(head, bodyEl);
    return { sec, count };
  };
  const list = h("div", { class: "grid two" });
  const pdfList = h("div", { class: "grid two" });
  const pdfFold = fold("pdf", "PDF 乐谱", [h("p", { class: "muted small" }, "原样保存的 PDF，只能查看，不能播放。"), pdfList], true);
  const pdfSec = pdfFold.sec;
  pdfSec.hidden = true;
  const recent = h("div", { class: "grid two" });
  const recentFold = fold("recent", "最近打开", [recent], false);
  const recentSec = recentFold.sec;
  const queue = h("div", { class: "grid wide" });
  const banner = h(
    "div",
    { class: "banner", hidden: true },
    h("div", { class: "spin" }),
    h(
      "div",
      {},
      h("b", {}, "正在转换，请耐心等待，不要重复上传"),
      h("div", { class: "small" }, "通常需要 3–10 分钟。完成后会自动出现在“全部琴谱”里，并弹出提示（请保持此页面打开）。"),
      h("a", { href: `https://github.com/${api.getAuth()?.repo ?? ""}/actions`, target: "_blank", rel: "noopener" }, "在 GitHub 查看转换进度 ↗"),
    ),
  );
  const stalledBanner = h(
    "div",
    { class: "banner warn", hidden: true },
    h("div", { class: "warnicon" }, ic("warning", 28)),
    h(
      "div",
      {},
      h("b", {}, "转换比平时久，可能已经卡住"),
      h("div", { class: "small" }, "正常几分钟就会完成。可以点卡片上的 ↻ 重试，或到 GitHub 看运行日志找原因。"),
      h("a", { href: `https://github.com/${api.getAuth()?.repo ?? ""}/actions`, target: "_blank", rel: "noopener" }, "在 GitHub 查看转换进度 ↗"),
    ),
  );
  const queueSec = h(
    "section",
    { hidden: true },
    h("h2", {}, "PDF / 图片转换"),
    banner,
    stalledBanner,
    queue,
    h("p", { class: "muted small" }, "转换由私有琴谱仓库里的 GitHub 自动任务完成，通常需要几分钟。识别结果可能有错，请打开后核对，必要时在 MuseScore 里修改。"),
  );
  const status = h("p", { class: "muted" }, "加载中…");
  const allFold = fold("all", "全部琴谱", [status, list], true);
  let pairs: api.Pair[] = [];
  let allScores: string[] = [];
  const suggest = h("div", { class: "suggest" });
  const savePairs = async (next: api.Pair[]) => {
    try {
      const adding = next.length > pairs.length;
      const closeBusy = toast(adding ? "正在合成四手联弹…稍等片刻，它会出现在列表里" : "正在保存…", 20000);
      try {
        await api.writePairs(next);
      } finally {
        closeBusy();
      }
      pairs = next;
      if (adding) toast(`✅ 已合成四手联弹「${next[next.length - 1].name}」，在列表里（带蓝色标记的那张）`, 6000);
      void load();
    } catch (e) {
      if (e instanceof api.AuthExpired) return void renderLogin(e.message);
      toast(`保存失败：${(e as Error).message}`);
    }
  };
  const file = h("input", { type: "file", accept: ".musicxml,.xml,.mxl,.zip,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,application/pdf,image/*,application/zip,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,text/xml", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    const stored: string[] = [];
    for (const f of Array.from(file.files ?? [])) {
      try {
        let mode: "convert" | "keep" | "both" = "convert";
        if (/\.pdf$/i.test(f.name)) {
          const a = await askPdfMode(f.name);
          if (a === "cancel") { toast(`已取消：${f.name}`); continue; }
          mode = a;
        }
        toast(`上传中：${f.name}`);
        if (mode !== "convert") {
          const kept = await api.storePdf(f, askConflict);
          toast(kept ? `已保存 PDF：${kept}（在下面的“PDF 乐谱”里）` : `已跳过：${f.name}`);
          if (mode === "keep") continue;
        }
        const up = await api.uploadScore(f, askConflict);
        if (!up) toast(`已跳过：${f.name}`);
        else if (up.kind === "inbox") {
          optimistic.set(up.name, Date.now());
          markQueued(up.name);
          toast(`已加入转换队列：${up.name}`);
          prevPending.add(up.name);
        } else {
          toast(`已上传：${up.name}`);
          stored.push(up.name);
        }
      } catch (e) {
        if (e instanceof api.AuthExpired) return renderLogin(e.message);
        showError(`上传失败：${f.name}`, e);
      }
    }
    file.value = "";
    await load();
    // two score files picked together: is it one four-hand piece (a part per file)?
    if (stored.length === 2) {
      const ra = roleOf(stored[0]);
      const rb = roleOf(stored[1]);
      const swapped = !!(ra && rb && ra.role === "B" && rb.role === "A");
      const [a, b] = swapped ? [stored[1], stored[0]] : [stored[0], stored[1]];
      const r = await openPairDialog({
        scores: allScores,
        a, b,
        title: "这是一首四手联弹吗？",
        intro: "你一次上传了两个文件。如果它们是同一首歌里两个人弹的部分，合成后可以分屏一起练习。",
        okLabel: "合成四手联弹",
        cancelLabel: "不是，分开保存",
      });
      if (r) await savePairs([...pairs, r]);
    }
  });

  app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("h1", { class: "brand" }, h("span", { class: "logo" }, ic("note", 20)), "我的琴谱"),
      h("div", { class: "grow" }),
      h("button", { class: "icon", title: "刷新列表并检查更新", onclick: () => { void load(); void checkUpdate(true); } }, ic("refresh")),
      h("button", { class: "primary", onclick: () => file.click() }, ic("plus", 20), "上传琴谱"),
      h("button", { class: "icon", onclick: () => openSettings(), title: "设置" }, ic("sliders")),
    ),
    file,
    h("main", { class: "home" }, queueSec, suggest, recentSec, allFold.sec, pdfSec),
  );

  const deleteAction = (label: string, run: () => Promise<void>) => ({
    label,
    icon: "trash",
    danger: true,
    run: async () => {
      try {
        await run();
        void load();
      } catch (e) {
        toast((e as Error).message);
      }
    },
  });
  const pairCard = (p: api.Pair) => {
    return h(
      "div",
      { class: "card pair" },
      h("button", { class: "open", onclick: () => (location.hash = duetHash(p)) }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(p.name)))),
      h("button", { class: "del", title: "更多", onclick: () => openCardMenu(p.name, [
        { label: "重命名…", icon: "pencil", run: async () => {
          const v = await askText("重命名这首四手联弹", p.name, "保存");
          if (v && v !== p.name) void savePairs(pairs.map((q) => (q === p ? { ...q, name: v } : q)));
        } },
        { label: "交换 A / B 声部", icon: "refresh", run: () => void savePairs(pairs.map((q) => (q === p ? { ...q, a: q.b, b: q.a } : q))) },
        { label: "重新选择 A / B 文件…", icon: "note", run: async () => {
          const r = await openPairDialog({ scores: allScores, a: p.a, b: p.b, name: p.name, title: "修改四手联弹", okLabel: "保存" });
          if (r) void savePairs(pairs.map((q) => (q === p ? r : q)));
        } },
        { label: "取消关联（两个文件各自保留）", icon: "x", run: () => void savePairs(pairs.filter((q) => q !== p)) },
        deleteAction("删除这首四手联弹（两个文件都会删除）", async () => {
          if (!confirm(`删除四手联弹「${p.name}」？两个文件都会被删除。`)) return;
          await api.writePairs(pairs.filter((q) => q !== p));
          await api.deleteScore(p.a);
          await api.deleteScore(p.b);
        }),
      ]) }, ic("chevron-down", 20)),
    );
  };
  const pdfCard = (name: string) =>
    h(
      "div",
      { class: "card pdf" },
      h("button", { class: "open", onclick: () => (location.hash = `#/pdf/${encodeURIComponent(name)}`) }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(name.replace(/\.pdf$/i, ""))))),
      h("button", { class: "del", title: "更多", onclick: () => openCardMenu(name.replace(/\.pdf$/i, ""), [
        { label: "转换成可播放乐谱（识别可能不准）", icon: "refresh", run: async () => {
          try {
            const n = await api.convertStoredPdf(name);
            optimistic.set(n, Date.now());
            markQueued(n);
            prevPending.add(n);
            toast(`已加入转换队列：${n}`);
            void load();
          } catch (e) {
            showError("无法转换", e);
          }
        } },
        deleteAction("删除这份 PDF", async () => {
          if (!confirm(`删除 PDF「${name}」？`)) return;
          await api.deletePdf(name);
        }),
      ]) }, ic("chevron-down", 18)),
    );
  const partOf = (name: string) => pairs.filter((p) => p.a === name || p.b === name);
  const card = (name: string, withMenu = false) =>
    h(
      "div",
      { class: "card" },
      h("button", { class: `open${isNew(name) ? " isnew" : ""}`, onclick: () => { clearNew(name); location.hash = `#/score/${encodeURIComponent(name)}`; } }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(displayName(name))),
        partOf(name).length ? h("div", { class: "muted small sub" }, marquee(partOf(name).map((p) => `${p.a === name ? "A" : "B"} 声部 · 四手联弹「${p.name}」`).join("；"))) : null)),
      withMenu &&
        h("button", { class: "del", title: "更多", onclick: () => openCardMenu(displayName(name), [
          { label: "重命名…", icon: "pencil", run: async () => {
            const v = await askText("重命名", displayName(name), "保存");
            if (!v || v === displayName(name)) return;
            try {
              const next = await api.renameScore(name, v);
              renameRecent(name, next);
              if (partOf(name).length) await api.writePairs(pairs.map((p) => ({ ...p, a: p.a === name ? next : p.a, b: p.b === name ? next : p.b })));
              void load();
            } catch (e) {
              toast((e as Error).message);
            }
          } },
          { label: "设为四手联弹…（与另一份合成）", icon: "note", run: async () => {
            const free = allScores;
            if (free.length < 2) { toast("需要至少有两份谱子"); return; }
            const r = await openPairDialog({ scores: free, a: name, title: "设为四手联弹", intro: "选出两个人各自的谱子：A 在上面一屏，B 在下面一屏。", okLabel: "合成四手联弹" });
            if (r) void savePairs([...pairs, r]);
          } },
          deleteAction("删除这份乐谱", async () => {
            const inUse = partOf(name);
            const extra = inUse.length ? `\n它是四手联弹「${inUse.map((p) => p.name).join("、")}」的一个声部，删除后这首四手联弹也会消失（另一个声部的谱子保留）。` : "";
            if (!confirm(`删除「${displayName(name)}」？${extra}`)) return;
            if (inUse.length) await api.writePairs(pairs.filter((p) => !inUse.includes(p)));
            await api.deleteScore(name);
          }),
        ]) }, ic("chevron-down", 20)),
    );

  const STALLED_MIN = 15;
  const since: Record<string, number> = {};
  const minutesWaited = (name: string): number | null => {
    const ts = Math.max(since[name] ?? 0, queuedAt()[name] ?? 0); // latest of server time and "I (re)queued it" time
    return ts ? Math.floor((Date.now() - ts) / 60000) : null;
  };
  const isStalled = (it: api.InboxItem) => !it.failed && (minutesWaited(it.name) ?? 0) >= STALLED_MIN;
  const retry = async (name: string) => {
    try {
      await api.retryConversion(name);
      markQueued(name);
      api.forgetSince(name);
      delete since[name];
      optimistic.set(name, Date.now());
      prevPending.add(name);
      toast(`已重新开始转换：${name}`);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const queueCard = (it: api.InboxItem) => {
    const m = minutesWaited(it.name);
    const stalled = isStalled(it);
    return h(
      "div",
      { class: "card" + (it.failed ? " failed" : stalled ? " stalled" : " busy") },
      it.failed
        ? h("span", { class: "open static qline" }, h("span", { class: "warnic bad" }, ic("warning", 22)), h("span", {}, h("div", {}, it.name), h("div", { class: "muted small" }, "转换失败，点 ⓘ 查看原因")))
        : h(
            "span",
            { class: "open static qline" },
            stalled ? h("span", { class: "warnic" }, ic("warning", 20)) : h("span", { class: "spin small" }),
            h("span", {}, h("div", {}, it.name), h("div", { class: "muted small" }, stalled ? `已等待 ${m} 分钟，可能卡住了` : `转换中… ${m === null ? "" : m < 1 ? "刚刚上传" : `已等待 ${m} 分钟`}`)),
          ),
      it.failed &&
        h("button", { class: "del", title: "查看原因", onclick: async () => {
          try { showLog(it.name, await api.readFailureLog(it.name)); } catch (e) { toast((e as Error).message); }
        } }, ic("info", 20)),
      (it.failed || stalled) && h("button", { class: "del", title: "重试", onclick: () => void retry(it.name) }, ic("refresh", 20)),
      h("button", { class: "del", title: "删除", onclick: async () => {
        if (!confirm(`从队列中删除「${it.name}」？`)) return;
        try { await api.deleteInbox(it.name); clearQueued(it.name); optimistic.delete(it.name); load(); } catch (e) { toast((e as Error).message); }
      } }, ic("trash", 20)),
    );
  };
  function showLog(name: string, text: string) {
    const dlg = h("dialog", { class: "dlg" }, h("h2", {}, `转换失败：${name}`), h("pre", { class: "log" }, text), h("button", { class: "primary", onclick: () => dlg.close() }, "关闭"));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur(); // no focus ring on the first control
  }

  async function load() {
    if (token !== renderSeq) return;
    clearTimeout(homeTimer);
    try {
      const listed = await api.listInbox().catch((e) => { if (e instanceof api.AuthExpired) throw e; return [] as api.InboxItem[]; });
      const scores = await api.listScores();
      const pdfs = await api.listPdfs().catch(() => [] as api.ScoreInfo[]);
      if (token !== renderSeq) return;
      pdfList.replaceChildren(...pdfs.map((x) => pdfCard(x.name)));
      pdfSec.hidden = pdfs.length === 0;
      // a just-uploaded file may not show up in GitHub's listing for a few seconds: keep showing it
      const inbox = [...listed];
      for (const [n, ts] of optimistic) {
        if (listed.some((i) => i.name === n)) optimistic.delete(n);
        else if (Date.now() - ts > 90000 || scores.some((x) => x.name === n.replace(/\.[^.]+$/, ".musicxml"))) optimistic.delete(n);
        else inbox.push({ name: n, failed: false });
      }
      for (const it of inbox) if (!it.failed && !(it.name in since)) { const t = await api.queuedSince(it.name).catch(() => null); if (t) since[it.name] = t; }
      if (token !== renderSeq) return;
      // finished or failed since the last check -> tell the user
      const pendingNow = new Set(inbox.filter((i) => !i.failed).map((i) => i.name));
      for (const n of prevPending) {
        if (pendingNow.has(n)) continue;
        const stem = n.replace(/\.[^.]+$/, "");
        const done = scores.find((x) => x.name.startsWith(stem + "."));
        if (done) { toast(`✅ 转换完成：${stem}，已加入琴谱列表（请打开核对）`, 10000); markNew(done.name); clearQueued(n); }
        else if (inbox.some((i) => i.name === n && i.failed)) toast(`⚠ 转换失败：${n}，点它旁边的 ℹ 查看原因`, 10000);
      }
      prevPending = pendingNow;
      queue.replaceChildren(...inbox.map(queueCard));
      queueSec.hidden = inbox.length === 0;
      const busy = inbox.filter((i) => !i.failed && !isStalled(i));
      banner.hidden = busy.length === 0;
      stalledBanner.hidden = !inbox.some(isStalled);
      if (pendingNow.size) homeTimer = window.setTimeout(load, 10000); // poll while converting
      const names = new Set(scores.map((s) => s.name));
      allScores = scores.map((x) => x.name);
      // four-hand pairs (a record whose file was deleted elsewhere is ignored)
      pairs = (await api.readPairs().catch(() => pairs)).filter((p) => names.has(p.a) && names.has(p.b));
      if (token !== renderSeq) return;
      const inPair = new Set(pairs.flatMap((p) => [p.a, p.b]));
      // every score stays in the list (each part can be practised alone); a combined piece is an extra card
      const items = [
        ...pairs.map((p) => ({ key: `${p.name}\u0000`, el: () => pairCard(p) })),
        ...scores.map((x) => ({ key: displayName(x.name), el: () => card(x.name, true) })),
      ].sort((a, b) => a.key.localeCompare(b.key, "zh"));
      list.replaceChildren(...items.map((i) => i.el()));
      status.replaceChildren(
        ...(scores.length
          ? []
          : [
              "还没有琴谱，点右上角“上传琴谱”（支持 MusicXML / .mxl / PDF）。也可以先 ",
              h("button", { class: "linkbtn", onclick: () => void addSamples() }, "添加示例乐谱"),
              " 试一试，里面有四手联弹。",
            ]),
      );
      // "these two look like the two parts of one piece" (only a suggestion, never merged automatically)
      const sugg = suggestPairs([...names], inPair, getDismissed());
      suggest.replaceChildren(
        ...sugg.map((g) =>
          h(
            "div",
            { class: "banner info" },
            h("div", { class: "warnicon" }, ic("note", 26)),
            h(
              "div",
              { class: "grow" },
              h("b", {}, `「${g.name}」像是四手联弹的两个声部`),
              h("div", { class: "small" }, `A（上）：${displayName(g.a)}　B（下）：${displayName(g.b)}`),
              h("div", { class: "row wrap sugbtn" },
                h("button", { class: "primary", onclick: () => void savePairs([...pairs, { name: g.name, a: g.a, b: g.b }]) }, "合成四手联弹"),
                h("button", { onclick: async () => {
                  const r = await openPairDialog({ scores: [...names], a: g.a, b: g.b, name: g.name, title: "确认四手联弹", okLabel: "合成四手联弹" });
                  if (r) void savePairs([...pairs, r]);
                } }, "修改…"),
                h("button", { onclick: () => { dismissPair(g.a, g.b); void load(); } }, "不是"),
              ),
            ),
          ),
        ),
      );
      const rec = getRecent()
        .map((k) => {
          if (k.startsWith("pair:")) {
            const p = pairs.find((q) => pairKey(q) === k);
            return p ? pairCard(p) : null;
          }
          return names.has(k) ? card(k) : null;
        })
        .filter((x): x is HTMLDivElement => !!x)
        .slice(0, 3); // only the last three
      recent.replaceChildren(...rec);
      recentSec.hidden = rec.length === 0;
      allFold.count.textContent = `${items.length}`;
      pdfFold.count.textContent = `${pdfs.length}`;
      armMarquee();
    } catch (e) {
      if (e instanceof api.AuthExpired) return renderLogin(e.message);
      status.textContent = (e as Error).message;
    }
  }
  refreshHome = () => void load();
  load();
  // pull down at the top of the list to refresh (the iPad way)
  const main = app.querySelector("main.home") as HTMLElement;
  const ptr = h("div", { class: "ptr" }, "↓ 下拉刷新");
  main.prepend(ptr);
  let y0: number | null = null;
  let dy = 0;
  main.addEventListener("touchstart", (e) => { y0 = main.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  main.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    ptr.style.height = `${Math.min(dy, 90) * 0.6}px`;
    ptr.textContent = dy > 80 ? "↑ 松开刷新" : "↓ 下拉刷新";
  }, { passive: true });
  const endPull = () => {
    const go = y0 !== null && dy > 80;
    y0 = null;
    ptr.style.height = "0px";
    if (go) { toast("正在刷新…", 1200); void load(); void checkUpdate(true); }
  };
  main.addEventListener("touchend", endPull, { passive: true });
  main.addEventListener("touchcancel", endPull, { passive: true });
  // coming back to the app (iPad: from another app / after sleep) -> refresh without a manual reload
  homeVis = () => {
    if (!document.hidden) { void load(); void checkUpdate(true); }
  };
  document.addEventListener("visibilitychange", homeVis);
}

// ---------- player ----------
let disposePlayer: (() => void) | null = null;
/** true while an update must not reload the page (playing, editing, unsaved fingering) */
let busyCheck: () => boolean = () => false;
let homeTimer = 0;
let homeVis: (() => void) | null = null;
/** queued PDFs the server has not listed yet, and which ones were converting at the last check */
const optimistic = new Map<string, number>();
let prevPending = new Set<string>();
/** bumped by every screen change: an async render that finds it changed has been overtaken and must not touch the page */
let renderSeq = 0;
/** set while the home screen is shown: reload its list */
let refreshHome: (() => void) | null = null;
function cleanup() {
  renderSeq++;
  refreshHome = null;
  clearTimeout(homeTimer);
  if (homeVis) document.removeEventListener("visibilitychange", homeVis);
  homeVis = null;
  busyCheck = () => false;
  disposePlayer?.();
  disposePlayer = null;
}

/** One score area on screen. Normally one; four-hand scores get one per part (split screen). */
interface View {
  wrap: HTMLElement; // the scrolling container
  holder: HTMLElement; // positioned parent of the score (overlays, line highlight)
  band: HTMLElement;
  osmd: OpenSheetMusicDisplay;
  /** split view: this view draws a single part, so its cursor has its own (shorter) list of steps; matched by time */
  steps?: { sec: number; measure: number; onset: number }[];
  cur: number;
  /** positioned container of this screen (the peek floats inside it) and the floating preview of the next line */
  box: HTMLElement;
  peek: HTMLElement;
}

let svgSeq = 0;
const makePeek = (box: HTMLElement) => {
  const el = h("div", { class: "peek" });
  box.append(el);
  return el;
};

/** Move a split-view cursor to the step that is current at `sec` seconds. */
function syncView(v: View, sec: number) {
  if (!v.steps) return;
  let lo = 0;
  let hi = v.steps.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (v.steps[mid].sec <= sec + 1e-4) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx === v.cur) return;
  const c = v.osmd.cursor;
  if (idx > v.cur && idx - v.cur <= 8) for (let i = v.cur; i < idx; i++) c.next();
  else {
    c.reset();
    for (let i = 0; i < idx; i++) c.next();
  }
  v.cur = idx;
}

const partLetter = (i: number) => String.fromCharCode(65 + i);

async function renderPlayer(name: string) {
  cleanup();
  const token = renderSeq;
  const stale = () => token !== renderSeq;
  // OSMD owns (and clears) scoreBox on every render, so overlays live in the outer holder instead
  const scoreBox = h("div", { class: "osmd" });
  const band = h("div", { class: "linehl" });
  const holder = h("div", { class: "score" }, band, scoreBox);
  const scorewrap = h("div", { class: "scorewrap" }, holder);
  const viewbox = h("div", { class: "viewbox" }, scorewrap);
  const status = h("span", { class: "status" }, "加载乐谱…");
  app.replaceChildren(
    h(
      "header",
      { class: "top compact" },
      h("button", { class: "back", title: "返回", onclick: () => { if (leaveGuard()) location.hash = "#/"; } }, ic("chevron-left", 22), "返回"),
      h("h1", {}, displayName(name)),
      h("div", { class: "grow" }),
      status,
      h("button", { class: "icon", title: "重新载入这份乐谱并检查更新", onclick: () => { if (leaveGuard()) { void checkUpdate(true); void renderPlayer(name); } } }, ic("refresh")),
      h("button", { class: "icon", onclick: () => openSettings(() => void applySound(), () => void renderPlayer(name)), title: "设置" }, ic("sliders")),
    ),
    viewbox,
  );

  let osmd: OpenSheetMusicDisplay;
  let player: Player;
  let leaveGuard: () => boolean = () => true;
  const undo: (() => void)[] = []; // what to throw away if this render gets overtaken
  const bail = () => undo.forEach((f) => { try { f(); } catch { /* already gone */ } });
  try {
    const buf = await api.downloadScore(name);
    if (stale()) return;
    osmd = new OpenSheetMusicDisplay(scoreBox, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      followCursor: false, // scrolling is handled by followView() below (page-turn style, no gliding)
      cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: false }],
    });
    const xml = toMusicXml(buf);
    await osmd.load(xml);
    if (stale()) return;
    undo.push(() => osmd.clear());
    // four hands: one screen per part. The full score then only acts as the (hidden) playback model.
    const split = settings.splitView && osmd.Sheet.Instruments.length >= 2;
    let modelBox: HTMLElement | null = null;
    if (split) {
      modelBox = h("div", { class: "modelbox" }, scoreBox);
      document.body.append(modelBox);
      undo.push(() => modelBox?.remove());
    }
    osmd.zoom = split ? 0.5 : settings.zoom;
    osmd.render();
    osmd.cursor.show();
    const tools = new FingerTools(osmd, holder, xml, !split);
    undo.push(() => tools.dispose());
    tools.visible = settings.fingers;
    if (!tools.visible) {
      osmd.EngravingRules.RenderFingerings = false;
      osmd.render();
      osmd.cursor.show();
    }
    tools.refresh();
    leaveGuard = () => !tools.dirty || confirm("有未保存的指法，确定离开？");
    const score = extractScore(osmd, displayName(name));
    applyExpression(score, xml);
    const inst = await getInstrument(settings.sound, (s) => (status.textContent = s));
    if (stale()) return bail();
    player = new Player(osmd, score, audioCtx(), inst);
    player.volume = settings.volume;
    player.expressive = settings.expressive;
    pushRecent(name);
    clearNew(name);
    busyCheck = () => player.playing || tools.editing || tools.dirty;

    // the screens: one score area normally, one per part in split view
    const views: View[] = [];
    if (!split) views.push({ wrap: scorewrap, holder, band, osmd, cur: 0, box: viewbox, peek: makePeek(viewbox) });
    else {
      const split = h("div", { class: "splitwrap" });
      viewbox.replaceWith(split);
      for (let g = 0; g < osmd.Sheet.Instruments.length; g++) {
        const pBand = h("div", { class: "linehl" });
        const pBox = h("div", { class: "osmd" });
        const pHolder = h("div", { class: "score" }, pBand, pBox);
        const pWrap = h("div", { class: "panewrap" }, pHolder);
        const head = h("div", { class: "panehead" });
        const section = h("section", { class: "pane" }, head, pWrap);
        section.dataset.part = String(g);
        split.append(section);
        const o = new OpenSheetMusicDisplay(pBox, {
          autoResize: true,
          backend: "svg",
          drawTitle: g === 0,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: false }],
        });
        await o.load(xml);
        undo.push(() => o.clear());
        if (stale()) return bail();
        o.Sheet.Instruments.forEach((inst, i) => { inst.Visible = i === g; });
        o.zoom = settings.zoom;
        o.render();
        o.cursor.show();
        const ps = extractScore(o, ""); // only needed for this view's own step times
        views.push({ wrap: pWrap, holder: pHolder, band: pBand, osmd: o, steps: ps.steps, cur: 0, box: section, peek: makePeek(section) });
      }
    }

    // expose for tests / debugging
    (window as unknown as { __pianist: unknown }).__pianist = { player, score, osmd, tools, views };

    buildControls(player, score, views, status, tools, [name]);
    let applying = 0;
    applySound = async () => {
      const id = ++applying;
      const i = await getInstrument(settings.sound, (s) => (status.textContent = s));
      if (id === applying) player.setInstrument(i);
      player.volume = settings.volume;
      setVolume(i);
    };
    const setVolume = (i: Smplr) => i.output.setVolume(Math.round(settings.volume * 127));
    setVolume(inst);
    disposePlayer = () => {
      player.dispose();
      tools.dispose();
      osmd.clear();
      for (const v of views) if (v.osmd !== osmd) v.osmd.clear();
      modelBox?.remove();
      releaseWake();
    };
  } catch (e) {
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    status.textContent = "";
    scoreBox.replaceChildren(h("p", { class: "error pad" }, `无法打开乐谱：${(e as Error).message}`));
  }
}

/** Four hands from two separate files: A on the upper screen, B on the lower one, one shared clock. */
async function renderDuet(pair: api.Pair) {
  cleanup();
  const token = renderSeq;
  const stale = () => token !== renderSeq;
  const undo: (() => void)[] = [];
  const bail = () => undo.forEach((f) => { try { f(); } catch { /* already gone */ } });
  let leaveGuard: () => boolean = () => true;
  const status = h("span", { class: "status" }, "加载乐谱…");
  const split = h("div", { class: "splitwrap" });
  app.replaceChildren(
    h(
      "header",
      { class: "top compact" },
      h("button", { class: "back", title: "返回", onclick: () => { if (leaveGuard()) location.hash = "#/"; } }, ic("chevron-left", 22), "返回"),
      h("h1", {}, pair.name),
      h("div", { class: "grow" }),
      status,
      h("button", { class: "icon", title: "重新载入这份乐谱并检查更新", onclick: () => { if (leaveGuard()) { void checkUpdate(true); void renderDuet(pair); } } }, ic("refresh")),
      h("button", { class: "icon", onclick: () => openSettings(() => void applySound()), title: "设置" }, ic("sliders")),
    ),
    split,
  );
  try {
    const files = [pair.a, pair.b];
    const bufs = await Promise.all(files.map((f) => api.downloadScore(f)));
    if (stale()) return;
    const xmls = bufs.map((b) => toMusicXml(b));
    const views: View[] = [];
    const parts: ReturnType<typeof extractScore>[] = [];
    for (let g = 0; g < 2; g++) {
      const pBand = h("div", { class: "linehl" });
      const pBox = h("div", { class: "osmd" });
      const pHolder = h("div", { class: "score" }, pBand, pBox);
      const pWrap = h("div", { class: "panewrap" }, pHolder);
      const section = h("section", { class: "pane" }, h("div", { class: "panehead" }), pWrap);
      section.dataset.part = String(g);
      split.append(section);
      const o = new OpenSheetMusicDisplay(pBox, {
        autoResize: true,
        backend: "svg",
        drawTitle: g === 0,
        followCursor: false,
        cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: false }],
      });
      await o.load(xmls[g]);
      undo.push(() => o.clear());
      if (stale()) return bail();
      o.zoom = settings.zoom;
      o.render();
      o.cursor.show();
      const ps = extractScore(o, displayName(files[g]));
      applyExpression(ps, xmls[g]); // dynamics / pedal of this player's own file
      parts.push(ps);
      views.push({ wrap: pWrap, holder: pHolder, band: pBand, osmd: o, steps: ps.steps, cur: 0, box: section, peek: makePeek(section) });
    }
    const score = mergeScores(parts[0], parts[1], pair.name, pairLabels(pair.a, pair.b));
    const inst = await getInstrument(settings.sound, (s) => (status.textContent = s));
    if (stale()) return bail();
    const player = new Player(null, score, audioCtx(), inst); // each screen follows the shared clock itself
    player.volume = settings.volume;
    player.expressive = settings.expressive;
    pushRecent(pairKey(pair));
    // two independent scores: each screen has its own fingering tools and saves to its own file
    const tools = new FingerGroup(views.map((v, g) => new FingerTools(v.osmd, v.holder, xmls[g])));
    undo.push(() => tools.dispose());
    tools.visible = settings.fingers;
    if (!tools.visible) {
      for (const v of views) {
        v.osmd.EngravingRules.RenderFingerings = false;
        v.osmd.render();
        v.osmd.cursor.show();
      }
    }
    tools.refresh();
    leaveGuard = () => !tools.dirty || confirm("有未保存的指法，确定离开？");
    busyCheck = () => player.playing || tools.editing || tools.dirty;
    (window as unknown as { __pianist: unknown }).__pianist = { player, score, osmd: views[0].osmd, tools, views, pair };
    buildControls(player, score, views, status, tools, [pair.a, pair.b]);
    let applying = 0;
    applySound = async () => {
      const id = ++applying;
      const i = await getInstrument(settings.sound, (s) => (status.textContent = s));
      if (id === applying) player.setInstrument(i);
      player.volume = settings.volume;
      i.output.setVolume(Math.round(settings.volume * 127));
    };
    inst.output.setVolume(Math.round(settings.volume * 127));
    disposePlayer = () => {
      player.dispose();
      tools.dispose();
      for (const v of views) v.osmd.clear();
      releaseWake();
    };
  } catch (e) {
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    status.textContent = "";
    split.replaceChildren(h("p", { class: "error pad" }, `无法打开四手联弹：${(e as Error).message}`));
  }
}

let applySound: () => Promise<void> = async () => {};
/** set by the score view: re-apply scroll / highlight settings after they changed in the settings dialog */
let onViewSetting: () => void = () => {};

let wake: WakeLockSentinel | null = null;
async function keepAwake() {
  try {
    wake = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    /* unsupported */
  }
}
function releaseWake() {
  void wake?.release().catch(() => {});
  wake = null;
}

function buildControls(
  player: Player,
  score: ReturnType<typeof extractScore>,
  views: View[],
  status: HTMLElement,
  tools: FingerApi,
  files: string[], // file of each screen (fingering edits are saved back to it)
) {
  const name = files[0];
  const split = views.length > 0 && views[0].steps !== undefined;
  const osmd = views[0].osmd; // single view: the score itself (fingering editing works on it)
  const playBtn = h("button", { class: "primary play", title: "播放 / 暂停 (空格)" }, ic("play", 30));
  const stopBtn = h("button", { class: "icon big", title: "回到开头" }, ic("skip-back", 24));
  const speed = h("input", { type: "range", min: "20", max: "150", step: "5", value: "100", class: "speed" });
  const speedLabel = h("span", { class: "speedlabel" });
  const pos = h("span", { class: "pos" });

  const segBtn = (label: string, on: () => void) => h("button", { class: "seg", onclick: on }, label);
  const handBtns: Record<string, HTMLButtonElement> = {
    both: segBtn("双手", () => setHands(true, true)),
    right: segBtn("右手", () => setHands(true, false)),
    left: segBtn("左手", () => setHands(false, true)),
  };
  const hasHands = score.staffCounts.some((c) => c >= 2);
  function setHands(r: boolean, l: boolean) {
    player.handOn = { right: r, left: l };
    sync();
  }

  /** Controls of one player (part): name = sound on/off, right hand, left hand. Used under each screen in split view. */
  interface PartUi { g: number; group: HTMLElement; snd: HTMLElement; r: HTMLElement; l: HTMLElement }
  const partUi: PartUi[] = [];
  function partControls(g: number): HTMLElement {
    const multi = score.parts.length > 1;
    const label = multi ? `${partLetter(g)} · ${score.parts[g]}` : score.parts[g];
    const snd = h("button", { class: "seg pname", title: "开/关这个声部的声音：你自己弹的那个声部，把它关掉", onclick: () => {
      player.partOn[g] = !player.partOn[g];
      if (!player.partOn.some(Boolean)) player.partOn[g] = true; // keep at least one part audible
      sync();
    } }, label);
    const hand = (key: "right" | "left", text: string) => h("button", { class: "seg", onclick: () => {
      const hs = player.partHands[g];
      hs[key] = !hs[key];
      if (!hs.right && !hs.left) hs[key === "right" ? "left" : "right"] = true; // a part always plays at least one hand
      sync();
    } }, text);
    const r = hand("right", "右手");
    const l = hand("left", "左手");
    const two = score.staffCounts[g] >= 2;
    const group = h("div", { class: "group pgroup" }, snd, ...(two ? [r, l] : []));
    partUi.push({ g, group, snd, r, l });
    return group;
  }

  // practice panel
  const cbExpr = h("input", { type: "checkbox", checked: settings.expressive });
  cbExpr.addEventListener("change", () => {
    settings.expressive = cbExpr.checked;
    saveSettings(settings);
    player.expressive = cbExpr.checked;
  });
  const ex = score.expression;
  const exprNote = ex
    ? ex.dynamics + ex.wedges + ex.articulations + ex.pedals === 0
      ? "这份谱子没有力度/踏板记号（从 PDF 转换时常会丢失），按强弱拍和旋律层次演奏。"
      : `乐谱里的表情记号：力度 ${ex.dynamics} 个、渐强渐弱 ${ex.wedges} 处、断奏/重音等 ${ex.articulations} 个、踏板 ${ex.pedals} 处。`
    : "";
  const cbCount = h("input", { type: "checkbox" });
  const cbMetro = h("input", { type: "checkbox" });
  const cbLoop = h("input", { type: "checkbox" });
  const from = h("input", { type: "number", min: "1", max: String(score.measureCount), value: "1" });
  const to = h("input", { type: "number", min: "1", max: String(score.measureCount), value: String(Math.min(4, score.measureCount)) });
  const cbRamp = h("input", { type: "checkbox" });
  const rampStep = h("input", { type: "number", min: "1", max: "50", value: "5" });
  const rampMax = h("input", { type: "number", min: "20", max: "200", value: "100" });
  const applyPractice = () => {
    player.countIn = cbCount.checked;
    player.metronome = cbMetro.checked;
    const f = Math.max(1, Math.min(score.measureCount, Number(from.value) || 1));
    const t = Math.max(f, Math.min(score.measureCount, Number(to.value) || f));
    player.loop = cbLoop.checked ? { from: f - 1, to: t - 1 } : null;
    player.ramp = cbRamp.checked ? { step: (Number(rampStep.value) || 5) / 100, max: (Number(rampMax.value) || 100) / 100 } : null;
    sync();
  };
  for (const el of [cbCount, cbMetro, cbLoop, from, to, cbRamp, rampStep, rampMax]) el.addEventListener("change", applyPractice);
  const useCurrent = h("button", { onclick: () => { from.value = String(player.measureIndex + 1); if (Number(to.value) < Number(from.value)) to.value = from.value; applyPractice(); } }, "起点＝当前小节");
  const panel = h(
    "div",
    { class: "panel", hidden: true },
    h("label", { class: "inline" }, cbExpr, "按乐谱表情演奏（力度、断奏、踏板）"),
    h("p", { class: "muted small" }, exprNote),
    h("label", { class: "inline" }, cbCount, "开始前倒数一小节"),
    h("label", { class: "inline" }, cbMetro, "节拍器"),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbLoop, "循环小节"), from, "到", to, useCurrent),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbRamp, "每遍加速"), rampStep, "% ，上限", rampMax, "%"),
  );
  const practiceBtn = h("button", { title: "练习", onclick: () => (panel.hidden = !panel.hidden) }, ic("sliders", 20), "练习");

  const zoomIn = h("button", { class: "icon", onclick: () => zoom(0.1), title: "放大" }, ic("plus", 20));
  const zoomOut = h("button", { class: "icon", onclick: () => zoom(-0.1), title: "缩小" }, ic("minus", 20));
  function rerender() {
    const step = player.currentStep;
    for (const v of views) {
      v.osmd.EngravingRules.RenderFingerings = false; // every number is drawn by our own overlay so it can follow the hand selection
      v.osmd.zoom = settings.zoom;
      v.osmd.render();
      v.osmd.cursor.show();
      if (v.steps) {
        v.osmd.cursor.reset();
        v.cur = 0;
      }
    }
    if (!split) player.seekStep(step);
    else syncViews();
    tools.refresh();
    followView();
  }
  function zoom(d: number) {
    settings.zoom = Math.min(2.5, Math.max(0.4, +(settings.zoom + d).toFixed(2)));
    saveSettings(settings);
    rerender();
  }

  // ---- fingering ----
  const cbXml = h("input", { type: "checkbox", checked: tools.showXml, disabled: tools.xmlCount === 0 });
  const cbAuto = h("input", { type: "checkbox", checked: tools.showAuto });
  cbXml.addEventListener("change", () => { tools.showXml = cbXml.checked; rerender(); });
  cbAuto.addEventListener("change", () => tools.setAuto(cbAuto.checked));
  const editBtn = h("button", { class: "primary", onclick: () => enterEdit() }, ic("pencil", 20), "编辑指法");
  const fpanel = h(
    "div",
    { class: "panel", hidden: true },
    h("label", { class: "inline" }, cbXml, tools.xmlCount ? `显示乐谱里的指法（${tools.xmlCount} 个音符）` : "乐谱里没有指法信息"),
    h("label", { class: "inline" }, cbAuto, h("span", {}, "自动建议指法（", h("b", { class: "blue" }, "蓝色"), "，仅作参考；已有指法的音符不会被改动）")),
    h("p", { class: "muted small" }, "优先级：乐谱里的指法 > 自动建议。自己标注的指法保存后写进乐谱文件，之后读取以它为准。"),
    editBtn,
  );
  const fingerToggle = h("button", { class: "toggle", title: "显示 / 隐藏指法", disabled: !tools.supported, onclick: () => setFingers(!tools.visible) }, ic("hand", 20), "指法");
  const fingerOpts = h("button", { class: "narrow", title: "指法选项", disabled: !tools.supported, onclick: () => { fpanel.hidden = !fpanel.hidden; panel.hidden = true; } }, ic("chevron-down", 18));
  const fingerBtn = h("div", { class: "group pair" }, fingerToggle, fingerOpts);
  function setFingers(on: boolean) {
    tools.visible = on;
    settings.fingers = on;
    saveSettings(settings);
    fingerToggle.classList.toggle("on", on);
    rerender();
  }
  fingerToggle.classList.toggle("on", tools.visible);
  practiceBtn.addEventListener("click", () => (fpanel.hidden = true));

  const fbtns = [1, 2, 3, 4, 5].map((n) => h("button", { class: "fnum", onclick: () => tools.apply(n) }, String(n)));
  const fclear = h("button", { class: "fnum", title: "清除该音符的指法", onclick: () => tools.apply(null) }, ic("x", 22));
  const fundo = h("button", { class: "fnum", title: "撤销", onclick: () => tools.undo() }, ic("undo", 22));
  const finfo = h("span", { class: "finfo" });
  const fsave = h("button", { class: "primary", onclick: () => void saveFingering() }, "保存");
  const fdone = h("button", { onclick: () => exitEdit() }, "完成");
  const editbar = h("div", { class: "editbar", hidden: true }, ...fbtns, fclear, fundo, finfo, h("div", { class: "grow" }), fsave, fdone);
  function enterEdit() {
    if (!tools.visible) setFingers(true);
    fpanel.hidden = true;
    editbar.hidden = false;
    document.querySelectorAll(".scorewrap, .panewrap").forEach((e) => e.classList.add("editing"));
    tools.setEditing(true);
  }
  function exitEdit() {
    if (tools.dirty && !confirm("有未保存的指法，放弃这些修改？")) return;
    tools.discard();
    editbar.hidden = true;
    document.querySelectorAll(".scorewrap, .panewrap").forEach((e) => e.classList.remove("editing"));
    tools.setEditing(false);
  }
  async function saveFingering() {
    fsave.disabled = true;
    try {
      const sets = tools.parts();
      for (let i = 0; i < sets.length; i++) {
        if (!sets[i].dirty) continue;
        const file = files[i] ?? name;
        const xml = await sets[i].save((x) => api.saveScoreText(file, x, `Fingering: ${displayName(file)}`));
        await views[i]?.osmd.load(xml);
      }
      rerender();
      toast("指法已保存到乐谱");
    } catch (e) {
      if (e instanceof api.AuthExpired) return renderLogin(e.message);
      showError("指法保存失败", e);
    } finally {
      syncEdit();
    }
  }
  function syncEdit() {
    finfo.textContent = tools.describeSelected();
    fsave.textContent = tools.pending.size ? `保存（${tools.pending.size}）` : "保存";
    fsave.disabled = tools.pending.size === 0;
    fundo.disabled = tools.pending.size === 0;
  }
  tools.onChange = syncEdit;
  syncEdit();

  playBtn.addEventListener("click", () => {
    unlockIOSAudio();
    if (player.playing) player.pause();
    else void player.play();
  });
  stopBtn.addEventListener("click", () => player.stop());
  speed.addEventListener("input", () => player.setSpeed(Number(speed.value) / 100));

  // ---- keeping the current line in view (every screen follows its own cursor) ----
  function followOne(v: View, jump: boolean) {
    const cur = v.osmd.cursor.cursorElement as HTMLElement | undefined;
    if (!cur) return;
    const cr = cur.getBoundingClientRect();
    if (cr.height === 0) return;
    const hr = v.holder.getBoundingClientRect();
    v.band.style.display = settings.lineHighlight ? "block" : "none";
    v.band.style.top = `${cr.top - hr.top - 8}px`;
    v.band.style.height = `${cr.height + 16}px`;
    if (jump && settings.scrollMode !== "off") scrollToCursor(v, cr);
    updatePeek(v);
  }
  function scrollToCursor(v: View, cr: DOMRect) {
    const wr = v.wrap.getBoundingClientRect();
    const top = cr.top - wr.top;
    const margin = 14;
    // the cursor only spans the staves: fingering numbers, high notes, dynamics and bar numbers are drawn above and below it
    const above = Math.round(58 * Math.max(1, settings.zoom));
    const below = Math.round(34 * Math.max(1, settings.zoom));
    if (settings.scrollMode === "page") {
      // only when the line is not fully visible: put it near the top (with room for what is drawn above the staff)
      if (top < above || cr.bottom - wr.top > wr.height - below) v.wrap.scrollTop += top - above;
    } else {
      const delta = top + cr.height / 2 - wr.height / 2;
      if (Math.abs(delta) > 40) v.wrap.scrollTo({ top: v.wrap.scrollTop + delta, behavior: "smooth" });
    }
  }

  // ---- preview of the next line: floats right under the last visible line, gone once the page has turned ----
  function updatePeek(v: View) {
    const off = () => { v.peek.style.display = "none"; };
    if (!settings.peekNext || settings.scrollMode !== "page") return off();
    const svg = v.holder.querySelector("svg") as SVGSVGElement | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const systems: any[] | undefined = (v.osmd.GraphicSheet as any)?.MusicPages?.[0]?.MusicSystems;
    const curEl = v.osmd.cursor.cursorElement as HTMLElement | undefined;
    if (!svg || !systems?.length || !curEl) return off();
    const hr = v.holder.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const k = 10 * v.osmd.zoom;
    const oy = sr.top - hr.top;
    const boxes = systems.map((s) => ({ top: oy + s.PositionAndShape.AbsolutePosition.y * k, h: s.PositionAndShape.Size.height * k }));
    const cr = curEl.getBoundingClientRect();
    const cy = cr.top - hr.top + cr.height / 2;
    const i = boxes.findIndex((b) => cy >= b.top - 12 && cy <= b.top + b.h + 12);
    if (i < 0 || i + 1 >= boxes.length) return off();
    const next = boxes[i + 1];
    const viewH = v.wrap.clientHeight;
    const vTop = v.wrap.scrollTop;
    // is the next line (mostly) on screen already? then there is nothing to preview
    const shown = Math.max(0, Math.min(next.top + next.h, vTop + viewH) - Math.max(next.top, vTop));
    if (shown >= next.h * 0.6) return off(); // the line is there to read (its cut-off part is mostly margin)
    // right under the current line (so the eye just continues downwards); if that runs past the bottom of the
    // score area it floats over the control bar, which is not needed while playing
    const y = Math.max(0, boxes[i].top + boxes[i].h - vTop + 4);
    const wr = v.wrap.getBoundingClientRect();
    const room = (split ? wr.bottom : window.innerHeight) - 6 - (wr.top + y);
    const S = 0.85; // drawn a little smaller: it only has to be readable, and it covers less
    // what is drawn above the staves (bar numbers, high notes, fingering) lies outside the system box: start higher
    const pad = Math.round(44 * Math.max(1, settings.zoom));
    const h2 = Math.min((next.h + pad + 24) * S, room);
    if (h2 < Math.min(110, next.h * S * 0.6)) return off();
    // the preview is a window onto the same drawing (no copy of the score is made)
    if (!svg.id || document.querySelectorAll(`[id="${svg.id}"]`).length > 1) svg.id = `osmd-svg-${++svgSeq}`;
    const w = svg.getBoundingClientRect().width;
    v.peek.className = "peek";
    v.peek.style.cssText = `display:block;top:${v.wrap.offsetTop + y}px;height:${h2}px`;
    v.peek.innerHTML = `<span class="tag">下一行</span><svg width="${w * S}" height="${h2}" viewBox="0 ${next.top - pad - oy} ${w} ${h2 / S}" style="left:${sr.left - hr.left + (w * (1 - S)) / 2}px"><use href="#${svg.id}"/></svg>`;
  }
  function syncViews() {
    if (!split) return;
    const sec = score.steps[player.currentStep]?.sec ?? 0;
    for (const v of views) syncView(v, sec);
  }
  /** highlight the line being played and (depending on the mode) bring it into view */
  function followView(jump = true) {
    for (const v of views) followOne(v, jump);
  }
  onViewSetting = () => followView();

  // ---- tap the score to choose where playback starts ----
  /** every place on this screen that playback can start from: x, the vertical band of its staff row, measure and onset */
  function tapTargets(v: View) {
    const svg = v.holder.querySelector("svg");
    if (!svg) return [];
    const hr = v.holder.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const ox = sr.left - hr.left;
    const oy = sr.top - hr.top;
    const k = 10 * v.osmd.zoom;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gs: any = v.osmd.GraphicSheet;
    const out: { x: number; y0: number; y1: number; measure: number; onset: number }[] = [];
    gs.MeasureList.forEach((row: any[], mi: number) =>
      row.forEach((gm) => {
        if (!gm) return;
        const y0 = oy + gm.PositionAndShape.AbsolutePosition.y * k;
        const y1 = y0 + (gm.PositionAndShape.Size?.height ?? 4) * k;
        for (const se of gm.staffEntries) out.push({ x: ox + se.PositionAndShape.AbsolutePosition.x * k, y0, y1, measure: mi, onset: se.relInMeasureTimestamp.RealValue });
      }),
    );
    return out;
  }
  function seekFromTap(v: View, ev: MouseEvent) {
    if (tools.editing) return; // editing fingering: taps select notes
    const hr = v.holder.getBoundingClientRect();
    const px = ev.clientX - hr.left;
    const py = ev.clientY - hr.top;
    let best: ReturnType<typeof tapTargets>[number] | null = null;
    let bestCost = Infinity;
    for (const t of tapTargets(v)) {
      const dy = py < t.y0 ? t.y0 - py : py > t.y1 ? py - t.y1 : 0;
      const cost = dy * 2 + Math.abs(px - t.x);
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    if (!best) return;
    const list = v.steps ?? score.steps; // this screen's own steps (split) or the full list
    const i = list.findIndex((s) => s.measure === best!.measure && Math.abs(s.onset - best!.onset) < 1e-6);
    if (i < 0) return;
    // a split screen has its own step numbering: go through time to find the matching step of the full score
    const gi = v.steps ? Math.max(0, score.steps.findIndex((s) => s.sec >= list[i].sec - 1e-4)) : i;
    player.seekStep(gi);
  }
  for (const v of views) v.holder.addEventListener("click", (ev) => seekFromTap(v, ev));

  // fingering follows the hand selection (right / left) of each part
  let handSig = "";
  function syncFingerHands() {
    const sig = JSON.stringify(player.partHands);
    if (sig === handSig) return;
    handSig = sig;
    tools.setHandFilter((pi, n) => {
      const hs = player.partHands[pi];
      // same rule as the sound (player.audible): upper staff = right hand, lower staff = left hand
      return !hs || score.staffCounts[pi] < 2 || (n.staff % 2 === 0 ? hs.right : hs.left);
    });
  }
  function sync() {
    syncFingerHands();
    syncViews();
    followView();
    playBtn.replaceChildren(ic(player.playing ? "pause" : "play", 30));
    speed.style.setProperty("--p", `${((Number(speed.value) - Number(speed.min)) / (Number(speed.max) - Number(speed.min))) * 100}%`);
    const bpm = Math.round(score.baseBpm * player.speed);
    speed.value = String(Math.round(player.speed * 100));
    speedLabel.textContent = `${Math.round(player.speed * 100)}% · ♩=${bpm}`;
    pos.textContent = `第 ${player.measureIndex + 1} / ${score.measureCount} 小节`;
    const mode = player.handOn.right && player.handOn.left ? "both" : player.handOn.right ? "right" : "left";
    for (const [k, b] of Object.entries(handBtns)) b.classList.toggle("on", k === mode);
    partUi.forEach((u) => {
      u.snd.classList.toggle("on", player.partOn[u.g]);
      u.r.classList.toggle("on", player.partHands[u.g].right);
      u.l.classList.toggle("on", player.partHands[u.g].left);
      u.group.classList.toggle("muted", !player.partOn[u.g]);
    });
    if (player.playing) void keepAwake(); else releaseWake();
  }
  player.onChange = sync;

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches("input, select, textarea")) return;
    if (tools.editing) {
      if (/^[1-5]$/.test(e.key)) return tools.apply(Number(e.key));
      if (e.key === "Backspace" || e.key === "Delete") return tools.apply(null);
      if ((e.metaKey || e.ctrlKey) && e.key === "z") return tools.undo();
    }
    if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
    if (e.code === "ArrowRight") player.seekMeasure(player.measureIndex + 1);
    if (e.code === "ArrowLeft") player.seekMeasure(Math.max(0, player.measureIndex - 1));
  };
  document.addEventListener("keydown", onKey);
  // iOS suspends audio when the app goes to the background: pause so the position is not lost
  const onHide = () => {
    if (document.hidden) player.pause();
    else void audioCtx().resume();
  };
  document.addEventListener("visibilitychange", onHide);
  const prevDispose = disposePlayer;
  disposePlayer = () => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    prevDispose?.();
  };

  // split view: the bar can shrink to play / pause (+ a button that brings everything back)
  const moreBtn = h("button", { class: "morebtn", title: "展开 / 收起更多控制" });
  const refreshMore = () => {
    const min = split && settings.splitControlsMin;
    bar.classList.toggle("min", min);
    moreBtn.replaceChildren(ic(min ? "chevron-up" : "chevron-down", 18), min ? "更多" : "收起");
  };
  moreBtn.addEventListener("click", () => {
    settings.splitControlsMin = !settings.splitControlsMin;
    saveSettings(settings);
    panel.hidden = true;
    fpanel.hidden = true;
    refreshMore();
  });
  const bar = h(
    "footer",
    { class: "controls" },
    panel,
    fpanel,
    editbar,
    h("div", { class: "row mainrow" }, stopBtn, playBtn, h("div", { class: "speedbox" }, speed, speedLabel), pos, ...(split ? [moreBtn] : [])),
    h(
      "div",
      { class: "row wrap" },
      score.parts.length === 1 && hasHands && h("div", { class: "group" }, h("span", { class: "gl" }, "手"), ...Object.values(handBtns)),
      ...(score.parts.length > 1 && !split ? score.parts.map((_, g) => partControls(g)) : []),
      h("div", { class: "grow" }),
      fingerBtn,
      practiceBtn,
      zoomOut,
      zoomIn,
    ),
  );
  if (split) {
    // full screen for one part: the other part keeps sounding, it just is not shown
    let focus: number | null = null;
    const setFocus = (g: number | null) => {
      focus = g;
      app.classList.toggle("focusing", g !== null);
      document.querySelector(".splitwrap")?.classList.toggle("focusing", g !== null);
      document.querySelectorAll(".pane").forEach((pane, i) => pane.classList.toggle("focused", g === i));
      document.querySelectorAll(".focusbtn").forEach((b, i) => b.replaceChildren(ic(g === i ? "restore" : "fullscreen", 18), g === i ? "还原" : "全屏"));
      requestAnimationFrame(() => { followView(); });
    };
    document.querySelectorAll(".panehead").forEach((head, g) => {
      head.append(partControls(g));
      head.append(h("div", { class: "grow" }));
      head.append(h("button", { class: "focusbtn", title: "只看这个声部（全屏）。另一个声部仍然会发声", onclick: () => setFocus(focus === g ? null : g) }, ic("fullscreen", 18), "全屏"));
    });
    (window as unknown as { __setFocus?: (g: number | null) => void }).__setFocus = setFocus;
  }
  app.append(bar);
  refreshMore();
  try {
    if (!localStorage.getItem("pianist.tap.hint")) {
      localStorage.setItem("pianist.tap.hint", "1");
      setTimeout(() => toast("点谱面上的任意位置，可以从那里开始播放", 5000), 800);
    }
  } catch {
    /* private mode */
  }
  status.textContent = "";
  sync();
}

// ---------- routing ----------
async function signInFromLink(hash: string) {
  app.replaceChildren(h("p", { class: "muted pad" }, "正在登录…"));
  const link = api.parseLink(hash);
  // remove the secret from the address bar / history right away
  history.replaceState(null, "", location.pathname + location.search + "#/");
  if (!link) return renderLogin("登录链接无效");
  try {
    await api.login(link.token, link.repo, true);
    route();
  } catch (e) {
    renderLogin((e as Error).message);
  }
}

// ---------- PDF viewer (pages drawn with pdf.js, loaded only when a PDF is opened) ----------
async function renderPdf(name: string) {
  cleanup();
  const token = renderSeq;
  const stale = () => token !== renderSeq;
  let zoom = 1;
  const pages = h("div", { class: "pdfpages" });
  const wrap = h("div", { class: "pdfwrap" }, pages);
  const status = h("span", { class: "status" }, "加载 PDF…");
  const bump = (d: number) => { zoom = Math.min(3, Math.max(0.5, zoom + d)); pages.style.setProperty("--z", String(zoom)); };
  pages.style.setProperty("--z", "1");
  app.replaceChildren(
    h(
      "header",
      { class: "top compact" },
      h("button", { class: "back", title: "返回", onclick: () => (location.hash = "#/") }, ic("chevron-left", 22), "返回"),
      h("h1", {}, name.replace(/\.pdf$/i, "")),
      h("div", { class: "grow" }),
      status,
      h("button", { class: "icon", title: "缩小", onclick: () => bump(-0.25) }, ic("minus", 20)),
      h("button", { class: "icon", title: "放大", onclick: () => bump(0.25) }, ic("plus", 20)),
    ),
    wrap,
  );
  try {
    const [pdfjs, worker, data] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.min.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
      api.downloadPdf(name),
    ]);
    if (stale()) return;
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    if (stale()) return;
    status.textContent = `共 ${doc.numPages} 页`;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (stale()) return;
      const base = page.getViewport({ scale: 1 });
      const scale = (Math.max(900, Math.min(1600, wrap.clientWidth * ratio)) / base.width);
      const vp = page.getViewport({ scale });
      const canvas = h("canvas", { class: "pdfpage" }) as HTMLCanvasElement;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      pages.append(canvas);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    }
  } catch (e) {
    if (stale()) return;
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    status.textContent = "";
    showError(`无法打开 ${name}`, e);
  }
}

function route() {
  if (location.hash.startsWith("#/link/")) return void signInFromLink(location.hash);
  if (!api.getAuth()) return renderLogin();
  const d = location.hash.match(/^#\/duet\/([^/]+)\/([^/]+)$/);
  if (d) {
    const a = decodeURIComponent(d[1]);
    const b = decodeURIComponent(d[2]);
    void api.readPairs().then((ps) => renderDuet(ps.find((p) => p.a === a && p.b === b) ?? { name: defaultPairName(a, b), a, b }));
    return;
  }
  const pdf = location.hash.match(/^#\/pdf\/(.+)$/);
  if (pdf) return void renderPdf(decodeURIComponent(pdf[1]));
  const m = location.hash.match(/^#\/score\/(.+)$/);
  if (m) void renderPlayer(decodeURIComponent(m[1]));
  else void renderHome();
}
window.addEventListener("hashchange", route);
route();

// ---------- app updates (an installed iPad app has no reload button) ----------
/** Forget the offline copy of the app and load the newest one. The login (localStorage) is kept. */
async function hardRefresh() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no service worker */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* no cache storage */
  }
  // a changed query string also skips the browser's own HTTP cache for index.html
  location.replace(`${location.pathname}?r=${Date.now()}${location.hash}`);
}


let updateReady = false;
let applyUpdate: (() => void) | null = null;
let swReg: ServiceWorkerRegistration | null = null;
let updateBanner: HTMLElement | null = null;

function showUpdateBanner() {
  if (updateBanner) return;
  updateBanner = h("div", { class: "updatebar" }, h("span", {}, "新版本已就绪，播放/编辑结束后会自动更新"), h("button", { class: "primary", onclick: () => applyUpdate?.() }, "立即更新"));
  document.body.append(updateBanner);
}
function tryApplyUpdate() {
  if (!updateReady || !applyUpdate) return;
  if (busyCheck()) showUpdateBanner();
  else applyUpdate();
}
/** @param quiet no toast when already up to date (used by automatic checks) */
async function checkUpdate(quiet = false) {
  if (!swReg) {
    if (!quiet) toast("当前环境不支持自动更新，请手动刷新页面");
    return;
  }
  try {
    await swReg.update();
  } catch {
    if (!quiet) toast("检查更新失败，请检查网络");
    return;
  }
  if (updateReady) tryApplyUpdate();
  else if (!quiet) toast("已是最新版本");
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          updateReady = true;
          tryApplyUpdate();
        },
        onRegisteredSW(_url, reg) {
          swReg = reg ?? null;
          // First visit: the page is not controlled yet, so a new worker activates immediately
          // and never reports "waiting". Treat that activation as "a new version is ready" too.
          reg?.addEventListener("updatefound", () => {
            const w = reg.installing;
            w?.addEventListener("statechange", () => {
              if (w.state === "activated" && !navigator.serviceWorker.controller) {
                updateReady = true;
                applyUpdate = () => location.reload();
                tryApplyUpdate();
              }
            });
          });
        },
      });
      applyUpdate = () => void updateSW(true);
      setInterval(() => void checkUpdate(true), 60_000); // look for a new version every minute
      setInterval(tryApplyUpdate, 5_000); // apply it as soon as nothing is playing / being edited
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void checkUpdate(true);
      });
    })
    .catch(() => {});
}
