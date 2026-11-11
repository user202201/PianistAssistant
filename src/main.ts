import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import QRCode from "qrcode";
import type { Smplr } from "smplr";
import * as api from "./api";
import * as ent from "./entitlement";
import { NoteBook, PEN_COLORS, parseNotes } from "./pdfnotes";
import { AutoTurn } from "./autoturn";
import { SOUNDS, createSynth, unlockIOSAudio } from "./audio";
import { icon as ic } from "./icons";
import { FingerGroup, FingerTools, type FingerApi } from "./fingerui";
import { Player } from "./player";
import { applyExpression } from "./expression";
import { defaultPairName, pairLabels, roleOf, suggestPairs } from "./pairs";
import { extractScore, mergeScores, toMusicXml } from "./score";
import { unzipSync, zipSync } from "fflate";
import { LANGS, getLang, setLang } from "./i18n";
import { startFitting } from "./fit";
import { createGameView, GAME_PRE } from "./gameview";
import { GameScore, WINDOWS, isComboMilestone } from "./gamescore";
import { createHud } from "./gamehud";
import { midi, MidiInput, type MidiNote } from "./midi";
import { mic, MicInput } from "./mic";
import { record as logError, getLog, clearLog, formatLog, startErrorLog } from "./errlog";
import { confetti } from "./confetti";
import { goSound, readySound } from "./gamesound";
import { clearNew, clearQueued, getFavs, getHomeTab, getRecent, setFavs, setHomeTab, isNew, loadSettings, markNew, markQueued, pushRecent, markOpened, getOpened, getSeen, queuedAt, renameRecent, saveSettings } from "./settings";

const app = document.getElementById("app")!;
const settings = loadSettings();
let offlineToldAt = 0; // the "you are offline" notice is shown once per outage
let prefetched = false; // the library is copied to the device once per session
setLang(settings.lang); // texts are translated as they appear on screen
startFitting(); // and controls are made to fit (long texts, small screens)
if (__LOCAL_ONLY__ && !api.isLocal()) api.useLocal(); // store builds have no account and no GitHub: straight to the device storage
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
        // cards glide slowly and for ever; a part name glides faster, only a few times, and then rests at its end (Primo / Secondo)
        m.style.setProperty("--t", m.classList.contains("few") ? `${Math.max(1.4, over / 110).toFixed(1)}s` : `${Math.max(4, (over / 28) * 1).toFixed(1)}s`);
        m.classList.add("glide");
      } else m.classList.remove("glide");
    });
  });
}
window.addEventListener("resize", () => armMarquee());
window.addEventListener("pianist-lang", () => armMarquee());
window.addEventListener("pianist-fit", () => armMarquee()); // (a bar that gave something up may have a name that must now glide)

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if ((k.startsWith("data-") || k.startsWith("aria-")) && v !== undefined && v !== false) el.setAttribute(k, String(v));
    else if (v !== undefined && v !== false) (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}
/**
 * The one place where the app tells you what is going on: a message in the top bar, above everything (also above dialogs).
 * `working` = something is still in progress (shows a spinner and stays until it is closed with the returned function,
 * then the result is shown with a normal toast). Messages are tap-to-dismiss.
 */
const toast = (msg: string, ms = 3500, working = false) => {
  // the same "working…" message is shown once, not stacked
  if (working) {
    const same = [...document.querySelectorAll("#toasts .toast.working")].find((x) => x.textContent === msg);
    if (same) return () => same.remove();
  }
  const t = h("div", { class: "toast" + (working ? " working" : "") }, ...(working ? [h("div", { class: "spin small" })] : []), h("span", {}, msg));
  t.addEventListener("click", () => t.remove());
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts" });
    box.setAttribute("popover", "manual"); // top layer: stays visible above open dialogs
    document.body.append(box);
  }
  box.append(t); // several messages stack instead of lying on top of each other
  try {
    box.hidePopover?.();
    box.showPopover?.(); // (re)open last so that it is above a dialog opened in the meantime
  } catch { /* browsers without popover: the fixed position still shows it */ }
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
  const githubForm = [
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
  ];
  // on this device, no account: the main way in the apps, an extra choice on the web
  const localBtn = h("button", { class: __MOBILE__ ? "primary" : "", onclick: () => { api.useLocal(); route(); } }, "在本机使用（不需要账号）");
  const localNote = h("p", { class: "muted small" }, __MOBILE__ ? "谱子保存在这台设备上，不需要登录；以后也可以连接 GitHub 同步。" : "谱子保存在这台设备上，不需要登录；以后也可以连接 GitHub 同步。网页版的本机数据可能被浏览器清理，建议安装成 App 或添加到主屏幕。");
  app.replaceChildren(
    h(
      "div",
      { class: "login" },
      h("h1", { class: "brand big" }, h("span", { class: "logo" }, ic("note", 24)), "Pianist Assistant"),
      ...(__LOCAL_ONLY__
        ? [localBtn, localNote]
        : __MOBILE__
          ? [localBtn, localNote, h("details", {}, h("summary", {}, "用 GitHub 同步（高级）"), ...githubForm)]
          : [...githubForm, h("hr", {}), localBtn, localNote]),
    ),
  );
  token.focus();
}

