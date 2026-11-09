import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import QRCode from "qrcode";
import type { Smplr } from "smplr";
import * as api from "./api";
import { SOUNDS, createSynth, unlockIOSAudio } from "./audio";
import { FingerTools } from "./fingerui";
import { Player } from "./player";
import { extractScore, toMusicXml } from "./score";
import { clearQueued, getRecent, loadSettings, markQueued, pushRecent, queuedAt, saveSettings } from "./settings";

const app = document.getElementById("app")!;
const settings = loadSettings();

// ---------- tiny helpers ----------
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
const toast = (msg: string) => {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
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
      h("h1", {}, "🎹 Pianist Assistant"),
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
function openSettings(onSound?: () => void) {
  const dlg = h("dialog", { class: "dlg" });
  const sound = h("select", {}, ...SOUNDS.map((s) => h("option", { value: s.id, selected: s.id === settings.sound }, s.label)));
  sound.addEventListener("change", () => {
    settings.sound = sound.value;
    saveSettings(settings);
    onSound?.();
  });
  const vol = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(settings.volume) });
  vol.addEventListener("input", () => {
    settings.volume = Number(vol.value);
    saveSettings(settings);
    onSound?.();
  });
  const a = api.getAuth();
  dlg.append(
    h("h2", {}, "设置"),
    h("label", {}, "钢琴音色", sound),
    h("label", {}, "音量", vol),
    h("h3", {}, "登录与设备"),
    h(
      "p",
      { class: "muted" },
      a ? `本设备：${a.user ?? "GitHub"} · ${a.repo} · ${api.isPersistent() ? "保持登录" : "仅本次"}` : "",
    ),
    h(
      "div",
      { class: "row wrap" },
      h("button", { id: "qr-btn", onclick: () => showQr() }, "📱 手机扫码登录"),
      h("button", { id: "copy-link", onclick: async () => {
        const cur = api.getAuth();
        if (!cur) return;
        try { await navigator.clipboard.writeText(api.makeLoginLink(cur)); toast("登录链接已复制，粘贴到另一台设备的登录页即可"); }
        catch { toast("复制失败，请改用扫码"); }
      } }, "复制登录链接"),
    ),
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
      h("button", { onclick: () => { api.logout(); dlg.close(); renderLogin(); } }, "退出本设备"),
      h("button", { class: "primary", onclick: () => dlg.close() }, "完成"),
    ),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
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
  });
}