// ---------- trial + one-time purchase (iOS store build only, see entitlement.ts) ----------
/** Buy the unlock. true = owned afterwards. Every step answers with a message. */
async function buyUnlock(): Promise<boolean> {
  const done = toast("正在连接 App Store…", 120000, true);
  try {
    const owned = await ent.purchase();
    done();
    toast(owned ? "已解锁完整版，谢谢支持！" : "购买未完成");
    return owned;
  } catch (e) {
    done();
    showError("购买失败", e);
    return false;
  }
}
async function restoreUnlock(): Promise<boolean> {
  const done = toast("正在恢复购买…", 120000, true);
  try {
    const owned = await ent.restore();
    done();
    toast(owned ? "已恢复购买，完整版已解锁" : "没有找到这个 Apple ID 的购买记录");
    return owned;
  } catch (e) {
    done();
    showError("恢复购买失败", e);
    return false;
  }
}
function showPaywall(onUnlocked?: () => void) {
  const price = ent.unlockPrice();
  const finish = (ok: boolean) => {
    if (!ok) return;
    dlg.close();
    onUnlocked?.();
  };
  const dlg = h(
    "dialog",
    { class: "dlg", id: "paywall" },
    h("h2", { tabIndex: -1, autofocus: true }, "试用已结束"),
    h("p", {}, `${ent.TRIAL_DAYS} 天试用已结束。一次性买断即可永久使用全部功能：不是订阅，不会再收费。你的乐谱和设置都还在。`),
    h(
      "div",
      { class: "col" },
      h("button", { class: "primary", id: "buy-btn", onclick: () => void buyUnlock().then(finish) }, price ? `解锁完整版 ${price}` : "解锁完整版"),
      h("button", { id: "restore-btn", onclick: () => void restoreUnlock().then(finish) }, "恢复购买"),
      h("button", { onclick: () => dlg.close() }, "暂不"),
    ),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur();
}
/** false (and the unlock dialog is shown) when the trial is over and nothing was bought */
async function mayOpenScores(): Promise<boolean> {
  if (!ent.hasStore()) return true;
  const a = await ent.access();
  if (a.kind !== "expired") return true;
  showPaywall();
  return false;
}
/** the line + buttons in Settings (App Store needs "restore purchases" to be findable) */
function storeRows(): HTMLElement[] {
  if (!ent.hasStore()) return [];
  const label = h("span", { class: "grow" }, "…");
  const buy = h("button", { class: "rowbtn", id: "settings-buy", hidden: true, onclick: () => void buyUnlock().then(() => void update()) }, ic("star", 20), "解锁完整版");
  const restore = h("button", { class: "rowbtn", id: "settings-restore", onclick: () => void restoreUnlock().then(() => void update()) }, ic("refresh", 20), "恢复购买");
  const update = async () => {
    const a = await ent.access();
    label.textContent = a.kind === "owned" ? "已解锁完整版" : a.kind === "trial" ? `试用中，还剩 ${a.daysLeft} 天` : "试用已结束";
    buy.hidden = a.kind === "owned";
    restore.hidden = a.kind === "owned";
  };
  void update();
  return [h("div", { class: "row", id: "store-status" }, label), buy, restore];
}

// ---------- settings dialog ----------
// ---------- help & feedback: a mail to the developer, written in the app ----------
function openFeedback() {
  const title = h("input", { type: "text", placeholder: "简短的标题", maxLength: 120 });
  const kind = h(
    "select",
    {},
    h("option", { value: "Feedback" }, "意见"),
    h("option", { value: "Bug" }, "Bug"),
    h("option", { value: "Feature request" }, "期待的功能"),
  );
  const body = h("textarea", { rows: 6, placeholder: "请描述你遇到的问题或想法…" });
  const err = h("p", { class: "error" });
  const logCount = getLog().length;
  const attach = h("input", { type: "checkbox", checked: logCount > 0 });
  const send = () => {
    if (!title.value.trim()) return void (err.textContent = "请填写标题");
    if (!body.value.trim()) return void (err.textContent = "请填写描述");
    const info = [`App: Pianist Assistant ${__BUILD__}`, `Platform: ${navigator.platform || "?"}`, `Language: ${getLang()}`, `Storage: ${api.isLocal() ? "device" : "GitHub"}`, `Browser: ${navigator.userAgent}`];
    const url = `mailto:${__FEEDBACK_EMAIL__}?subject=${encodeURIComponent(`[${kind.value}] ${title.value.trim()}`)}&body=${encodeURIComponent(`${body.value.trim()}\n\n---\n${info.join("\n")}${attach.checked && logCount ? `\n\nError log:\n${formatLog()}` : ""}`)}`;
    dlg.close();
    (window as unknown as { __mail?: string }).__mail = url; // (for the tests)
    location.href = url;
    toast("已打开邮件应用，请在邮件里点发送", 6000);
  };
  const dlg = h(
    "dialog",
    { class: "dlg" },
    h("h2", { tabIndex: -1, autofocus: true }, "帮助与反馈"),
    h("label", {}, "标题", title),
    h("label", {}, "类型", kind),
    h("label", {}, "描述", body),
    h("p", { class: "muted small" }, "点“确认并发送”会打开你的邮件应用，邮件里会附上 App 版本和系统信息（不包含你的谱子）。"),
    ...(logCount ? [h("label", { class: "inline" }, `附上最近的错误记录（${logCount} 条，不含谱子内容和账号）`, attach), h("button", { class: "rowbtn", onclick: async () => { try { await navigator.clipboard.writeText(formatLog(6000)); toast("已复制错误记录"); } catch { toast("复制失败"); } } }, ic("note", 20), "复制错误记录")] : []),
    err,
    h("div", { class: "row" }, h("button", { onclick: () => dlg.close() }, "取消"), h("div", { class: "grow" }), h("button", { class: "primary", onclick: send }, "确认并发送")),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  (document.activeElement as HTMLElement | null)?.blur();
}

/** all scores / PDFs / settings of this device in one .zip (device storage mode) */
async function exportBackup() {
  const done = toast("正在备份…", 0, true);
  try {
    const files = await api.backupAll((n, total) => { const t = document.querySelector("#toasts .toast.working span"); if (t) t.textContent = `正在备份…（${n} / ${total}）`; });
    const z: Record<string, Uint8Array> = {};
    for (const f of files) z[`${f.dir}/${f.name}`] = new Uint8Array(f.data);
    const blob = new Blob([zipSync(z)], { type: "application/zip" });
    const link = h("a", { href: URL.createObjectURL(blob), download: `PianistAssistant-backup-${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(link);
    link.click();
    link.remove();
    done();
    toast("备份已生成");
  } catch (e) {
    done();
    showError("备份失败", e);
  }
}
async function importBackup(file: File) {
  try {
    const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const items = Object.entries(z).flatMap(([path, data]) => {
      const i = path.indexOf("/");
      const dir = path.slice(0, i);
      const name = path.slice(i + 1);
      return i < 1 || !["scores", "pdfs", "config"].includes(dir) || !name || name.includes("/") ? [] : [{ dir, name, data }];
    });
    if (!api.isLocal() && items.length && !confirm(`把备份里的 ${items.length} 个文件放回 GitHub 仓库？同名的文件会被备份里的版本覆盖。`)) return; // (no "done" message when cancelled)
    const done = toast("正在恢复…", 0, true);
    let n = 0;
    try {
      for (const f of items) {
        await api.restoreFile(f.dir, f.name, f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer);
        n++;
        const t = document.querySelector("#toasts .toast.working span"); if (t) t.textContent = `正在恢复…（${n} / ${items.length}）`;
      }
    } finally { done(); }
    toast(`已恢复 ${n} 个文件`);
    refreshHome?.();
  } catch (e) {
    showError("恢复失败", e);
  }
}

function openSettings(onSound?: () => void, onLayout?: () => void) {
  const dlg = h("dialog", { class: "dlg settings" });
  const sound = h("select", {}, ...SOUNDS.map((s) => h("option", { value: s.id, selected: s.id === settings.sound }, s.label)));
  sound.addEventListener("change", () => {
    settings.sound = sound.value;
    saveSettings(settings);
    onSound?.();
  });
  const scrollSelect = h(
    "select",
    { title: "谱面滚动" },
    h("option", { value: "page", selected: settings.scrollMode === "page" }, "整屏翻页（推荐）"),
    h("option", { value: "smooth", selected: settings.scrollMode === "smooth" }, "平滑滚动"),
    h("option", { value: "off", selected: settings.scrollMode === "off" }, "不滚动"),
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
  const mistakeBox = h("input", { type: "checkbox", checked: settings.gameDemoMistakes });
  mistakeBox.addEventListener("change", () => { settings.gameDemoMistakes = mistakeBox.checked; saveSettings(settings); });
  const judgeBox = h("input", { type: "checkbox", checked: settings.gameJudgeText });
  judgeBox.addEventListener("change", () => { settings.gameJudgeText = judgeBox.checked; saveSettings(settings); });
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
  const langSelect = h(
    "select",
    {},
    ...([["auto", "跟随系统"], ...LANGS] as const).map(([code, label]) => h("option", { value: code, selected: settings.lang === code }, label)),
  );
  langSelect.addEventListener("change", () => {
    settings.lang = langSelect.value as typeof settings.lang;
    saveSettings(settings);
    setLang(settings.lang);
    dispatchEvent(new Event("pianist-lang")); // re-measure anything whose text got longer / shorter
  });
  const restoreInput = h("input", { type: "file", accept: ".zip,application/zip", hidden: true });
  restoreInput.addEventListener("change", async () => {
    const f = restoreInput.files?.[0];
    restoreInput.value = "";
    if (f) await importBackup(f);
  });
  dlg.append(restoreInput);
  const a = api.getAuth();
  dlg.append(
    // the heading takes the initial focus: on iPad focusing a drop-down opens its list straight away
    // the title bar sticks to the top while the settings scroll, with a second "Done": no need to scroll down to close
    h("div", { class: "dlghead", id: "settings-head" }, h("h2", { tabIndex: -1, autofocus: true }, "设置"), h("div", { class: "grow" }), h("button", { class: "primary small", id: "done-top", onclick: () => dlg.close() }, "完成")),
    h("label", {}, "钢琴音色", sound),
    h("h3", {}, "外观"),
    h("div", { class: "group wide" }, ...themeBtns),
    h("h3", {}, "语言 / Language"),
    langSelect,
    h("h3", {}, "乐谱显示"),
    scrollSelect,
    h("label", { class: "inline" }, "高亮当前行", hlBox),
    h("label", { class: "inline" }, "预览下一行", peekBox),
    ...(settings.gameMode ? [h("label", { class: "inline" }, "显示判定文字和连击横幅（Perfect / Miss / COMBO）", judgeBox), h("label", { class: "inline" }, "游戏演示里加入失误（看特效用）", mistakeBox)] : []),
    ...(onLayout ? [h("label", { class: "inline" }, "四手联弹分屏", splitBox)] : []),
    h("h3", {}, "应用"),
    ...(__MOBILE__ ? [] : [
      h("button", { class: "rowbtn", id: "check-update", onclick: () => void checkUpdate() }, ic("refresh", 20), "检查更新"),
      h("button", { class: "rowbtn", id: "hard-refresh", title: "一直显示旧版本时使用，不会退出登录", onclick: () => void hardRefresh() }, ic("trash", 20), "强制刷新（清除缓存）"),
    ]),
    ...storeRows(),
    ...(__FEEDBACK_EMAIL__ ? [h("button", { class: "rowbtn", id: "feedback-btn", onclick: () => { dlg.close(); openFeedback(); } }, ic("note", 20), "帮助与反馈")] : []),
    h("p", { class: "muted small ver" }, `当前版本 ${__BUILD__}`),
    ...(api.isLocal() ? [
      h("h3", {}, "存储"),
      h("p", { class: "muted" }, "谱子保存在这台设备上，不需要账号。"),
      h("button", { class: "rowbtn", id: "backup-btn", onclick: () => void exportBackup() }, ic("note", 20), "备份：导出全部谱子"),
      h("button", { class: "rowbtn", id: "restore-btn", onclick: () => restoreInput.click() }, ic("plus", 20), "从备份恢复…"),
      ...(__LOCAL_ONLY__ ? [] : [h("button", { class: "rowbtn", id: "to-github", onclick: () => { api.leaveLocal(); dlg.close(); renderLogin(); } }, ic("refresh", 20), "连接 GitHub 同步…")]),
    ] : []),
    ...(api.isLocal() ? [] : [
      h("h3", {}, "备份"),
      h("p", { class: "muted" }, "谱子保存在你的 GitHub 仓库里。备份会把它们全部下载成一个压缩包；恢复会把压缩包里的文件放回仓库。"),
      h("button", { class: "rowbtn", id: "backup-btn", onclick: () => void exportBackup() }, ic("note", 20), "备份：导出全部谱子"),
      h("button", { class: "rowbtn", id: "restore-btn", onclick: () => restoreInput.click() }, ic("plus", 20), "从备份恢复…"),
    ]),
    ...(api.isLocal() ? [] : [h("h3", {}, "登录与设备")]),
    h(
      "p",
      { class: "muted", hidden: api.isLocal() },
      a ? `本设备：${a.user ?? "GitHub"} · ${a.repo} · ${api.isPersistent() ? "保持登录" : "仅本次"}` : "",
    ),
    ...(api.isLocal() ? [] : [h("button", { class: "rowbtn", id: "qr-btn", onclick: () => showQr() }, ic("qr", 20), "手机扫码登录")]),
    ...(api.isLocal() ? [] : [h("button", { class: "rowbtn", id: "copy-link", onclick: async () => {
      const cur = api.getAuth();
      if (!cur) return;
      try { await navigator.clipboard.writeText(api.makeLoginLink(cur)); toast("登录链接已复制，粘贴到另一台设备的登录页即可"); }
      catch { toast("复制失败，请改用扫码"); }
    } }, ic("hand", 20), "复制登录链接")]),
    ...(api.isLocal() ? [] : [h(
      "p",
      { class: "muted small" },
      "所有设备共用同一个令牌，所以无法单独移除某一台。如果设备丢失或怀疑泄露：到 ",
      h("a", { href: "https://github.com/settings/personal-access-tokens", target: "_blank", rel: "noopener" }, "GitHub 令牌管理"),
      " 删除令牌，所有设备会立即失效，再生成新令牌重新登录即可。",
    )]),
    ...(api.isLocal() ? [] : [h("div", { class: "row" }, h("button", { class: "danger", onclick: () => { api.logout(); dlg.close(); renderLogin(); } }, "退出本设备"))]),
  );
  // the title bar (with "Done") stays where it is; only the part below it scrolls (so pulling down on a tablet does not drag the title bar along)
  const head = dlg.querySelector("#settings-head")!;
  const body = h("div", { class: "dlgbody" });
  while (head.nextSibling) body.append(head.nextSibling);
  dlg.append(body);
  // touch screens hide the scroll bar: a soft fade at the bottom edge says "there is more below" (gone when you are at the end)
  const fade = h("div", { class: "dlgfade" });
  body.append(fade);
  const edges = () => {
    head.classList.toggle("scrolled", body.scrollTop > 4);
    dlg.classList.toggle("more", body.scrollHeight - body.scrollTop - body.clientHeight > 6);
  };
  body.addEventListener("scroll", edges);
  window.addEventListener("resize", edges);
  dlg.addEventListener("close", () => window.removeEventListener("resize", edges));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  edges(); // (is there more below?)
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

// ---------- several files at once: one question for the whole batch ----------
/** set while a multi-file upload runs: the first answer (with "same for all" ticked) is reused for the other files */
let batchCtx: { files: number; conflict: api.Conflict | null; pdf: "convert" | "keep" | "both" | null } = { files: 1, conflict: null, pdf: null };
const sameForAll = () => h("input", { type: "checkbox", checked: true });
const sameForAllRow = (box: HTMLInputElement) => (batchCtx.files > 1 ? h("label", { class: "inline" }, box, "对本次选的全部文件都这样处理") : null);

/** which recogniser the cloud converter uses (remembered): Audiveris is the default, homr (deep learning) and "both" are for comparing */
function engineRow(): HTMLElement {
  const sel = h(
    "select",
    {},
    h("option", { value: "audiveris", selected: settings.ocrEngine === "audiveris" }, "Audiveris（默认）"),
    h("option", { value: "homr", selected: settings.ocrEngine === "homr" }, "homr（深度学习，实验）"),
    h("option", { value: "oemer", selected: settings.ocrEngine === "oemer" }, "oemer（深度学习，可内置 App）"),
    h("option", { value: "both", selected: settings.ocrEngine === "both" }, "Audiveris + homr（对比）"),
    h("option", { value: "all", selected: settings.ocrEngine === "all" }, "三个都转（对比）"),
  );
  sel.addEventListener("change", () => { settings.ocrEngine = sel.value as typeof settings.ocrEngine; saveSettings(settings); });
  return h("label", { class: "engine" }, "转换引擎", sel);
}

// ---------- what to do with an uploaded PDF ----------
function askPdfMode(name: string): Promise<"convert" | "keep" | "both" | "cancel"> {
  if (batchCtx.pdf) return Promise.resolve(batchCtx.pdf);
  return new Promise((resolve) => {
    let answer: "convert" | "keep" | "both" | "cancel" = "cancel";
    const all = sameForAll();
    const pick = (a: typeof answer) => () => { answer = a; if (a !== "cancel" && all.checked && batchCtx.files > 1) batchCtx.pdf = a; dlg.close(); };
    const dlg = h(
      "dialog",
      { class: "dlg center" },
      h("h2", {}, "这份 PDF 怎么处理？"),
      h("p", { class: "small" }, name),
      h("p", { class: "muted small" }, "转换成可播放乐谱靠自动识别（需要几分钟），识别结果不一定准，常有音符、调号或节奏出错。保留 PDF 则原样存放，可以像图片谱一样直接看，但不能播放、也没有指法。"),
      h("p", { class: "muted small" }, "想要最好的效果，请直接上传 MusicXML 文件（.musicxml / .mxl），可以从 MuseScore 等乐谱软件导出。"),
      engineRow(),
      sameForAllRow(all),
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
  if (batchCtx.conflict) return Promise.resolve(batchCtx.conflict);
  return new Promise((resolve) => {
    let answer: api.Conflict = "skip";
    const all = sameForAll();
    const msg =
      info.kind === "queued"
        ? `「${info.existing}」已经在转换队列中（转换通常需要 3–10 分钟），不需要重复上传。`
        : info.kind === "convert"
          ? `已有乐谱「${displayName(info.existing)}」。这份 PDF / 图片转换完成后会覆盖它（包括你在其中标注的指法）。`
          : `已有同名文件「${displayName(info.existing)}」。`;
    const done = (a: api.Conflict) => () => {
      answer = a;
      if (all.checked && batchCtx.files > 1) batchCtx.conflict = a; // the other files of this batch get the same answer
      dlg.close();
    };
    const dlg = h(
      "dialog",
      { class: "dlg center" },
      h("h2", {}, "文件名重复"),
      h("p", {}, msg),
      h("p", { class: "muted small" }, "替换：用新文件覆盖旧的（旧版本仍可在 GitHub 历史里找回）。保留两份：新文件自动改名，比如“名称 (2)”。"),
      sameForAllRow(all),
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

/** A failure the user can read, with what to try, and copy to send to someone. */
function showError(title: string, e: unknown) {
  logError(e, title);
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

/** A small message in the middle of the screen (modal): one button, or two when `confirmLabel` is given. Resolves true when the main button was pressed. */
function popup(title: string, text: string, confirmLabel?: string, party = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const dlg = h("dialog", { class: "dlg popup game" + (party ? " unlock" : "") },
      h("h2", { tabIndex: -1, autofocus: true }, title),
      text ? h("p", { class: "muted" }, text) : null,
      h("div", { class: "row wrap" }, h("div", { class: "grow" }),
        ...(confirmLabel ? [h("button", { onclick: () => dlg.close() }, "取消")] : []),
        h("button", { class: "primary", onclick: () => { result = true; dlg.close(); } }, confirmLabel ?? "好的")),
    ) as HTMLDialogElement;
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    if (party) window.setTimeout(() => confetti(dlg), 520); // after the pop-in animation (a transform would trap the full-screen canvas); (inside the dialog: it lives in the top layer, so the confetti is above everything)
  });
}
/** The note at the top left: with game mode on it becomes a glowing note with a spark, so you can see the hidden mode is on. */
function updateLogo() {
  if (settings.gameMode) document.documentElement.dataset.gamemode = "1"; else delete document.documentElement.dataset.gamemode;
  const el = document.querySelector<HTMLElement>(".top .brand .logo");
  if (!el) return;
  el.classList.toggle("game", settings.gameMode);
  el.title = settings.gameMode ? "游戏模式" : "";
  el.replaceChildren(ic(settings.gameMode ? "game-note" : "note", settings.gameMode ? 24 : 20));
}
/** The hidden game mode: tap the note at the top left of the home screen 10 times (taps no more than 2 s apart) to switch it on; one tap asks whether to switch it off. */
let eggTaps = 0, eggLast = 0, eggBusy = false, eggCool = 0;
const noteName = (m: number) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][m % 12] + (Math.floor(m / 12) - 1);
function onLogoTap(rerender: () => void) {
  // fast tapping overshoots: right after switching on, more taps must not ask "switch off?" (not while the unlock message is up or coming, not for a moment after it)
  if (eggBusy || Date.now() < eggCool || document.querySelector("dialog.popup[open]")) return;
  if (settings.gameMode) {
    void popup("关闭游戏模式？", "", "关闭").then((yes) => {
      if (!yes) return;
      settings.gameMode = false; settings.gameView = false; saveSettings(settings); applyGameTheme(); window.dispatchEvent(new Event("pianist-game"));
      toast("游戏模式已关闭");
      rerender();
    });
    return;
  }
  const now = Date.now();
  eggTaps = now - eggLast > 2000 ? 1 : eggTaps + 1;
  eggLast = now;
  const logo = document.querySelector<HTMLElement>(".top .brand .logo");
  const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* no vibration (iPad / desktop) */ } };
  const anim = (cls: string, ms: number) => { if (!logo) return; logo.classList.remove(cls); void logo.offsetWidth; logo.classList.add(cls); setTimeout(() => logo.classList.remove(cls), ms); };
  if (eggTaps === 5) { anim("shake", 600); buzz(25); } // halfway: the note shakes a little, "something is happening"
  if (eggTaps >= 10) {
    eggTaps = 0;
    anim("flash", 800); buzz([30, 60, 30, 60, 90]);
    settings.gameMode = true; saveSettings(settings);
    let first = true;
    try { first = !localStorage.getItem(UNLOCKED); localStorage.setItem(UNLOCKED, "1"); } catch { /* ignore */ }
    eggBusy = true;
    window.setTimeout(() => { rerender(); void popup(first ? "隐藏模式已解锁" : "游戏模式已开启", "打开乐谱，点顶部的“游戏”即可。", undefined, first).then(() => { eggBusy = false; eggCool = Date.now() + 1500; }); }, 650); // the flash is seen first
  }
}
const UNLOCKED = "pianist.game.unlocked.v1"; // confetti only the first time
/** The practice / game switch at the top of a score screen (only when game mode is on). */
function modeToggle(): HTMLElement | null {
  if (!settings.gameMode) return null;
  const mk = (game: boolean, label: string) => h("button", { class: "seg" + (settings.gameView === game ? " on" : ""), "data-mode": game ? "game" : "practice", onclick: (e: Event) => {
    if (settings.gameView === game) return;
    settings.gameView = game; saveSettings(settings); applyGameTheme(); window.dispatchEvent(new Event("pianist-game"));
    const g = (e.currentTarget as HTMLElement).parentElement!;
    g.querySelectorAll(".seg").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.mode === (game ? "game" : "practice")));
  } }, label);
  return h("div", { class: "group modetoggle" }, mk(false, "练习"), mk(true, "游戏"));
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
  const list = h("div", { class: "grid two" });
  const status = h("p", { class: "muted" }, "加载中…");
  const listBox = h("div", { class: "listbox" }, status, list); // the one scroll area of the page
  const recent = h("div", { class: "grid two" });
  const recentSec = h("section", { class: "recentsec" }, h("h2", {}, "最近打开"), recent);
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
    h("p", { class: "muted small" }, "想要最好的效果，请直接上传 MusicXML 文件（.musicxml / .mxl），可以从 MuseScore 等乐谱软件导出。"),
  );
  // tabs under "recently opened": all / four hands / PDF / favourites
  type Tab = "all" | "duet" | "pdf" | "fav";
  const TABS: [Tab, string][] = [["all", "全部琴谱"], ["duet", "四手联弹"], ["pdf", "PDF 乐谱"], ["fav", "收藏"]];
  /** the names on a small screen (the full names are for wide screens) */
  const TAB_SHORT: Record<string, string> = { all: "全部", duet: "四手联弹", pdf: "PDF", fav: "收藏" };
  let tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(getHomeTab()) ? (getHomeTab() as Tab) : "all";
  const TAB_ICON: Record<string, string> = { all: "note", duet: "duet", pdf: "file", fav: "star" };
  // every tab has an icon too: normally only the favourites tab shows its star, but when the names do not fit (small screen, long language)
  // the tabs turn into icons (see fit.ts)
  const tabBtns = TABS.map(([k, label]) =>
    h("button", { class: "seg" + (tab === k ? " on" : ""), "data-k": k, title: label, onclick: () => {
      tab = k;
      setHomeTab(k);
      tabBtns.forEach((b, i) => b.classList.toggle("on", TABS[i][0] === k));
      moveBlob(true);
      renderList();
      listBox.scrollTop = 0;
    } }, h("span", { class: "tabicon" }, ic(TAB_ICON[k], 18)), h("span", { class: "lbl" }, h("span", { class: "tl-full" }, label), h("span", { class: "tl-short" }, TAB_SHORT[k])), h("span", { class: "tabcount" })),
  );
  // The highlight of the chosen tab is a block that slides over to the new tab: first stretched across both (like a drop of water being pulled),
  // then it settles with a small jelly wobble. While it is stretched across the tabs in between it is see-through and becomes solid again as it
  // arrives, so it never looks as if several tabs were chosen at once. (With the "reduce motion" setting of the system it just jumps.)
  const tabBlob = h("span", { class: "tabblob" });
  const tabGroup = h("div", { class: "group wide" }, tabBlob, ...tabBtns);
  // order of the lists: ONE setting for all tabs (button at the right end of the tab bar)
  const SORTS: [typeof settings.sortBy, string, string][] = [["name", "名称（A → Z）", "字母 / 拼音顺序"], ["added", "添加时间", "新添加的在前"], ["opened", "最近打开", "刚打开过的在前，没打开过的在后"]];
  const sortMenu = h("div", { class: "sortmenu", hidden: true, role: "menu" });
  const sortBtn = h("button", { class: "sortbtn", title: "排序", "aria-haspopup": "true", onclick: (e: Event) => { e.stopPropagation(); if (sortMenu.hidden) buildSortMenu(); setSortOpen(sortMenu.hidden); } }, ic("sort", 22));
  const setSortOpen = (open: boolean) => { sortMenu.hidden = !open; sortBtn.classList.toggle("open", open); }; // the button is blue while its menu is open
  function buildSortMenu() {
    sortMenu.replaceChildren(
      ...SORTS.map(([k, label, hint]) => h("button", { class: "sortopt" + (settings.sortBy === k ? " on" : ""), "data-sort": k, role: "menuitemradio", onclick: () => { settings.sortBy = k; saveSettings(settings); buildSortMenu(); renderList(); } },
        h("span", { class: "sortcheck" }, settings.sortBy === k ? ic("check", 18) : ""), h("span", { class: "sorttxt" }, h("b", {}, label), h("small", {}, hint)))),
      h("label", { class: "inline sortrev" }, "倒序", h("input", { type: "checkbox", checked: settings.sortReverse, onchange: (e: Event) => { settings.sortReverse = (e.target as HTMLInputElement).checked; saveSettings(settings); renderList(); } })),
    );
  }
  document.addEventListener("click", (e) => { if (!sortMenu.hidden && !(e.target as HTMLElement).closest(".sortmenu, .sortbtn")) setSortOpen(false); });
  const tabsBar = h("div", { class: "tabsbar" }, tabGroup, sortBtn, sortMenu);
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function moveBlob(animate: boolean) {
    const on = tabBtns.find((b) => b.classList.contains("on"));
    if (!on || !on.offsetWidth) return;
    const L1 = on.offsetLeft, W1 = on.offsetWidth;
    const L0 = parseFloat(tabBlob.style.left) || L1, W0 = parseFloat(tabBlob.style.width) || W1;
    tabBlob.style.left = `${L1}px`;
    tabBlob.style.width = `${W1}px`;
    tabBlob.getAnimations().forEach((a) => a.cancel());
    if (!animate || reducedMotion() || !tabBlob.animate || (Math.abs(L0 - L1) < 1 && Math.abs(W0 - W1) < 1)) return;
    const Ls = Math.min(L0, L1), Ws = Math.max(L0 + W0, L1 + W1) - Ls; // stretched over the old and the new tab
    // jelly: after the slide the front edge overshoots a little (at most ~12 px), the back edge follows less, then they wobble back and forth
    // with less and less, and rest. (Restrained on purpose: it should feel like a real object, not like a show.)
    const dir = L1 >= L0 ? 1 : -1;
    const R1 = L1 + W1;
    const o = Math.min(12, Math.max(4, Math.abs(L1 - L0) * 0.04));
    const wobble = (lead: number, trail: number) => {
      const front = dir * lead * o, back = dir * trail * o;
      const left = dir > 0 ? L1 + back : L1 + front, right = dir > 0 ? R1 + front : R1 + back;
      return { left: `${left}px`, width: `${right - left}px` };
    };
    tabBlob.animate(
      [
        { left: `${L0}px`, width: `${W0}px`, opacity: 1, easing: "cubic-bezier(.3, 0, .2, 1)" },
        { left: `${Ls}px`, width: `${Ws}px`, opacity: 0.38, offset: 0.3, easing: "cubic-bezier(.3, 0, .3, 1)" },
        { ...wobble(1, 0.4), opacity: 0.85, offset: 0.52, easing: "ease-in-out" },
        { ...wobble(-0.45, -0.15), opacity: 1, offset: 0.68, easing: "ease-in-out" },
        { ...wobble(0.2, 0.08), opacity: 1, offset: 0.83, easing: "ease-in-out" },
        { left: `${L1}px`, width: `${W1}px`, opacity: 1 },
      ],
      { duration: 640 },
    );
  }
  new ResizeObserver(() => moveBlob(false)).observe(tabGroup); // (first display, window size, language)

  // favourites: a star on every card; kept on the device and synced through the scores repository
  let favs = new Set(getFavs());
  let favDirty = false; // a change of ours is not on the server yet
  let favTimer = 0;
  let favVersion = 0;
  let favWroteAt = 0;
  /** save soon (several taps in a row make one write); the newest write decides when we are "clean" again */
  const saveFavsSoon = () => {
    favDirty = true;
    const mine = ++favVersion;
    clearTimeout(favTimer);
    favTimer = window.setTimeout(() => {
      api.writeFavs([...favs]).then(() => { favWroteAt = Date.now(); if (mine === favVersion) favDirty = false; }).catch(() => toast("保存失败"));
    }, 600);
  };
  const favKey = { score: (n: string) => `s:${n}`, pair: (p: { a: string; b: string }) => `p:${p.a}|${p.b}`, pdf: (n: string) => `f:${n}` };
  const starState = (b: Element, k: string) => {
    b.classList.toggle("on", favs.has(k));
    b.setAttribute("title", favs.has(k) ? "取消收藏" : "加入收藏");
  };
  const toggleFav = (k: string) => {
    if (favs.has(k)) favs.delete(k); else favs.add(k);
    setFavs([...favs]);
    document.querySelectorAll(".star[data-k]").forEach((b) => { if (b.getAttribute("data-k") === k) starState(b, k); });
    updateTabCounts();
    if (tab === "fav") renderList();
    saveFavsSoon();
    toast(favs.has(k) ? "已加入收藏" : "已取消收藏", 1500);
  };
  /** an item was renamed / re-paired: its favourite mark moves with it */
  const moveFav = (from: string, to: string) => {
    if (!favs.has(from) || from === to) return;
    favs.delete(from);
    favs.add(to);
    setFavs([...favs]);
    saveFavsSoon();
  };
  const starBtn = (k: string) => {
    const b = h("button", { class: "star", "data-k": k, onclick: () => toggleFav(k) }, ic("star", 20));
    starState(b, k);
    return b;
  };
  let lastScores: api.ScoreInfo[] = [];
  let lastPdfs: api.ScoreInfo[] = [];
  let pairs: api.Pair[] = [];
  let allScores: string[] = [];
  // first start with an empty library: a short welcome with a button that adds a few example scores
  const SAMPLES = ["Ode to Joy (Primo).musicxml", "Ode to Joy (Secondo).musicxml", "C major scale.musicxml"];
  const WELCOME_KEY = "pianist.welcome.v1";
  const welcomeDone = () => { try { return !!localStorage.getItem(WELCOME_KEY); } catch { return false; } };
  const dismissWelcome = () => { try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* ignore */ } welcome.hidden = true; };
  const addSamples = async () => {
    const done = toast("正在添加示例曲目…", 0, true);
    try {
      for (const f of SAMPLES) {
        const r = await fetch(new URL(import.meta.env.BASE_URL + "samples/" + encodeURIComponent(f), location.href));
        if (!r.ok) throw new Error(`示例曲目下载失败 (${r.status})`);
        await api.putScoreText(f, await r.text(), `Add example: ${f}`);
      }
      // the two parts of the four-hand example are one piece
      await api.writePairs([...(await api.readPairs()), { name: "Ode to Joy (4 hands)", a: SAMPLES[0], b: SAMPLES[1] }]);
      dismissWelcome();
      done();
      toast(`已添加 ${SAMPLES.length} 份示例曲目`);
      refreshHome?.();
    } catch (e) {
      done();
      showError("添加示例曲目失败", e);
    }
  };
  const welcome = h("div", { class: "welcome", hidden: true },
    h("h2", {}, "欢迎！先试一试"),
    h("ol", {}, h("li", {}, "添加示例曲目，或点右上角“上传琴谱”（支持 MusicXML / .mxl / PDF）。"), h("li", {}, "点开一份谱子，点谱面上的任意位置，就从那里开始播放。"), h("li", {}, "遇到问题：设置里点“帮助与反馈”。")),
    h("div", { class: "row wrap" }, h("button", { class: "primary", id: "add-samples", onclick: () => void addSamples() }, "添加示例曲目"), h("button", { id: "skip-welcome", onclick: dismissWelcome }, "不用了，我自己上传")));
  const suggest = h("div", { class: "suggest" });
  const savePairs = async (next: api.Pair[], done = "") => {
    try {
      const adding = next.length > pairs.length;
      const closeBusy = toast(adding ? "正在合成四手联弹…稍等片刻，它会出现在列表里" : "正在保存…", 120000, true);
      try {
        await api.writePairs(next);
      } finally {
        closeBusy();
      }
      pairs = next;
      if (adding) toast(`✅ 已合成四手联弹「${next[next.length - 1].name}」，在列表里（带蓝色标记的那张）`, 6000);
      else if (done) toast(`✅ ${done}`);
      void load();
    } catch (e) {
      if (e instanceof api.AuthExpired) return void renderLogin(e.message);
      toast(`保存失败：${(e as Error).message}`);
    }
  };
  const file = h("input", { type: "file", accept: ".musicxml,.xml,.mxl,.zip,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,application/pdf,image/*,application/zip,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,text/xml", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    const stored: string[] = [];
    const picked = Array.from(file.files ?? []);
    batchCtx = { files: picked.length, conflict: null, pdf: null };
    for (const f of picked) {
      let closeUp = () => {}; // the "uploading…" message stays until this file is done
      try {
        let mode: "convert" | "keep" | "both" = "convert";
        if (/\.pdf$/i.test(f.name)) {
          if (api.isLocal()) {
            mode = "keep"; // conversion needs the GitHub service
            toast("本机模式：PDF 只能保存和查看，不能转换成可播放乐谱", 6000);
          } else {
            const a = await askPdfMode(f.name);
            if (a === "cancel") { toast(`已取消：${f.name}`); continue; }
            mode = a;
          }
        }
        closeUp = toast(`上传中：${f.name}`, 120000, true);
        if (mode !== "convert") {
          const kept = await api.storePdf(f, askConflict);
          toast(kept ? `已保存 PDF：${kept}（在下面的“PDF 乐谱”里）` : `已跳过：${f.name}`);
          if (mode === "keep") continue;
        }
        const up = await api.uploadScore(f, askConflict, settings.ocrEngine);
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
        closeUp();
        if (e instanceof api.AuthExpired) return renderLogin(e.message);
        showError(`上传失败：${f.name}`, e);
      } finally {
        closeUp();
      }
    }
    file.value = "";
    batchCtx = { files: 1, conflict: null, pdf: null };
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
      h("h1", { class: "brand" }, h("span", { class: "logo" + (settings.gameMode ? " game" : ""), title: settings.gameMode ? "游戏模式" : "", onclick: () => onLogoTap(updateLogo) }, ic(settings.gameMode ? "game-note" : "note", settings.gameMode ? 24 : 20)), "我的琴谱"),
      h("div", { class: "grow" }),
      h("button", { class: "icon", title: "刷新列表并检查更新", onclick: () => doRefresh() }, ic("refresh")),
      h("button", { class: "primary upload", title: "上传琴谱", onclick: () => file.click() }, ic("plus", 20), h("span", { class: "lbl" }, "上传琴谱")),
      h("button", { class: "icon", onclick: () => openSettings(), title: "设置" }, ic("sliders")),
    ),
    file,
    h("main", { class: "home" }, welcome, queueSec, suggest, recentSec, tabsBar, listBox),
  );

  /** `run` returns false when the user cancelled (nothing happened); `done` is the message after a successful delete */
  const deleteAction = (label: string, run: (start: () => void) => Promise<boolean | void>, done: string) => ({
    label,
    icon: "trash",
    danger: true,
    run: async () => {
      let closeBusy = () => {};
      try {
        // the confirmation (inside run) comes first; the progress message is only for the real work
        const ok = await run(() => { closeBusy = toast("正在删除…", 120000, true); });
        closeBusy();
        if (ok === false) return;
        toast(done);
        void load();
      } catch (e) {
        closeBusy();
        toast(`删除失败：${(e as Error).message}`, 6000);
      }
    },
  });
  const pairCard = (p: api.Pair) => {
    return h(
      "div",
      { class: "card pair" },
      h("button", { class: "open", onclick: () => (location.hash = duetHash(p)) }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(p.name)))),
      starBtn(favKey.pair(p)),
      h("button", { class: "del", title: "更多", onclick: () => openCardMenu(p.name, [
        { label: "重命名…", icon: "pencil", run: async () => {
          const v = await askText("重命名这首四手联弹", p.name, "保存");
          if (v && v !== p.name) void savePairs(pairs.map((q) => (q === p ? { ...q, name: v } : q)), "已重命名");
        } },
        { label: "交换 A / B 声部", icon: "refresh", run: () => { moveFav(favKey.pair(p), favKey.pair({ a: p.b, b: p.a })); void savePairs(pairs.map((q) => (q === p ? { ...q, a: q.b, b: q.a } : q)), "已交换 A / B 声部"); } },
        { label: "重新选择 A / B 文件…", icon: "note", run: async () => {
          const r = await openPairDialog({ scores: allScores, a: p.a, b: p.b, name: p.name, title: "修改四手联弹", okLabel: "保存" });
          if (r) { moveFav(favKey.pair(p), favKey.pair(r)); void savePairs(pairs.map((q) => (q === p ? r : q)), "已保存四手联弹设置"); }
        } },
        { label: "取消关联（两个文件各自保留）", icon: "x", run: () => void savePairs(pairs.filter((q) => q !== p), "已取消关联，两个文件各自保留") },
        deleteAction("删除这首四手联弹（两个文件都会删除）", async (start) => {
          if (!confirm(`删除四手联弹「${p.name}」？两个文件都会被删除。`)) return false;
          start();
          await api.writePairs(pairs.filter((q) => q !== p));
          await api.deleteScore(p.a);
          await api.deleteScore(p.b);
        }, `已删除四手联弹「${p.name}」`),
      ]) }, ic("chevron-down", 20)),
    );
  };
  const pdfCard = (name: string) =>
    h(
      "div",
      { class: "card pdf" },
      h("button", { class: "open", onclick: () => { markOpened(`pdf:${name}`); location.hash = `#/pdf/${encodeURIComponent(name)}`; } }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(name.replace(/\.pdf$/i, ""))))),
      starBtn(favKey.pdf(name)),
      h("button", { class: "del", title: "更多", onclick: () => openCardMenu(name.replace(/\.pdf$/i, ""), [
        ...(api.isLocal() ? [] : [{ label: "转换成可播放乐谱（识别可能不准）", icon: "refresh", run: async () => {
          try {
            const n = await api.convertStoredPdf(name, settings.ocrEngine);
            optimistic.set(n, Date.now());
            markQueued(n);
            prevPending.add(n);
            toast(`已加入转换队列：${n}`);
            void load();
          } catch (e) {
            showError("无法转换", e);
          }
        } }]),
        deleteAction("删除这份 PDF", async (start) => {
          if (!confirm(`删除 PDF「${name}」？`)) return false;
          start();
          await api.deletePdf(name);
        }, `已删除 PDF「${name}」`),
      ]) }, ic("chevron-down", 18)),
    );
  const partOf = (name: string) => pairs.filter((p) => p.a === name || p.b === name);
  const card = (name: string, withMenu = false) =>
    h(
      "div",
      { class: "card" },
      h("button", { class: `open${isNew(name) ? " isnew" : ""}`, onclick: () => { clearNew(name); location.hash = `#/score/${encodeURIComponent(name)}`; } }, h("span", { class: "ttl" }, h("div", { class: "trow" }, marquee(displayName(name))),
        partOf(name).length ? h("div", { class: "muted small sub" }, marquee(partOf(name).map((p) => `${p.a === name ? "A" : "B"} 声部 · 四手联弹「${p.name}」`).join("；"))) : null)),
      starBtn(favKey.score(name)),
      withMenu &&
        h("button", { class: "del", title: "更多", onclick: () => openCardMenu(displayName(name), [
          // the PDF this score was converted from (kept when "both" was chosen): open it to check the result against the original
          ...(lastPdfs.some((p) => p.name.replace(/\.pdf$/i, "") === displayName(name))
            ? [{ label: "查看原 PDF（对照）", icon: "note", run: () => { location.hash = `#/pdf/${encodeURIComponent(displayName(name) + ".pdf")}`; } }]
            : []),
          { label: "重命名…", icon: "pencil", run: async () => {
            const v = await askText("重命名", displayName(name), "保存");
            if (!v || v === displayName(name)) return;
            const closeBusy = toast("正在重命名…", 120000, true);
            try {
              const next = await api.renameScore(name, v);
              renameRecent(name, next);
              moveFav(favKey.score(name), favKey.score(next));
              for (const p of pairs) if (p.a === name || p.b === name) moveFav(favKey.pair(p), favKey.pair({ a: p.a === name ? next : p.a, b: p.b === name ? next : p.b }));
              if (partOf(name).length) await api.writePairs(pairs.map((p) => ({ ...p, a: p.a === name ? next : p.a, b: p.b === name ? next : p.b })));
              closeBusy();
              toast(`✅ 已重命名为「${displayName(next)}」`);
              void load();
            } catch (e) {
              closeBusy();
              toast(`重命名失败：${(e as Error).message}`, 6000);
            }
          } },
          { label: "设为四手联弹…（与另一份合成）", icon: "note", run: async () => {
            const free = allScores;
            if (free.length < 2) { toast("需要至少有两份谱子"); return; }
            const r = await openPairDialog({ scores: free, a: name, title: "设为四手联弹", intro: "选出两个人各自的谱子：A 在上面一屏，B 在下面一屏。", okLabel: "合成四手联弹" });
            if (r) void savePairs([...pairs, r]);
          } },
          deleteAction("删除这份乐谱", async (start) => {
            const inUse = partOf(name);
            const extra = inUse.length ? `\n它是四手联弹「${inUse.map((p) => p.name).join("、")}」的一个声部，删除后这首四手联弹也会消失（另一个声部的谱子保留）。` : "";
            if (!confirm(`删除「${displayName(name)}」？${extra}`)) return false;
            start();
            if (inUse.length) await api.writePairs(pairs.filter((p) => !inUse.includes(p)));
            await api.deleteScore(name);
          }, `已删除「${displayName(name)}」`),
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
        try { await api.deleteInbox(it.name); clearQueued(it.name); optimistic.delete(it.name); toast(`已从队列中删除「${it.name}」`); load(); } catch (e) { toast((e as Error).message); }
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

  /** reload the list (and look for a new app version): a spinner message while it runs, gone when it is done */
  function doRefresh() {
    const close = toast("正在刷新…", 30000, true);
    void load().finally(close);
    void checkUpdate(true);
  }
  /** fill the list for the chosen tab */
  /** the number of items behind every tab (a quick overview, and the tab bar is easier to see) */
  function updateTabCounts() {
    const all = [...pairs.map((p) => favKey.pair(p)), ...lastScores.map((x) => favKey.score(x.name))];
    const pdfKeys = lastPdfs.map((x) => favKey.pdf(x.name));
    const counts: Record<string, number> = { all: all.length, duet: pairs.length, pdf: pdfKeys.length, fav: [...all, ...pdfKeys].filter((k) => favs.has(k)).length };
    tabBtns.forEach((b, i) => {
      const c = b.querySelector(".tabcount") as HTMLElement | null;
      if (c) { c.textContent = String(counts[TABS[i][0]]); c.hidden = counts[TABS[i][0]] === 0; }
    });
  }
  function renderList() {
    updateTabCounts();
    const scoreItems = lastScores.map((x) => ({ id: x.name, key: displayName(x.name), k: favKey.score(x.name), el: () => card(x.name, true) }));
    const pairItems = pairs.map((p) => ({ id: pairKey(p), key: `${p.name}\u0000`, k: favKey.pair(p), el: () => pairCard(p) }));
    const pdfItems = lastPdfs.map((x) => ({ id: `pdf:${x.name}`, key: x.name, k: favKey.pdf(x.name), el: () => pdfCard(x.name) }));
    const allItems = [...pairItems, ...scoreItems, ...pdfItems];
    const items = (tab === "all" ? [...pairItems, ...scoreItems] : tab === "duet" ? pairItems : tab === "pdf" ? pdfItems : [...pairItems, ...scoreItems, ...pdfItems].filter((i) => favs.has(i.k)));
    const seen = getSeen(allItems.map((i) => i.id)); const opened = getOpened();
    // name: A → Z; added / opened: the newest first, what has no time (old, never opened) after it, by name; "reverse" turns the whole list round
    const byName = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, "zh");
    items.sort(settings.sortBy === "name" ? byName : (a, b) => ((settings.sortBy === "added" ? seen : opened)[b.id] ?? 0) - ((settings.sortBy === "added" ? seen : opened)[a.id] ?? 0) || byName(a, b));
    if (settings.sortReverse) items.reverse();
    list.replaceChildren(...items.map((i) => i.el()));
    status.replaceChildren(
      ...(items.length
        ? tab === "pdf" ? [h("span", {}, "原样保存的 PDF，只能查看，不能播放。")] : []
        : tab === "all" ? ["还没有琴谱，点右上角“上传琴谱”（支持 MusicXML / .mxl / PDF）。"]
        : tab === "duet" ? ["还没有四手联弹。一次上传两份谱子，或在谱子卡片的 ▾ 菜单里选“设为四手联弹”。"]
        : tab === "pdf" ? ["还没有 PDF。上传 PDF 时选“只保留 PDF”或“两个都要”。"]
        : ["还没有收藏。点卡片上的 ☆ 就能加入收藏。"]),
    );
    armMarquee();
  }

  async function load() {
    if (token !== renderSeq) return;
    clearTimeout(homeTimer);
    try {
      const listed = await api.listInbox().catch((e) => { if (e instanceof api.AuthExpired) throw e; return [] as api.InboxItem[]; });
      const scores = await api.listScores();
      let pdfsOk = true;
      const pdfs = await api.listPdfs().catch(() => { pdfsOk = false; return [] as api.ScoreInfo[]; });
      if (token !== renderSeq) return;
      if (api.isOffline() && !offlineToldAt) { offlineToldAt = Date.now(); toast("离线：显示的是上次同步的内容，修改和上传要联网后才能进行", 8000); }
      if (!api.isOffline()) { offlineToldAt = 0; if (!prefetched) { prefetched = true; void api.prefetchLibrary(); } }
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
      if (!favDirty && Date.now() - favWroteAt > 20000) { const rf = await api.readFavs(); if (rf) { favs = new Set(rf); setFavs(rf); } } // favourites follow you between devices
      if (token !== renderSeq) return;
      const inPair = new Set(pairs.flatMap((p) => [p.a, p.b]));
      // every score stays in the list (each part can be practised alone); a combined piece is an extra card
      lastScores = scores;
      lastPdfs = pdfs;
      welcome.hidden = welcomeDone() || scores.length > 0 || pdfs.length > 0 || pairs.length > 0; // only on an empty library, until it is dismissed or used
      // favourites of things that no longer exist (deleted, unlinked) are dropped; only when the lists are complete
      if (!api.isOffline() && !favDirty) {
        const alive = new Set([...scores.map((x) => favKey.score(x.name)), ...pairs.map((p) => favKey.pair(p)), ...pdfs.map((x) => favKey.pdf(x.name))]);
        const kept = [...favs].filter((k) => alive.has(k) || (!pdfsOk && k.startsWith("f:")));
        if (kept.length !== favs.size) {
          favs = new Set(kept);
          setFavs(kept);
          favWroteAt = Date.now();
          void api.writeFavs(kept).catch(() => {});
        }
      }
      renderList();
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
                h("button", { onclick: () => { dismissPair(g.a, g.b); toast("好的，不再提示这两份"); void load(); } }, "不是"),
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
        .slice(0, 4); // only the last four
      recent.replaceChildren(...rec);
      recentSec.hidden = rec.length === 0;
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
    if (go) doRefresh();
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

/** Vertical extent of every line (system) of a view in holder pixels, INCLUDING what is drawn above and below the staves
 *  (bar-number boxes, slurs, dynamics, high notes). `y` is the top staff line area. */
function systemExtents(v: View): { top: number; bottom: number; y: number }[] {
  const svg = v.holder.querySelector("svg");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const systems: any[] | undefined = (v.osmd.GraphicSheet as any)?.MusicPages?.[0]?.MusicSystems;
  if (!svg || !systems?.length) return [];
  const hr = v.holder.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  const k = 10 * v.osmd.zoom;
  const oy = sr.top - hr.top;
  return systems.map((s) => {
    const p = s.PositionAndShape;
    const y = oy + p.AbsolutePosition.y * k;
    return { top: y + p.BorderTop * k, bottom: y + p.BorderBottom * k, y };
  });
}

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
      h("button", { class: "back", title: "返回", onclick: () => { if (leaveGuard()) location.hash = "#/"; } }, ic("chevron-left", 22), h("span", { class: "lbl" }, "返回")),
      h("h1", {}, displayName(name)),
      modeToggle(),
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
      autoResize: false, // we redraw ourselves (see relayout): the library would also redraw windows that are folded away, with width 0
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
    osmd.EngravingRules.RenderFingerings = false; // every number is drawn by our own overlay: showing / hiding needs no redraw of the score
    osmd.render();
    osmd.cursor.show();
    const tools = new FingerTools(osmd, holder, xml, !split);
    undo.push(() => tools.dispose());
    tools.visible = settings.fingers;
    tools.refresh();
    leaveGuard = () => !tools.dirty || confirm("有未保存的指法，确定离开？");
    const score = extractScore(osmd, displayName(name));
    applyExpression(score, xml);
    const inst = await getInstrument(settings.sound, (s) => (status.textContent = s));
    if (stale()) return bail();
    player = new Player(osmd, score, audioCtx(), inst);
    player.volume = settings.volume;
    player.expressive = settings.expressive;
    player.countIn = settings.countIn;
    player.clickLevel = settings.clickVolume;
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
          autoResize: false, // we redraw ourselves (see relayout): the library would also redraw windows that are folded away, with width 0
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
      h("button", { class: "back", title: "返回", onclick: () => { if (leaveGuard()) location.hash = "#/"; } }, ic("chevron-left", 22), h("span", { class: "lbl" }, "返回")),
      h("h1", {}, pair.name),
      modeToggle(),
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
        autoResize: false, // we redraw ourselves (see relayout): the library would also redraw windows that are folded away, with width 0
        backend: "svg",
        drawTitle: g === 0,
        followCursor: false,
        cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: false }],
      });
      await o.load(xmls[g]);
      undo.push(() => o.clear());
      if (stale()) return bail();
      o.zoom = settings.zoom;
      o.EngravingRules.RenderFingerings = false; // our own overlay draws the numbers
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
    player.countIn = settings.countIn;
    player.clickLevel = settings.clickVolume;
    pushRecent(pairKey(pair));
    // two independent scores: each screen has its own fingering tools and saves to its own file
    const tools = new FingerGroup(views.map((v, g) => new FingerTools(v.osmd, v.holder, xmls[g])));
    undo.push(() => tools.dispose());
    tools.visible = settings.fingers;
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
  // small screens: the bar can be hidden completely; this little handle (play / pause + "show the bar") stays
  const miniPlay = h("button", { class: "icon big miniplay", title: "播放 / 暂停 (空格)", onclick: () => playBtn.click() }, ic("play", 22));
  const expandBtn = h("button", { class: "icon big expandbtn", title: "显示工具栏", onclick: () => setBar("min") }, ic("chevron-up", 22));
  const handle = h("div", { class: "barhandle", hidden: true }, miniPlay, expandBtn);
  document.body.append(handle);
  const speed = h("input", { type: "range", min: "20", max: "150", step: "5", value: "100", class: "speed" });
  const speedLabel = h("span", { class: "speedlabel" });
  const pos = h("span", { class: "pos" });

  /** a hand button: the full name normally, a short one (R+L / R / L) on small screens (CSS), the full name always as its tooltip */
  const handBtn = (full: string, short: string, on: () => void) => h("button", { class: "seg hand", title: full, onclick: on }, h("span", { class: "lbl" }, full), h("span", { class: "sh" }, short));
  const handBtns: Record<string, HTMLButtonElement> = {
    both: handBtn("双手", "双", () => setHands(true, true)),
    right: handBtn("右手", "右", () => setHands(true, false)),
    left: handBtn("左手", "左", () => setHands(false, true)),
  };
  const hasHands = score.staffCounts.some((c) => c >= 2);
  function setHands(r: boolean, l: boolean) {
    player.handOn = { right: r, left: l };
    sync();
  }

  /** Controls of one player (part): name = sound on/off, right hand, left hand. Used under each screen in split view. */
  interface PartUi { g: number; group: HTMLElement; snd: HTMLElement; b: HTMLElement; r: HTMLElement; l: HTMLElement }
  const partUi: PartUi[] = [];
  let gameFirst = -1; // (game view) the part that was chosen first in the cycle of the part button
  function partControls(g: number): HTMLElement {
    const multi = score.parts.length > 1;
    const label = multi ? `${partLetter(g)} · ${score.parts[g]}` : score.parts[g];
    const snd = h("button", { class: "seg pname", title: "开/关这个声部的声音：你自己弹的那个声部，把它关掉", onclick: () => {
      if (gameOn() && split && player.partOn.length === 2) {
        // game view, four hands: ONE button walks through the views: both parts -> this part alone (it is the one you play, the other is only the accompaniment
        // and hidden) -> the other part alone -> both again
        const on = player.partOn;
        if (on[0] && on[1]) { gameFirst = g; player.partOn = on.map((_, i) => i !== g); }
        else { const alone = on[0] ? 1 : 0; player.partOn = alone === gameFirst ? on.map((_, i) => i === alone) : [true, true]; }
        return sync();
      }
      const onlyOne = player.partOn[g] && player.partOn.filter(Boolean).length === 1;
      if (onlyOne && player.partOn.length > 1) player.partOn = player.partOn.map((_, i) => i !== g); // the other part is off and this one is the only one on: SWAP (one tap instead of two)
      else player.partOn[g] = !player.partOn[g];
      if (!player.partOn.some(Boolean)) player.partOn[g] = true; // keep at least one part audible
      sync();
    } }, ...(multi ? [h("span", { class: "pl" }, partLetter(g)), h("span", { class: "pn mq few" }, h("span", { class: "mqi" }, ` · ${score.parts[g]}`))] : [label]));
    // same as for a single score: both hands / right only / left only (one choice, not two switches)
    const hand = (r: boolean, l: boolean, full: string, short: string) => h("button", { class: "seg hand", title: full, onclick: () => {
      player.partHands[g] = { right: r, left: l };
      sync();
    } }, h("span", { class: "lbl" }, full), h("span", { class: "sh" }, short));
    const b = hand(true, true, "双手", "双");
    const r = hand(true, false, "右手", "右");
    const l = hand(false, true, "左手", "左");
    const two = score.staffCounts[g] >= 2;
    const group = h("div", { class: "group pgroup" }, snd, ...(two ? [b, r, l] : []));
    partUi.push({ g, group, snd, b, r, l });
    return group;
  }

  // practice panel
  const cbExpr = h("input", { type: "checkbox", checked: settings.expressive });
  cbExpr.addEventListener("change", () => {
    settings.expressive = cbExpr.checked;
    saveSettings(settings);
    player.expressive = cbExpr.checked;
  });
  const cbCount = h("input", { type: "checkbox", checked: settings.countIn });
  const cbMetro = h("input", { type: "checkbox" });
  const cbLoop = h("input", { type: "checkbox" });
  const from = h("input", { type: "number", min: "1", max: String(score.measureCount), value: "1" });
  const to = h("input", { type: "number", min: "1", max: String(score.measureCount), value: String(Math.min(4, score.measureCount)) });
  const cbRamp = h("input", { type: "checkbox" });
  const rampStep = h("input", { type: "number", min: "1", max: "50", value: "5" });
  const rampMax = h("input", { type: "number", min: "20", max: "200", value: "100" });
  const applyPractice = () => {
    player.countIn = cbCount.checked;
    settings.countIn = cbCount.checked;
    saveSettings(settings);
    player.metronome = cbMetro.checked;
    const f = Math.max(1, Math.min(score.measureCount, Number(from.value) || 1));
    const t = Math.max(f, Math.min(score.measureCount, Number(to.value) || f));
    player.loop = cbLoop.checked ? { from: f - 1, to: t - 1 } : null;
    player.ramp = cbRamp.checked ? { step: (Number(rampStep.value) || 5) / 100, max: (Number(rampMax.value) || 100) / 100 } : null;
    sync();
  };
  for (const el of [cbCount, cbMetro, cbLoop, from, to, cbRamp, rampStep, rampMax]) el.addEventListener("change", applyPractice);
  const clickSlider = h("input", { type: "range", min: "0", max: "100", value: String(Math.round(settings.clickVolume * 100)), class: "clickvol", title: "节拍器音量", "aria-label": "节拍器音量" }) as HTMLInputElement;
  clickSlider.addEventListener("input", () => {
    settings.clickVolume = Number(clickSlider.value) / 100;
    player.clickLevel = settings.clickVolume;
    saveSettings(settings);
  });
  const useCurrent = h("button", { onclick: () => { from.value = String(player.measureIndex + 1); if (Number(to.value) < Number(from.value)) to.value = from.value; applyPractice(); } }, "起点＝当前小节");
  const panel = h(
    "div",
    { class: "panel", hidden: true },
    h("label", { class: "inline" }, cbExpr, "按乐谱表情演奏（力度、断奏、踏板）"),
    h("label", { class: "inline" }, cbCount, "开始前倒数一小节"),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbMetro, "节拍器"), clickSlider),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbLoop, "循环小节"), from, "到", to, useCurrent),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbRamp, "每遍加速"), rampStep, "% ，上限", rampMax, "%"),
  );
  // same look as the fingering button next to it: a neutral pill, blue while its panel is open
  const practiceBtn = h("button", { class: "toggle", title: "练习", onclick: () => (panel.hidden = !panel.hidden) }, ic("sliders", 20), h("span", { class: "lbl" }, "练习"));
  const practiceGroup = h("div", { class: "group" }, practiceBtn);
  new MutationObserver(() => practiceBtn.classList.toggle("on", !panel.hidden)).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  const zoomIn = h("button", { class: "icon", onclick: () => zoom(0.1), title: "放大" }, ic("plus", 20));
  const zoomOut = h("button", { class: "icon", onclick: () => zoom(-0.1), title: "缩小" }, ic("minus", 20));
  // the width each view was last drawn at (-1 = needs a new drawing as soon as it is visible again)
  const drawnWidth = new Map<View, number>();
  views.forEach((v) => drawnWidth.set(v, v.holder.clientWidth));
  function rerender() {
    const step = player.currentStep;
    for (const v of views) {
      if (v.holder.clientWidth === 0) { drawnWidth.set(v, -1); continue; } // folded away / hidden: draw it when it is shown again
      v.osmd.EngravingRules.RenderFingerings = false; // every number is drawn by our own overlay so it can follow the hand selection
      v.osmd.zoom = settings.zoom;
      v.osmd.render();
      drawnWidth.set(v, v.holder.clientWidth);

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
  /** a window changed its size (rotation, address bar, a part shown again): draw again every visible view whose width is not the one it was drawn at */
  let relayoutTimer = 0;
  const relayout = () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => {
      const stale = views.some((v) => v.holder.clientWidth > 0 && Math.abs(v.holder.clientWidth - (drawnWidth.get(v) ?? 0)) > 2);
      if (stale) rerender();
    }, 250);
  };
  window.addEventListener("resize", relayout);
  function zoom(d: number) {
    settings.zoom = Math.min(2.5, Math.max(0.4, +(settings.zoom + d).toFixed(2)));
    saveSettings(settings);
    rerender();
  }

  // ---- fingering ----
  const cbAuto = h("input", { type: "checkbox", checked: tools.showAuto });
  cbAuto.addEventListener("change", () => tools.setAuto(cbAuto.checked));
  const editBtn = h("button", { class: "primary", onclick: () => enterEdit() }, ic("pencil", 20), "编辑指法");
  const fpanel = h(
    "div",
    { class: "panel", hidden: true },
    h("label", { class: "inline" }, cbAuto, h("span", {}, "自动建议指法（", h("b", { class: "blue" }, "蓝色"), "，仅作参考；已有指法的音符不会被改动）")),
    h("p", { class: "muted small" }, "优先级：乐谱里的指法 > 自动建议。自己标注的指法保存后写进乐谱文件，之后读取以它为准。"),
    editBtn,
  );
  const fingerToggle = h("button", { class: "toggle", title: "显示 / 隐藏指法", disabled: !tools.supported, onclick: () => setFingers(!tools.visible) }, ic("hand", 20), h("span", { class: "lbl" }, "指法"));
  const fingerOpts = h("button", { class: "narrow", title: "指法选项", disabled: !tools.supported, onclick: () => { fpanel.hidden = !fpanel.hidden; panel.hidden = true; } }, ic("chevron-down", 18));
  const fingerBtn = h("div", { class: "group pair" }, fingerToggle, fingerOpts);
  function setFingers(on: boolean) {
    tools.visible = on;
    settings.fingers = on;
    saveSettings(settings);
    fingerToggle.classList.toggle("on", on);
    tools.refresh(); // the numbers are our own overlay: no need to redraw the score (which would also restart playback)
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
    else if (gameOn()) void startGame();
    else {
      const ci = player.countInBeats();
      void player.play();
      if (ci) showCountIn(ci.n, ci.beatSec);
    }
  });
  // game view: READY ... GO! (instead of the metronome count-in): the notes fall in during the lead, the music starts exactly at GO
  async function startGame() {
    player.practiceMute = scoringOn();
    if (!gs || roundOver || player.position() <= 0.05) beginRound();
    const GO_AT = 1.9; // seconds after the tap: READY ... GO (the screen stands still), then the notes fall in for GAME_PRE seconds, then the music
    await player.play(false, { lead: GO_AT + GAME_PRE });
    if (!player.playing) return;
    clearCountIn();
    const ctx = audioCtx(), base = player.startsAt - GO_AT - GAME_PRE, ready = base + 0.35, go = base + GO_AT;
    const vol = settings.volume;
    readySound(ctx, ready, vol); goSound(ctx, go, vol);
    countEl = h("div", { class: "gostart" }, h("span", { class: "word" }));
    document.body.append(countEl);
    const word = countEl.firstElementChild as HTMLElement;
    const at = (t: number, fn: () => void) => countTimers.push(window.setTimeout(() => { if (player.playing && countEl) fn(); }, Math.max(0, (t - ctx.currentTime) * 1000)));
    const show = (txt: string, cls: string) => { word.textContent = txt; word.className = "word " + cls; void word.offsetWidth; word.classList.add("in"); };
    at(ready, () => show("READY", "ready"));
    at(go - 0.04, () => show("GO!", "go"));
    countTimers.push(window.setTimeout(() => { countEl?.remove(); countEl = null; }, Math.max(0, (go - ctx.currentTime) * 1000) + 1100)); // (the words go; the pre-roll runs on)
  }
  // the count-in is also shown as big numbers (1 2 3 4), so you know when the music starts
  let countTimers: number[] = [];
  let countEl: HTMLElement | null = null;
  function clearCountIn() {
    countTimers.forEach((t) => clearTimeout(t));
    countTimers = [];
    countEl?.remove();
    countEl = null;
  }
  function showCountIn(n: number, beatSec: number) {
    clearCountIn();
    countEl = h("div", { class: "countin" });
    document.body.append(countEl);
    for (let i = 0; i < n; i++) {
      countTimers.push(window.setTimeout(() => {
        if (!countEl) return;
        countEl.textContent = String(i + 1);
        countEl.classList.remove("pop");
        void countEl.offsetWidth; // restart the animation
        countEl.classList.add("pop");
      }, 80 + i * beatSec * 1000));
    }
    countTimers.push(window.setTimeout(clearCountIn, 80 + n * beatSec * 1000));
  }
  stopBtn.addEventListener("click", () => player.stop());
  speed.addEventListener("input", () => player.setSpeed(Number(speed.value) / 100));

  // ---- keeping the current line in view (every screen follows its own cursor) ----
  function followOne(v: View, jump: boolean) {
    if (v.box.classList.contains("collapsed")) return; // folded away
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
    if (settings.scrollMode === "page") {
      // the WHOLE current line (with what is drawn above / below the staves) has to be inside the view; if it is not, bring it
      // to the top (a line taller than the view is aligned at its top; the zoom buttons are for that case).
      const hr = v.holder.getBoundingClientRect();
      const cy = cr.top - hr.top + cr.height / 2;
      const ex = systemExtents(v);
      let line = ex.length ? ex.reduce((best, e) => (Math.abs(cy - (e.top + e.bottom) / 2) < Math.abs(cy - (best.top + best.bottom) / 2) ? e : best)) : null;
      const m = 6;
      if (line) {
        const vTop = v.wrap.scrollTop;
        if (line.top - m < vTop || line.bottom + m > vTop + v.wrap.clientHeight) v.wrap.scrollTop = Math.max(0, line.top - m);
      } else if (top < 20 || cr.bottom - wr.top > wr.height - 20) v.wrap.scrollTop += top - 20;
    } else {
      const delta = top + cr.height / 2 - wr.height / 2;
      if (Math.abs(delta) > 40) v.wrap.scrollTo({ top: v.wrap.scrollTop + delta, behavior: "smooth" });
    }
  }

  // ---- preview of the next line: floats right under the last visible line, gone once the page has turned ----
  function updatePeek(v: View) {
    const off = () => { v.peek.style.display = "none"; };
    // two screens side by side have no room for it; a single visible screen (the other part folded away, or full screen) has
    const alone = !split || views.filter((x) => !x.box.classList.contains("collapsed") && !(app.classList.contains("focusing") && !x.box.classList.contains("focused"))).length === 1;
    if (!settings.peekNext || settings.scrollMode !== "page" || !alone) return off();
    const svg = v.holder.querySelector("svg") as SVGSVGElement | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const systems: any[] | undefined = (v.osmd.GraphicSheet as any)?.MusicPages?.[0]?.MusicSystems;
    const curEl = v.osmd.cursor.cursorElement as HTMLElement | undefined;
    if (!svg || !systems?.length || !curEl) return off();
    const hr = v.holder.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const oy = sr.top - hr.top;
    const boxes = systemExtents(v).map((e) => ({ top: e.top, h: e.bottom - e.top }));
    const cr = curEl.getBoundingClientRect();
    const cy = cr.top - hr.top + cr.height / 2;
    const i = boxes.findIndex((b) => cy >= b.top - 12 && cy <= b.top + b.h + 12);
    if (i < 0 || i + 1 >= boxes.length) return off();
    const next = boxes[i + 1];
    const viewH = v.wrap.clientHeight;
    const vTop = v.wrap.scrollTop;
    // is the next line completely on screen already? then there is nothing to preview. (A grand staff line has two staves: when only
    // the right hand's staff shows and the left hand's is cut off, the preview is still needed.)
    const shown = Math.max(0, Math.min(next.top + next.h, vTop + viewH) - Math.max(next.top, vTop));
    if (shown >= next.h - 6) return off();
    // right under the current line (so the eye just continues downwards); if that runs past the bottom of the
    // score area it floats over the control bar, which is not needed while playing
    const y = Math.max(0, boxes[i].top + boxes[i].h - vTop + 4);
    const wr = v.wrap.getBoundingClientRect();
    const gp = document.querySelector(".gamepanel:not([hidden])"); // the game panel is not to be covered
    const room = (gp ? gp.getBoundingClientRect().top : window.innerHeight) - 6 - (wr.top + y); // only ever used alone: it may float over the control bar
    const S = 0.85; // drawn a little smaller: it only has to be readable, and it covers less
    // what is drawn above the staves (bar numbers, high notes, fingering) lies outside the system box: start higher
    const pad = 6; // the boxes are exact now (they include what is drawn above / below the staves)
    const h2 = Math.min((next.h + pad + 8) * S, room);
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
  /** four-hand view: the part you muted is the one YOU play; the other (still sounding) part is somebody else's, so its score is folded away */
  let applyCollapse: () => void = () => {};
  function sync() {
    syncFingerHands();
    syncViews();
    followView();
    playBtn.replaceChildren(ic(player.playing ? "pause" : "play", 30));
    miniPlay.replaceChildren(ic(player.playing ? "pause" : "play", 22));
    speed.style.setProperty("--p", `${((Number(speed.value) - Number(speed.min)) / (Number(speed.max) - Number(speed.min))) * 100}%`);
    const bpm = Math.round(score.baseBpm * player.speed);
    speed.value = String(Math.round(player.speed * 100));
    speedLabel.replaceChildren(h("span", {}, `${Math.round(player.speed * 100)}%`), h("span", { class: "bpm" }, ` · ♩=${bpm}`));
    pos.textContent = `第 ${player.measureIndex + 1} / ${score.measureCount} 小节`;
    const mode = player.handOn.right && player.handOn.left ? "both" : player.handOn.right ? "right" : "left";
    for (const [k, b] of Object.entries(handBtns)) b.classList.toggle("on", k === mode);
    partUi.forEach((u) => {
      u.snd.classList.toggle("on", player.partOn[u.g]);
      const ph = player.partHands[u.g];
      u.b.classList.toggle("on", ph.right && ph.left);
      u.r.classList.toggle("on", ph.right && !ph.left);
      u.l.classList.toggle("on", ph.left && !ph.right);
      u.group.classList.toggle("muted", !player.partOn[u.g]);
    });
    if (!player.playing) clearCountIn();
    applyCollapse();
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
    window.removeEventListener("resize", onResizeBar);
    document.removeEventListener("click", closeMenus);
    handle.remove();
    window.removeEventListener("resize", relayout);
    clearTimeout(relayoutTimer);
    prevDispose?.();
  };

  // small screens: the bar can shrink to the essentials (play / pause and speed) or hide completely (the little handle brings it back)
  const moreBtn = h("button", { class: "morebtn", title: "展开 / 收起更多控制" });
  const hideBtn = h("button", { class: "icon hidebtn", title: "隐藏工具栏", onclick: () => setBar("hidden") }, ic("chevron-down", 20));
  // on a wide screen everything fits in one row, so there is nothing to fold away
  const narrow = () => window.innerWidth < 820 || window.innerHeight <= 480; // the zoom buttons then live on the strip above the score
  const gameOn = () => settings.gameMode && settings.gameView;
  const canFold = () => gameOn() || window.innerWidth < 1100 || window.innerHeight <= 480; // iPad portrait too: the bar can be made smaller or hidden
  const barMode = (): "full" | "min" | "hidden" => (!canFold() ? "full" : (gameOn() ? settings.gameBar ?? "min" : settings.barMode ?? (split && narrow() ? "min" : "full")));
  const setBar = (m: "full" | "min" | "hidden") => {
    if (gameOn()) settings.gameBar = m; else settings.barMode = m;
    saveSettings(settings);
    panel.hidden = true;
    fpanel.hidden = true;
    refreshMore();
  };
  const refreshMore = () => {
    const m = barMode();
    bar.classList.toggle("min", m === "min");
    bar.classList.toggle("splitwide", split && !canFold());
    bar.hidden = m === "hidden";
    handle.hidden = m !== "hidden";
    if (strip) {
      (narrow() ? strip : wrapRow).append(zoomOut, zoomIn);
      strip.hidden = !(handContent.length || narrow());
    }
    moreBtn.hidden = !canFold() || m === "hidden";
    hideBtn.hidden = !canFold() || m !== "min";
    moreBtn.replaceChildren(ic(m === "min" ? "chevron-up" : "chevron-down", 18), h("span", { class: "lbl" }, m === "min" ? "更多" : "收起"));
    setTimeout(() => followView(false), 60);
  };
  const onResizeBar = () => refreshMore();
  window.addEventListener("resize", onResizeBar);
  // the floating part menu (phone held sideways) closes when you tap anywhere else
  const closeMenus = (e: Event) => {
    if (!(e.target as HTMLElement | null)?.closest(".panehead, .panemenu")) document.querySelectorAll(".panehead.open").forEach((x) => x.classList.remove("open"));
  };
  document.addEventListener("click", closeMenus);
  moreBtn.addEventListener("click", () => setBar(barMode() === "min" ? "full" : "min"));
  // fingering, practice and zoom: on a wide screen at the right end of the bottom bar; on a small screen the zoom buttons go to the strip on top
  const wrapRow = h("div", { class: "row wrap" }, h("div", { class: "grow" }), fingerBtn, practiceGroup, zoomOut, zoomIn);
  const bar = h(
    "footer",
    { class: "controls" },
    panel,
    fpanel,
    editbar,
    h("div", { class: "row mainrow" }, stopBtn, playBtn, h("div", { class: "speedbox" }, speed, speedLabel), pos, moreBtn, hideBtn),
    wrapRow,
  );
  // Which hand(s) to play: a slim strip on top of the score (like the bar of every part in four hands), so that the bottom bar is ONE row.
  const handContent: HTMLElement[] = split ? [] : [
    ...(score.parts.length === 1 && hasHands ? [h("div", { class: "group" }, h("span", { class: "gl" }, "手"), ...Object.values(handBtns))] : []),
    ...(score.parts.length > 1 ? score.parts.map((_, g) => partControls(g)) : []),
  ];
  const strip = split ? null : h("div", { class: "handstrip" }, ...handContent, h("div", { class: "grow" }));
  strip?.addEventListener("click", () => { panel.hidden = true; fpanel.hidden = true; });
  if (split) {
    // full screen for one part: the other part keeps sounding, it just is not shown
    let focus: number | null = null;
    const setFocus = (g: number | null) => {
      focus = g;
      app.classList.toggle("focusing", g !== null);
      document.querySelector(".splitwrap")?.classList.toggle("focusing", g !== null);
      document.querySelectorAll(".pane").forEach((pane, i) => pane.classList.toggle("focused", g === i));
      document.querySelectorAll(".focusbtn").forEach((b, i) => b.replaceChildren(ic(g === i ? "restore" : "fullscreen", 18), h("span", { class: "lbl" }, g === i ? "还原" : "全屏")));
      document.querySelectorAll(".panefs").forEach((b, i) => b.replaceChildren(ic(g === i ? "restore" : "fullscreen", 18)));
      requestAnimationFrame(() => { relayout(); followView(); });
    };
    const collBtns: HTMLElement[] = [];
    let lastTarget: number | null = null;
    let userOpen = false; // opened by hand although the other part is muted
    document.querySelectorAll(".panehead").forEach((head, g) => {
      head.append(partControls(g));
      head.append(h("div", { class: "grow" }));
      const fold = h("button", { class: "collbtn", hidden: true, onclick: () => { userOpen = !userOpen; applyCollapse(); } });
      collBtns[g] = fold;
      head.append(fold);
      head.append(h("button", { class: "focusbtn", title: "只看这个声部（全屏）。另一个声部仍然会发声", onclick: () => setFocus(focus === g ? null : g) }, ic("fullscreen", 18), h("span", { class: "lbl" }, "全屏")));
      // a phone held sideways has no room for the part bars: they are hidden and this little button brings them up as a floating menu
      const menu = h("button", { class: "panemenu icon", title: "这个声部的控制", onclick: (e: Event) => { e.stopPropagation(); document.querySelectorAll(".panehead.open").forEach((x) => x !== head && x.classList.remove("open")); head.classList.toggle("open"); } }, ic("hand", 18));
      const fsBtn = h("button", { class: "panefs icon", title: "只看这个声部（全屏）。另一个声部仍然会发声", onclick: () => setFocus(focus === g ? null : g) }, ic("fullscreen", 18)); // (game view, four hands: the full-screen button of the part, on its own)
      head.parentElement?.append(menu, fsBtn);
    });
    applyCollapse = () => {
      const on = player.partOn;
      const target = views.length === 2 && on.filter(Boolean).length === 1 ? on.findIndex(Boolean) : null;
      if (target !== lastTarget) {
        lastTarget = target;
        userOpen = false;
        requestAnimationFrame(() => followView());
      }
      views.forEach((v, g) => {
        const folded = target === g && !userOpen;
        if (v.box.classList.contains("collapsed") !== folded) {
          v.box.classList.toggle("collapsed", folded);
          requestAnimationFrame(() => { relayout(); followView(); });
        }
        const b = collBtns[g];
        if (!b) return;
        b.hidden = target !== g;
        b.replaceChildren(ic(folded ? "chevron-down" : "chevron-up", 18), h("span", { class: "lbl" }, folded ? "展开" : "收起"));
        b.title = folded ? "展开这个声部的谱子" : "收起这个声部的谱子";
        b.title = folded ? "展开这个声部的谱子" : "收起这个声部的谱子";
      });
    };
    applyCollapse();
    (window as unknown as { __setFocus?: (g: number | null) => void }).__setFocus = setFocus;
  }
  if (strip) app.querySelector(".top")?.after(strip);
  app.append(bar);
  // the game panel (falling notes + keyboard) sits between the score and the bottom bar while the Game switch is on
  const gv = createGameView(player, score, { tilt: settings.gameTilt, onTilt: (on) => { settings.gameTilt = on; saveSettings(settings); }, title: (k) => (k === "tilt" ? "立体视角" : "平面视角"), height: () => settings.gameH, onHeight: (px) => { settings.gameH = px; saveSettings(settings); },
    scoring: settings.gameScoring, onMode: (sc) => { settings.gameScoring = sc; saveSettings(settings); syncGame(); }, judgeText: () => settings.gameJudgeText });
  // ---- score mode: you play on a MIDI keyboard, the app judges the timing ----
  let gs: GameScore | null = null, roundOver = false, setupShown = false;
  const scoringOn = () => gameOn() && settings.gameScoring;
  const keyColour = (k: string) => (k === "wrong" || k === "miss" ? "#ff5a5a" : k === "perfect" ? "#ffd60a" : "#ffffff");
  const hud = createHud({
    level: settings.gameLevel,
    onLevel: (l) => { settings.gameLevel = l; saveSettings(settings); },
    onConnect: () => { void midi.start(); },
    onPair: midi.isNative ? () => void midi.pairBluetooth() : null,
    onRetry: () => { player.stop(); void startGame(); },
    latency: settings.gameLatency, onLatency: (ms) => { settings.gameLatency = ms; saveSettings(settings); },
    micSens: settings.micSensitivity, onMicSens: (n) => { settings.micSensitivity = n; saveSettings(settings); mic.sensitivity = n; },
    onMic: async () => {
      if (mic.running) { mic.stop(); hud.micState("off"); return; }
      mic.sensitivity = settings.micSensitivity;
      const r = await mic.start(() => { const pos = player.position(), w = (WINDOWS[settings.gameLevel][2] - 0.16) * player.speed; return score.events.filter((e) => player.isShown(e) && Math.abs(e.sec - pos) < w).map((e) => e.midi); }); // only the notes that are due are listened for
      hud.micState(r === "ok" ? "on" : r);
    },
  });
  gv.el.append(hud.scoreBox, hud.comboBox); // the score next to the 3D button, the combo under the demo / score switch
  gv.el.querySelector(".gtopleft")!.append(hud.chip); // (numbers + the piano button live in the game panel; the cards float above everything)
  app.append(hud.setup, hud.result);
  hud.midi(midi.status());
  const offState = midi.onState((st) => hud.midi(st));
  (window as unknown as { __gs?: () => unknown }).__gs = () => gs?.stats; // (for the tests)
  const judged = (j: { kind: string; combo: number } & Parameters<typeof gv.judge>[0]) => {
    gv.judge(j); hud.judged(j);
    if (j.kind !== "miss" && j.kind !== "wrong" && isComboMilestone(j.combo)) gv.milestone(j.combo);
  };
  const handleKey = (n: MidiNote) => {
    if (!scoringOn()) return;
    if (n.type === "off") return void gv.release(n.note);
    if (!gs || !player.playing || roundOver) return void gv.press(n.note, "#ffffff"); // free play: the key just lights
    const t = player.position() - ((performance.now() - n.time) / 1000) * player.speed - (settings.gameLatency / 1000) * player.speed; // the moment the key was struck (minus the delay of the piano's signal, if the player set one)
    const j = gs.strike(n.note, t);
    judged(j); gv.press(n.note, keyColour(j.kind)); hud.update(gs.stats, gs.accuracy());
  };
  const offNote = midi.onNote(handleKey);
  const micHandler = (n: MidiNote) => { handleKey(n); window.setTimeout(() => gv.release(n.note), 260); }; // (a microphone does not tell when the key is let go)
  mic.setHandler(micHandler);
  const offMic = () => mic.setHandler(null);
  // keys that were let go are never reported twice: clear the lit keys when they have been struck for a while
  const beginRound = () => {
    simAt = 0; lastPos = player.position();
    gs = new GameScore(score.events, settings.gameLevel, player.speed, (e) => player.isShown(e)); // what counts is asked at every moment: a part switched off / on later changes it
    roundOver = false;
    hud.reset();
    hud.update(gs.stats, 1);
  };
  // Demo mode scores too, with an imaginary player: a perfect one (with the setting "mistakes in the demo" on: also late, a miss, a wrong key, to watch those effects)
  let simAt = 0, simSeed = 7, lastPos = 0;
  const rnd = () => { simSeed = (simSeed * 1664525 + 1013904223) % 4294967296; return simSeed / 4294967296; };
  const simulate = (pos: number) => {
    const shown = score.events.filter((e) => player.isShown(e)).sort((a, b) => a.sec - b.sec);
    if (simAt < 0) { simAt = shown.findIndex((e) => e.sec >= pos - 0.05); if (simAt < 0) simAt = shown.length; }
    while (simAt < shown.length && shown[simAt].sec <= pos) {
      const e = shown[simAt++];
      const r = rnd(), d = (rnd() - 0.5) * 2; // d: -1 .. 1
      if (!settings.gameDemoMistakes) judged(gs!.strike(e.midi, e.sec)); // the demo plays perfectly
      else if (r < 0.74) judged(gs!.strike(e.midi, e.sec + d * 0.04 * player.speed));
      else if (r < 0.9) judged(gs!.strike(e.midi, e.sec + d * 0.14 * player.speed));
      else if (r < 0.95) judged(gs!.strike(e.midi, e.sec + (d < 0 ? -0.26 : 0.26) * player.speed));
      else if (r < 0.975) judged(gs!.strike(e.midi + 1, e.sec)); // a wrong key; the note itself is then missed
      /* else: not played */
    }
  };
  const roundTimer = window.setInterval(() => {
    if (mic.running) { hud.micLevel(mic.level); const hd = mic.heard; hud.micHeard(hd && performance.now() - hd.t < 1800 ? noteName(hd.note) : null); }
    if (!gameOn() || !gs || roundOver) return;
    const pos = player.position();
    const ended = !player.playing && pos >= score.duration - 0.05;
    if (pos < lastPos - 0.3 || pos - lastPos > 1) { gs.skipTo(pos); simAt = -1; } // a jump (seek): what lies before is not judged
    lastPos = pos;
    if (!scoringOn() && player.playing) simulate(pos);
    if (player.playing || ended) {
      for (const j of gs.advance(ended ? Infinity : pos)) judged(j);
      hud.update(gs.stats, gs.accuracy());
    }
    if (gs.finished && (player.playing || ended)) { roundOver = true; hud.showResult(gs.stats, gs.stars(), gs.accuracy(true)); }
  }, 60);
  const syncGame = () => {
    if (!gv.el.isConnected && !app.contains(bar)) { window.removeEventListener("pianist-game", syncGame); document.documentElement.classList.remove("gamecompact"); clearInterval(roundTimer); offNote(); offMic(); mic.stop(); offState(); hud.destroy(); gv.destroy(); return; }
    gv.el.hidden = !(settings.gameMode && settings.gameView);
    gv.setTilt(settings.gameTilt);
    document.documentElement.classList.toggle("gamecompact", gameOn() && split); // four hands: the part bars hide behind small floating buttons
    gv.setScoring(settings.gameScoring);
    gv.refit();
    player.practiceMute = scoringOn();
    hud.setHidden(!gameOn());
    hud.setChip(scoringOn());
    if (scoringOn() && MidiInput.available()) void midi.start(); // (the browser asks for permission now)
    if (scoringOn() && !setupShown && !mic.running) { setupShown = true; setTimeout(() => { if (scoringOn() && !midi.status().devices.length) hud.openSetup(true); }, 900); } // no piano yet: show how to connect it, once
    refreshMore(); // the game view is a small-screen layout: small bar, the score gets the room
  };
  bar.before(gv.el);
  window.addEventListener("pianist-game", syncGame);
  syncGame();
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
  let mode: "single" | "scroll" = settings.pdfView;
  let cur = 1;
  let total = 0;
  const sheets: HTMLElement[] = [];
  const pages = h("div", { class: "pdfpages" });
  const wrap = h("div", { class: "pdfwrap" }, pages);
  const status = h("span", { class: "status" }, "加载 PDF…");
  let book: NoteBook | null = null; // the handwritten annotations (null: not loaded / not available)
  const pageText = () => (total ? `共 ${total} 页` : "");

  // ---- page view: one page at a time (fits the screen) or everything in one scroll
  const layout = () => {
    wrap.classList.toggle("single", mode === "single");
    sheets.forEach((sh, i) => {
      sh.hidden = mode === "single" && i + 1 !== cur;
      if (mode === "single") {
        const ratio = Number(sh.dataset.ratio) || 0.7;
        const w = Math.min(wrap.clientWidth - 24, (wrap.clientHeight - 24) * ratio) * zoom;
        sh.style.width = `${Math.max(120, w)}px`;
      } else sh.style.width = "";
    });
    showPage();
  };
  const pageInd = h("span", { class: "pageind" }, "");
  const prevBtn = h("button", { class: "icon pg", title: "上一页", onclick: () => goto(cur - 1) }, ic("chevron-left", 20));
  const nextBtn = h("button", { class: "icon pg", title: "下一页", onclick: () => goto(cur + 1) }, ic("chevron-right", 20));
  const showPage = () => {
    pageInd.textContent = total ? `${cur} / ${total}` : "";
    fillSecs();
    (prevBtn as HTMLButtonElement).disabled = cur <= 1;
    (nextBtn as HTMLButtonElement).disabled = cur >= total;
  };
  /** go to a page; `user`: a person asked for it (restarts the automatic countdown) */
  function goto(n: number, user = true): boolean {
    n = Math.max(1, Math.min(total, n));
    if (n === cur) return false;
    cur = n;
    if (mode === "single") {
      layout();
      wrap.scrollTo({ top: 0, left: 0 });
    } else {
      const sh = sheets[n - 1];
      if (sh) wrap.scrollTo({ top: sh.offsetTop - 12, behavior: "smooth" });
      showPage();
    }
    if (user) turn.reset();
    return true;
  }
  wrap.addEventListener("scroll", () => {
    if (mode !== "scroll" || !sheets.length) return;
    let c = 1;
    sheets.forEach((sh, i) => { if (sh.offsetTop - 12 <= wrap.scrollTop + wrap.clientHeight * 0.35) c = i + 1; });
    if (c !== cur) { cur = c; showPage(); }
  }, { passive: true });
  // Touch gestures: a quick swipe sideways turns the page (the way you turn it while playing), a tap on the left / right edge too,
  // a tap in the middle shows / hides the toolbar in full screen. A swipe and a tap are told apart by how far the finger moved.
  const fitsScreen = () => mode === "single" && zoom <= 1.01;
  let down: { x: number; y: number; t: number } | null = null;
  wrap.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.pointerType === "pen" || (e.pointerType === "mouse" && e.button !== 0)) return down = null;
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  wrap.addEventListener("pointercancel", () => (down = null));
  wrap.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerType === "pen") return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = Date.now() - d.t;
    const drawing = book?.enabled && (e.pointerType === "mouse" || book.fingerDraw); // this pointer was writing, not navigating
    if (drawing) return;
    if (e.pointerType === "touch" && fitsScreen() && Math.abs(dx) >= 48 && Math.abs(dx) > 1.6 * Math.abs(dy) && dt < 900) return void goto(cur + (dx < 0 ? 1 : -1));
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 600) {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (mode === "single" && !book?.enabled && x < 0.22) goto(cur - 1);
      else if (mode === "single" && !book?.enabled && x > 0.78) goto(cur + 1);
      else if (app.classList.contains("pdffull")) showChrome(!app.classList.contains("show"));
    }
  });
  // Two fingers zoom and move the page (also while annotating, even with "finger draws too"): the stroke the first finger had started is dropped.
  // One finger moves a zoomed page. (touch-action is "none" on the page area, so these events reach us instead of the browser's own pinch.)
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; z0: number; cx: number; cy: number } | null = null;
  const pair = () => { const [a, b] = Array.from(fingers.values()); return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };
  // Full screen: a swipe down from the very top edge brings the toolbar back (also while annotating, even when a finger draws): no way to get stuck
  let edgeDrag: { id: number; y0: number } | null = null;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (app.classList.contains("pdffull") && fingers.size === 1 && e.clientY < wrap.getBoundingClientRect().top + 30) {
      edgeDrag = { id: e.pointerId, y0: e.clientY };
      if (book) book.pinching = true; // this touch belongs to the gesture, it does not draw
    }
    if (fingers.size === 2) {
      if (book) book.pinching = true;
      book?.abortStrokes();
      down = null;
      const p = pair();
      pinch = { d0: p.d, z0: zoom, cx: p.cx, cy: p.cy };
    }
  }, true);
  wrap.addEventListener("pointermove", (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    if (edgeDrag && e.pointerId === edgeDrag.id && e.clientY - edgeDrag.y0 > 36) {
      edgeDrag = null;
      showChrome(true);
    }
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    if (pinch && fingers.size === 2) {
      const p = pair();
      e.preventDefault();
      setZoom(pinch.z0 * (p.d / pinch.d0), p.cx, p.cy);
    } else if (fingers.size === 1 && mode === "single" && zoom > 1.01 && !(book?.enabled && book.fingerDraw)) {
      wrap.scrollLeft -= dx;
      wrap.scrollTop -= dy;
    }
  }, true);
  const liftFinger = (e: PointerEvent) => {
    if (edgeDrag && e.pointerId === edgeDrag.id) edgeDrag = null;
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
    if (fingers.size === 0 && book) book.pinching = false;
  };
  wrap.addEventListener("pointerup", liftFinger, true);
  wrap.addEventListener("pointercancel", liftFinger, true);
  // mouse wheel / trackpad: one page per scroll (only when the whole page fits; when zoomed in the wheel scrolls the page as usual)
  let wheelAcc = 0, wheelLock = 0;
  wrap.addEventListener("wheel", (e) => {
    if (e.ctrlKey) { // a trackpad pinch (or ctrl + wheel): zoom around the pointer
      e.preventDefault();
      return setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    }
    if (!fitsScreen()) return;
    e.preventDefault();
    if (Date.now() < wheelLock) return;
    wheelAcc += e.deltaY || e.deltaX;
    if (Math.abs(wheelAcc) < 40) return;
    goto(cur + (wheelAcc > 0 ? 1 : -1));
    wheelAcc = 0;
    wheelLock = Date.now() + 450; // a trackpad keeps sending events after the finger left: one page per gesture
  }, { passive: false });
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest("input, textarea, select, dialog")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goto(cur + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goto(cur - 1); }
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => layout();
  window.addEventListener("resize", onResize);

  // ---- automatic page turn
  const turnBar = h("div", { class: "turnbar", hidden: true }, h("div", { class: "fill" }));
  const turnBtn = h("button", { class: "toggle", title: "每隔几秒自动翻到下一页", onclick: () => (turn.running ? turn.stop("user") : startTurn()) }, ic("timer", 20), h("span", { class: "lbl" }, "自动翻页"));
  // every page has its own time (forScore keeps it per page too); pages without one use the default
  const secsFor = (page: number) => (book ? book.turnSeconds(page, settings.pdfTurnSeconds) : settings.pdfTurnSeconds);
  const secBtn = h("button", { class: "narrow secs", title: "自动翻页设置：每页停留多久", onclick: () => openTurnSettings() }, "") as HTMLButtonElement;
  const fillSecs = () => { secBtn.textContent = `${secsFor(cur)} 秒`; };
  const setSecs = (n: number, all = false) => {
    n = Math.max(1, Math.min(600, Math.round(n) || 1));
    if (all) {
      settings.pdfTurnSeconds = n;
      saveSettings(settings);
      book?.setTurnSeconds(Array.from({ length: total }, (_, i) => i + 1), n);
    } else if (book) book.setTurnSeconds([cur], n);
    else { settings.pdfTurnSeconds = n; saveSettings(settings); }
    fillSecs();
    turn.reset();
  };
  function openTurnSettings() {
    const input = h("input", { type: "number", min: "1", max: "600", step: "1", inputMode: "numeric", class: "secsinput", value: String(secsFor(cur)) }) as HTMLInputElement;
    const set = (n: number) => { input.value = String(Math.max(1, Math.min(600, Math.round(n) || 1))); setSecs(Number(input.value)); };
    input.addEventListener("change", () => set(Number(input.value)));
    input.addEventListener("wheel", (e) => { e.preventDefault(); set(Number(input.value) + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    const dlg = h(
      "dialog",
      { class: "dlg", id: "turn-settings" },
      h("h2", { tabIndex: -1, autofocus: true }, "自动翻页"),
      h("p", { class: "muted small" }, `第 ${cur} 页停留的时间。每一页可以不同：翻到那一页再设置。`),
      h("div", { class: "stepper" }, h("button", { id: "secs-minus", onclick: () => set(Number(input.value) - 1) }, ic("minus", 22)), input, h("span", {}, "秒"), h("button", { id: "secs-plus", onclick: () => set(Number(input.value) + 1) }, ic("plus", 22))),
      h("div", { class: "row" },
        h("button", { id: "secs-all", onclick: () => { setSecs(Number(input.value), true); toast(`已把每一页的停留时间都设为 ${Number(input.value)} 秒`); } }, "应用到全部页"),
        h("div", { class: "grow" }),
        h("button", { class: "primary", onclick: () => dlg.close() }, "完成"),
      ),
    );
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    (document.activeElement as HTMLElement | null)?.blur();
  }
  const turn = new AutoTurn({
    seconds: () => secsFor(cur),
    next: () => goto(cur + 1, false),
    schedule: (s) => {
      const fill = turnBar.firstElementChild as HTMLElement;
      turnBar.hidden = false;
      fill.style.transition = "none";
      fill.style.width = "100%";
      void fill.offsetWidth; // restart the animation
      fill.style.transition = `width ${s}s linear`;
      fill.style.width = "0";
    },
    onStop: (reason) => {
      turnBar.hidden = true;
      turnBtn.classList.remove("on");
      toast(reason === "end" ? "已翻到最后一页，自动翻页已停止" : "自动翻页已停止");
    },
  });
  function startTurn() {
    if (total < 2) return void toast("这份 PDF 只有一页，不需要翻页");
    if (cur >= total) goto(1, false);
    turnBtn.classList.add("on");
    turn.start();
    toast(`开始自动翻页：这一页停留 ${secsFor(cur)} 秒（再点一下“自动翻页”停止）`);
  }

  // ---- handwritten annotations
  const toolsRow = h("div", { class: "pdfbar tools", hidden: true });
  const annotBtn = h("button", { class: "toggle", title: "用 Apple Pencil 或鼠标在乐谱上写画", disabled: true, onclick: () => setAnnotating(!book?.enabled) }, ic("pencil", 20), h("span", { class: "lbl" }, "标注"));
  let saveTimer = 0;
  let saving = false;
  const saveNow = async () => {
    clearTimeout(saveTimer);
    if (!book || !book.dirty) return;
    if (saving) return void (saveTimer = window.setTimeout(() => void saveNow(), 800));
    saving = true;
    status.textContent = "正在保存标注…";
    const text = book.serialize();
    book.dirty = false;
    try {
      await api.writePdfNotes(name, text);
      status.textContent = "标注已保存";
      setTimeout(() => { if (!stale() && status.textContent === "标注已保存") status.textContent = pageText(); }, 2500);
    } catch (e) {
      book.dirty = true;
      status.textContent = pageText();
      toast(`标注保存失败：${e instanceof Error ? e.message : String(e)}（会自动重试）`, 6000);
      saveTimer = window.setTimeout(() => void saveNow(), 10000);
    } finally {
      saving = false;
    }
  };
  const syncTools = () => {
    if (!book) return;
    toolsRow.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
      const t = b.getAttribute("data-tool")!;
      const on = t === "eraser" ? book!.tool === "eraser" : t === "hl" ? book!.tool === "hl" : book!.tool === "pen" && t === `pen${book!.colorIdx}`;
      b.classList.toggle("on", on);
    });
    toolsRow.querySelectorAll<HTMLElement>("[data-size]").forEach((b) => b.classList.toggle("on", Number(b.getAttribute("data-size")) === book!.sizeIdx));
    toolsRow.querySelector("#finger-draw")?.classList.toggle("on", book.fingerDraw);
    const u = toolsRow.querySelector<HTMLButtonElement>("#note-undo");
    if (u) u.disabled = !book.canUndo;
  };
  function setAnnotating(on: boolean) {
    if (!book) return;
    book.enabled = on;
    annotBtn.classList.toggle("on", on);
    toolsRow.hidden = !on;
    wrap.classList.toggle("annotating", on);
    syncTools();
  }
  const buildTools = () => {
    if (!book) return;
    const nb = book;
    const pick = (t: "pen" | "hl" | "eraser", color = 0) => () => { nb.tool = t; nb.colorIdx = color; syncTools(); };
    const swatch = (i: number, title: string) => h("button", { class: "swatch", "data-tool": `pen${i}`, title, onclick: pick("pen", i) }, h("span", { class: "dot", style: `background:${PEN_COLORS[i]}` }));
    toolsRow.append(
      h("div", { class: "group" }, swatch(0, "黑色笔"), swatch(1, "红色笔"), swatch(2, "蓝色笔"), h("button", { "data-tool": "hl", title: "荧光笔", onclick: pick("hl") }, ic("marker", 20)), h("button", { "data-tool": "eraser", title: "橡皮擦（擦掉碰到的笔画）", onclick: pick("eraser") }, ic("eraser", 20))),
      h("div", { class: "group" }, ...["细", "中", "粗"].map((t, i) => h("button", { "data-size": String(i), onclick: () => { nb.sizeIdx = i; syncTools(); } }, t))),
      h("div", { class: "group" },
        h("button", { id: "note-undo", title: "撤销", onclick: () => nb.undo() }, ic("undo", 20)),
        h("button", { id: "note-clear", title: "清除本页标注", onclick: () => {
          if (!nb.strokes(cur).length) return void toast("这一页没有标注");
          if (!confirm("清除这一页的全部标注？")) return;
          nb.clearPage(cur);
          toast("已清除这一页的标注（可以撤销）");
        } }, ic("trash", 20)),
      ),
      h("button", { class: "toggle", id: "finger-draw", title: "手指也能画（关闭时手指只用来滚动）", onclick: () => { nb.fingerDraw = !nb.fingerDraw; settings.fingerDraw = nb.fingerDraw; saveSettings(settings); wrap.classList.toggle("fingerdraw", nb.fingerDraw); syncTools(); } }, ic("hand", 20), h("span", { class: "lbl" }, "手指也能画")),
    );
    nb.fingerDraw = settings.fingerDraw;
    wrap.classList.toggle("fingerdraw", nb.fingerDraw);
    nb.onChange = () => { syncTools(); clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveNow(), 2500); };
    nb.onBusy = (b) => turn.hold(b);
    nb.onPencil = () => setAnnotating(true); // the Pencil touched the page: start annotating, like forScore
    nb.guardScroll(wrap);
    syncTools();
  };
  const onHide = () => { if (document.visibilityState === "hidden") void saveNow(); };
  document.addEventListener("visibilitychange", onHide);
  disposePlayer = () => {
    turn.dispose();
    clearTimeout(saveTimer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("resize", onResize);
    if (book?.dirty) void api.writePdfNotes(name, book.serialize()).catch(() => {}); // leaving: save what is not saved yet
  };

  // ---- full screen: the toolbars are hidden, a tap in the middle of the page brings them back for a moment
  let chromeTimer = 0;
  const showChrome = (on: boolean) => {
    app.classList.toggle("show", on);
    clearTimeout(chromeTimer);
    if (on) chromeTimer = window.setTimeout(() => app.classList.remove("show"), 8000);
  };
  const fsBtn = h("button", { class: "icon", title: "全屏（隐藏工具栏）", onclick: () => setFull(!app.classList.contains("pdffull")) }, ic("fullscreen", 20));
  function setFull(on: boolean) {
    app.classList.toggle("pdffull", on);
    app.classList.remove("show");
    fsBtn.replaceChildren(ic(on ? "restore" : "fullscreen", 20));
    if (on) {
      toast("全屏：点一下屏幕中间显示工具栏，左右滑动翻页", 4500);
      try { void document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* the page-level full screen is enough */ }
    } else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setTimeout(layout, 50);
  }
  let enteredByApi = false;
  const onFsChange = () => {
    if (document.fullscreenElement) enteredByApi = true;
    else if (enteredByApi) { enteredByApi = false; if (app.classList.contains("pdffull")) setFull(false); } // left with Esc / the system gesture
  };
  document.addEventListener("fullscreenchange", onFsChange);
  const onKeyEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && app.classList.contains("pdffull") && !document.querySelector("dialog[open]")) setFull(false); };
  document.addEventListener("keydown", onKeyEsc);
  const prevDispose = disposePlayer;
  disposePlayer = () => {
    prevDispose?.();
    document.removeEventListener("keydown", onKeyEsc);
    document.removeEventListener("fullscreenchange", onFsChange);
    clearTimeout(chromeTimer);
    app.classList.remove("pdffull", "show");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  const viewBtn = (m: "single" | "scroll", label: string) => h("button", { class: mode === m ? "on" : "", "data-view": m, title: m === "single" ? "单页：一次看一页" : "连续：所有页连着滚动", onclick: () => {
    mode = m;
    settings.pdfView = m;
    saveSettings(settings);
    viewGroup.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-view") === m));
    layout();
    if (m === "scroll") { const sh = sheets[cur - 1]; if (sh) wrap.scrollTo({ top: sh.offsetTop - 12 }); }
  } }, ic(m === "single" ? "page" : "scroll", 20), h("span", { class: "lbl" }, label));
  const viewGroup = h("div", { class: "group" }, viewBtn("single", "单页"), viewBtn("scroll", "连续"));
  /** zoom the pages; the point (cx, cy) on the screen stays where it is (a pinch zooms around the fingers) */
  function setZoom(z: number, cx?: number, cy?: number) {
    z = Math.min(4, Math.max(0.5, z));
    const r = wrap.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left, py = (cy ?? r.top + r.height / 2) - r.top;
    const fx = (wrap.scrollLeft + px) / Math.max(1, wrap.scrollWidth), fy = (wrap.scrollTop + py) / Math.max(1, wrap.scrollHeight);
    zoom = z;
    pages.style.setProperty("--z", String(z));
    wrap.classList.toggle("zoomed", z > 1.01);
    layout();
    wrap.scrollLeft = fx * wrap.scrollWidth - px;
    wrap.scrollTop = fy * wrap.scrollHeight - py;
  }
  const bump = (d: number) => setZoom(zoom + d);
  pages.style.setProperty("--z", "1");
  app.replaceChildren(
    h(
      "div",
      { class: "pdfchrome" },
      h(
        "header",
        { class: "top compact" },
        h("button", { class: "back", title: "返回", onclick: () => (location.hash = "#/") }, ic("chevron-left", 22), h("span", { class: "lbl" }, "返回")),
        h("h1", {}, name.replace(/\.pdf$/i, "")),
        h("div", { class: "grow" }),
        status,
        h("button", { class: "icon", title: "缩小", onclick: () => bump(-0.25) }, ic("minus", 20)),
        h("button", { class: "icon", title: "放大", onclick: () => bump(0.25) }, ic("plus", 20)),
      ),
      // three areas: annotate on the left, how to look at the pages in the middle, the automatic turn in the right corner
      h("div", { class: "pdfbar" },
        h("div", { class: "zone left" }, annotBtn),
        h("div", { class: "zone mid" }, viewGroup, h("div", { class: "group" }, prevBtn, pageInd, nextBtn)),
        h("div", { class: "zone right" }, h("div", { class: "group pair" }, turnBtn, secBtn), fsBtn),
      ),
      toolsRow,
    ),
    h("div", { class: "pdfstage" }, turnBar, wrap, h("button", { class: "icon fshandle", title: "显示工具栏", onclick: () => showChrome(true) }, ic("chevron-down", 20))),
  );
  try {
    let notesText: string | null = null;
    let notesOk = true;
    const [pdfjs, worker, data] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.min.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
      api.downloadPdf(name),
      api.readPdfNotes(name).then((t) => { notesText = t; }).catch((e) => { if (e instanceof api.AuthExpired) throw e; notesOk = false; }),
    ]);
    if (stale()) return;
    if (notesOk) {
      book = new NoteBook(parseNotes(notesText));
      buildTools();
      (annotBtn as HTMLButtonElement).disabled = false;
    } else {
      annotBtn.title = "标注暂时无法使用";
      toast("暂时读不到这份 PDF 的标注（可能没有网络）。为避免盖掉已有的标注，标注功能先关闭。", 7000);
    }
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    if (stale()) return;
    total = doc.numPages;
    status.textContent = pageText();
    showPage();
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
      const notes = h("canvas", { class: "notes", "data-page": String(i) }) as HTMLCanvasElement;
      notes.width = canvas.width;
      notes.height = canvas.height;
      book?.attach(i, notes);
      const sheet = h("div", { class: "pdfsheet", "data-ratio": String(canvas.width / canvas.height) }, canvas, notes);
      sheets.push(sheet);
      pages.append(sheet);
      layout();
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    }
  } catch (e) {
    if (stale()) return;
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    status.textContent = "";
    showError(`无法打开 ${name}`, e);
  }
}

/** The neon look of the game view: on only while a score is open and the Game switch is on. */
function applyGameTheme(onScore = /^#\/(score|duet)\//.test(location.hash)) {
  if (!onScore) document.documentElement.classList.remove("gamecompact");
  if (settings.gameMode) document.documentElement.dataset.gamemode = "1"; else delete document.documentElement.dataset.gamemode; // hidden mode on: the title bar glows (all screens)
  if (settings.gameMode && settings.gameView && onScore) document.documentElement.dataset.game = "1";
  else delete document.documentElement.dataset.game;
}
function route() {
  applyGameTheme();
  if (location.hash.startsWith("#/link/")) return void signInFromLink(location.hash);
  if (!api.getAuth() && !api.isLocal()) return renderLogin();
  const d = location.hash.match(/^#\/duet\/([^/]+)\/([^/]+)$/);
  const pdf = location.hash.match(/^#\/pdf\/(.+)$/);
  const m = location.hash.match(/^#\/score\/(.+)$/);
  if (!d && !pdf && !m) return void renderHome();
  // opening a score needs the trial or the unlock; the library, settings and backups always work
  void mayOpenScores().then((ok) => {
    if (!ok) {
      history.replaceState(null, "", "#/");
      return void renderHome();
    }
    if (d) {
      const a = decodeURIComponent(d[1]);
      const b = decodeURIComponent(d[2]);
      void api.readPairs().then((ps) => renderDuet(ps.find((p) => p.a === a && p.b === b) ?? { name: defaultPairName(a, b), a, b }));
    } else if (pdf) void renderPdf(decodeURIComponent(pdf[1]));
    else if (m) void renderPlayer(decodeURIComponent(m[1]));
  });
}
startErrorLog();
window.addEventListener("hashchange", route);
route();
if (ent.hasStore()) {
  void ent.access().then((a) => {
    if (a.kind === "trial") toast(`试用期还剩 ${a.daysLeft} 天`, 4000);
  });
}

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

if ("serviceWorker" in navigator && import.meta.env.PROD && !__MOBILE__) {
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