// ---------- home ----------
async function renderHome() {
  cleanup();
  const list = h("div", { class: "grid" });
  const recent = h("div", { class: "grid" });
  const recentSec = h("section", {}, h("h2", {}, "最近打开"), recent);
  const queue = h("div", { class: "grid" });
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
  const queueSec = h(
    "section",
    { hidden: true },
    h("h2", {}, "PDF / 图片转换"),
    banner,
    queue,
    h("p", { class: "muted small" }, "转换由私有琴谱仓库里的 GitHub 自动任务完成，通常需要几分钟。识别结果可能有错，请打开后核对，必要时在 MuseScore 里修改。"),
  );
  const status = h("p", { class: "muted" }, "加载中…");
  const file = h("input", { type: "file", accept: ".musicxml,.xml,.mxl,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,application/pdf,image/*", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    for (const f of Array.from(file.files ?? [])) {
      try {
        toast(`上传中：${f.name}`);
        const up = await api.uploadScore(f, askConflict);
        if (!up) toast(`已跳过：${f.name}`);
        else if (up.kind === "inbox") {
          optimistic.set(up.name, Date.now());
          markQueued(up.name);
          toast(`已加入转换队列：${up.name}`);
          prevPending.add(up.name);
        } else toast(`已上传：${up.name}`);
      } catch (e) {
        if (e instanceof api.AuthExpired) return renderLogin(e.message);
        toast((e as Error).message);
      }
    }
    file.value = "";
    load();
  });

  app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("h1", {}, "🎹 我的琴谱"),
      h("div", { class: "grow" }),
      h("button", { class: "primary", onclick: () => file.click() }, "＋ 上传琴谱"),
      h("button", { onclick: () => openSettings(), title: "设置" }, "⚙"),
    ),
    file,
    h("main", { class: "home" }, queueSec, recentSec, h("section", {}, h("h2", {}, "全部琴谱"), status, list)),
  );

  const card = (name: string, del = false) =>
    h(
      "div",
      { class: "card" },
      h("button", { class: "open", onclick: () => (location.hash = `#/score/${encodeURIComponent(name)}`) }, displayName(name)),
      del &&
        h("button", {
          class: "del",
          title: "删除",
          onclick: async () => {
            if (!confirm(`删除「${displayName(name)}」？`)) return;
            try {
              await api.deleteScore(name);
              load();
            } catch (e) {
              toast((e as Error).message);
            }
          },
        }, "🗑"),
    );

  const waited = (name: string): string => {
    const ts = queuedAt()[name];
    if (!ts) return "";
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "刚刚上传";
    return m >= 20 ? `已等待 ${m} 分钟，时间偏长，请点上方链接查看进度` : `已等待 ${m} 分钟`;
  };
  const queueCard = (it: api.InboxItem) =>
    h(
      "div",
      { class: "card" + (it.failed ? " failed" : " busy") },
      it.failed
        ? h("span", { class: "open static" }, `⚠ ${it.name}（转换失败）`)
        : h("span", { class: "open static qline" }, h("span", { class: "spin small" }), h("span", {}, h("div", {}, it.name), h("div", { class: "muted small" }, `转换中… ${waited(it.name)}`))),
      it.failed &&
        h("button", { class: "del", title: "查看原因", onclick: async () => {
          try { showLog(it.name, await api.readFailureLog(it.name)); } catch (e) { toast((e as Error).message); }
        } }, "ℹ"),
      h("button", { class: "del", title: "删除", onclick: async () => {
        if (!confirm(`从队列中删除「${it.name}」？`)) return;
        try { await api.deleteInbox(it.name); clearQueued(it.name); optimistic.delete(it.name); load(); } catch (e) { toast((e as Error).message); }
      } }, "🗑"),
    );
  function showLog(name: string, text: string) {
    const dlg = h("dialog", { class: "dlg" }, h("h2", {}, `转换失败：${name}`), h("pre", { class: "log" }, text), h("button", { class: "primary", onclick: () => dlg.close() }, "关闭"));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  async function load() {
    clearTimeout(homeTimer);
    try {
      const listed = await api.listInbox().catch((e) => { if (e instanceof api.AuthExpired) throw e; return [] as api.InboxItem[]; });
      const scores = await api.listScores();
      // a just-uploaded file may not show up in GitHub's listing for a few seconds: keep showing it
      const inbox = [...listed];
      for (const [n, ts] of optimistic) {
        if (listed.some((i) => i.name === n)) optimistic.delete(n);
        else if (Date.now() - ts > 90000 || scores.some((x) => x.name === n.replace(/\.[^.]+$/, ".musicxml"))) optimistic.delete(n);
        else inbox.push({ name: n, failed: false });
      }
      // finished or failed since the last check -> tell the user
      const pendingNow = new Set(inbox.filter((i) => !i.failed).map((i) => i.name));
      for (const n of prevPending) {
        if (pendingNow.has(n)) continue;
        const stem = n.replace(/\.[^.]+$/, "");
        if (scores.some((x) => x.name.startsWith(stem + "."))) { toast(`✅ 转换完成：${stem}，已加入琴谱列表（请打开核对）`); clearQueued(n); }
        else if (inbox.some((i) => i.name === n && i.failed)) toast(`⚠ 转换失败：${n}，点它旁边的 ℹ 查看原因`);
      }
      prevPending = pendingNow;
      queue.replaceChildren(...inbox.map(queueCard));
      queueSec.hidden = inbox.length === 0;
      banner.hidden = pendingNow.size === 0;
      if (pendingNow.size) homeTimer = window.setTimeout(load, 10000); // poll while converting
      const names = new Set(scores.map((s) => s.name));
      list.replaceChildren(...scores.sort((a, b) => a.name.localeCompare(b.name, "zh")).map((s) => card(s.name, true)));
      status.textContent = scores.length ? "" : "还没有琴谱，点右上角“上传琴谱”（支持 MusicXML / .mxl）。";
      const rec = getRecent().filter((n) => names.has(n));
      recent.replaceChildren(...rec.map((n) => card(n)));
      recentSec.hidden = rec.length === 0;
    } catch (e) {
      if (e instanceof api.AuthExpired) return renderLogin(e.message);
      status.textContent = (e as Error).message;
    }
  }
  load();
}

// ---------- player ----------
let disposePlayer: (() => void) | null = null;
let homeTimer = 0;
/** queued PDFs the server has not listed yet, and which ones were converting at the last check */
const optimistic = new Map<string, number>();
let prevPending = new Set<string>();
function cleanup() {
  clearTimeout(homeTimer);
  disposePlayer?.();
  disposePlayer = null;
}

async function renderPlayer(name: string) {
  cleanup();
  // OSMD owns (and clears) scoreBox on every render, so overlays live in the outer holder instead
  const scoreBox = h("div", { class: "osmd" });
  const holder = h("div", { class: "score" }, scoreBox);
  const status = h("span", { class: "status" }, "加载乐谱…");
  app.replaceChildren(
    h(
      "header",
      { class: "top compact" },
      h("button", { onclick: () => { if (leaveGuard()) location.hash = "#/"; } }, "← 返回"),
      h("h1", {}, displayName(name)),
      h("div", { class: "grow" }),
      status,
      h("button", { onclick: () => openSettings(() => void applySound()), title: "设置" }, "⚙"),
    ),
    h("div", { class: "scorewrap" }, holder),
  );

  let osmd: OpenSheetMusicDisplay;
  let player: Player;
  let leaveGuard: () => boolean = () => true;
  try {
    const buf = await api.downloadScore(name);
    osmd = new OpenSheetMusicDisplay(scoreBox, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: true }],
    });
    const xml = toMusicXml(buf);
    await osmd.load(xml);
    osmd.zoom = settings.zoom;
    osmd.render();
    osmd.cursor.show();
    const tools = new FingerTools(osmd, holder, xml);
    tools.visible = settings.fingers;
    if (!tools.visible) {
      osmd.EngravingRules.RenderFingerings = false;
      osmd.render();
      osmd.cursor.show();
    }
    tools.refresh();
    leaveGuard = () => !tools.dirty || confirm("有未保存的指法，确定离开？");
    const score = extractScore(osmd, displayName(name));
    const inst = await getInstrument(settings.sound, (s) => (status.textContent = s));
    player = new Player(osmd, score, audioCtx(), inst);
    player.volume = settings.volume;
    pushRecent(name);

    // expose for tests / debugging
    (window as unknown as { __pianist: unknown }).__pianist = { player, score, osmd, tools };

    buildControls(player, score, osmd, status, tools, name);
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
      releaseWake();
    };
  } catch (e) {
    if (e instanceof api.AuthExpired) return renderLogin(e.message);
    status.textContent = "";
    scoreBox.replaceChildren(h("p", { class: "error pad" }, `无法打开乐谱：${(e as Error).message}`));
  }
}
let applySound: () => Promise<void> = async () => {};

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
  osmd: OpenSheetMusicDisplay,
  status: HTMLElement,
  tools: FingerTools,
  name: string,
) {
  const playBtn = h("button", { class: "primary big", title: "播放 / 暂停 (空格)" }, "▶");
  const stopBtn = h("button", { class: "big", title: "回到开头" }, "⏮");
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

  const partBtns = score.parts.map((p, i) =>
    h("button", { class: "seg", title: "点击开/关该声部的声音", onclick: () => { player.partOn[i] = !player.partOn[i]; if (!player.partOn.some(Boolean)) player.partOn[i] = true; sync(); } }, p),
  );

  // practice panel
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
    h("label", { class: "inline" }, cbCount, "开始前倒数一小节"),
    h("label", { class: "inline" }, cbMetro, "节拍器"),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbLoop, "循环小节"), from, "到", to, useCurrent),
    h("div", { class: "line" }, h("label", { class: "inline" }, cbRamp, "每遍加速"), rampStep, "% ，上限", rampMax, "%"),
  );
  const practiceBtn = h("button", { onclick: () => (panel.hidden = !panel.hidden) }, "练习 ▾");

  const zoomIn = h("button", { onclick: () => zoom(0.1), title: "放大" }, "＋");
  const zoomOut = h("button", { onclick: () => zoom(-0.1), title: "缩小" }, "－");
  function rerender() {
    const step = player.currentStep;
    osmd.EngravingRules.RenderFingerings = tools.visible && tools.showXml;
    osmd.zoom = settings.zoom;
    osmd.render();
    osmd.cursor.show();
    player.seekStep(step);
    tools.refresh();
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
  const editBtn = h("button", { class: "primary", onclick: () => enterEdit() }, "✏ 编辑指法");
  const fpanel = h(
    "div",
    { class: "panel", hidden: true },
    h("label", { class: "inline" }, cbXml, tools.xmlCount ? `显示乐谱里的指法（${tools.xmlCount} 个音符）` : "乐谱里没有指法信息"),
    h("label", { class: "inline" }, cbAuto, h("span", {}, "自动建议指法（", h("b", { class: "blue" }, "蓝色"), "，仅作参考；已有指法的音符不会被改动）")),
    h("p", { class: "muted small" }, "优先级：乐谱里的指法 > 自动建议。自己标注的指法保存后写进乐谱文件，之后读取以它为准。"),
    editBtn,
  );
  const fingerToggle = h("button", { class: "toggle", title: "显示 / 隐藏指法", disabled: !tools.supported, onclick: () => setFingers(!tools.visible) }, "指法");
  const fingerOpts = h("button", { class: "narrow", title: "指法选项", disabled: !tools.supported, onclick: () => { fpanel.hidden = !fpanel.hidden; panel.hidden = true; } }, "▾");
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
  const fclear = h("button", { class: "fnum", title: "清除该音符的指法", onclick: () => tools.apply(null) }, "✕");
  const fundo = h("button", { class: "fnum", title: "撤销", onclick: () => tools.undo() }, "↶");
  const finfo = h("span", { class: "finfo" });
  const fsave = h("button", { class: "primary", onclick: () => void saveFingering() }, "保存");
  const fdone = h("button", { onclick: () => exitEdit() }, "完成");
  const editbar = h("div", { class: "editbar", hidden: true }, ...fbtns, fclear, fundo, finfo, h("div", { class: "grow" }), fsave, fdone);
  function enterEdit() {
    if (!tools.visible) setFingers(true);
    fpanel.hidden = true;
    editbar.hidden = false;
    document.querySelector(".scorewrap")?.classList.add("editing");
    tools.setEditing(true);
  }
  function exitEdit() {
    if (tools.dirty && !confirm("有未保存的指法，放弃这些修改？")) return;
    tools.discard();
    editbar.hidden = true;
    document.querySelector(".scorewrap")?.classList.remove("editing");
    tools.setEditing(false);
  }
  async function saveFingering() {
    fsave.disabled = true;
    try {
      const xml = await tools.save((x) => api.saveScoreText(name, x, `Fingering: ${displayName(name)}`));
      await osmd.load(xml);
      rerender();
      toast("指法已保存到乐谱");
    } catch (e) {
      if (e instanceof api.AuthExpired) return renderLogin(e.message);
      toast(`保存失败：${(e as Error).message}`);
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

  function sync() {
    playBtn.textContent = player.playing ? "⏸" : "▶";
    const bpm = Math.round(score.baseBpm * player.speed);
    speed.value = String(Math.round(player.speed * 100));
    speedLabel.textContent = `${Math.round(player.speed * 100)}% · ♩=${bpm}`;
    pos.textContent = `第 ${player.measureIndex + 1} / ${score.measureCount} 小节`;
    const mode = player.handOn.right && player.handOn.left ? "both" : player.handOn.right ? "right" : "left";
    for (const [k, b] of Object.entries(handBtns)) b.classList.toggle("on", k === mode);
    partBtns.forEach((b, i) => b.classList.toggle("on", player.partOn[i]));
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

  const bar = h(
    "footer",
    { class: "controls" },
    panel,
    fpanel,
    editbar,
    h("div", { class: "row" }, stopBtn, playBtn, h("div", { class: "speedbox" }, speed, speedLabel), pos),
    h(
      "div",
      { class: "row wrap" },
      hasHands && h("div", { class: "group" }, h("span", { class: "gl" }, "手"), ...Object.values(handBtns)),
      score.parts.length > 1 && h("div", { class: "group" }, h("span", { class: "gl" }, "声部"), ...partBtns),
      h("div", { class: "grow" }),
      fingerBtn,
      practiceBtn,
      zoomOut,
      zoomIn,
    ),
  );
  app.append(bar);
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

function route() {
  if (location.hash.startsWith("#/link/")) return void signInFromLink(location.hash);
  if (!api.getAuth()) return renderLogin();
  const m = location.hash.match(/^#\/score\/(.+)$/);
  if (m) void renderPlayer(decodeURIComponent(m[1]));
  else void renderHome();
}
window.addEventListener("hashchange", route);
route();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
