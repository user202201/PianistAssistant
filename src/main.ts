import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import QRCode from "qrcode";
import type { Smplr } from "smplr";
import * as api from "./api";
import { SOUNDS, createSynth } from "./audio";
import { Player } from "./player";
import { extractScore, toMusicXml } from "./score";
import { getRecent, loadSettings, pushRecent, saveSettings } from "./settings";

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

// ---------- home ----------
async function renderHome() {
  cleanup();
  const list = h("div", { class: "grid" });
  const recent = h("div", { class: "grid" });
  const recentSec = h("section", {}, h("h2", {}, "最近打开"), recent);
  const status = h("p", { class: "muted" }, "加载中…");
  const file = h("input", { type: "file", accept: ".musicxml,.xml,.mxl", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    for (const f of Array.from(file.files ?? [])) {
      try {
        toast(`上传中：${f.name}`);
        await api.uploadScore(f);
        toast(`已上传：${f.name}`);
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
    h("main", { class: "home" }, recentSec, h("section", {}, h("h2", {}, "全部琴谱"), status, list)),
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

  async function load() {
    try {
      const scores = await api.listScores();
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
function cleanup() {
  disposePlayer?.();
  disposePlayer = null;
}

async function renderPlayer(name: string) {
  cleanup();
  const scoreBox = h("div", { class: "score" });
  const status = h("span", { class: "status" }, "加载乐谱…");
  app.replaceChildren(
    h(
      "header",
      { class: "top compact" },
      h("button", { onclick: () => (location.hash = "#/") }, "← 返回"),
      h("h1", {}, displayName(name)),
      h("div", { class: "grow" }),
      status,
      h("button", { onclick: () => openSettings(() => void applySound()), title: "设置" }, "⚙"),
    ),
    h("div", { class: "scorewrap" }, scoreBox),
  );

  let osmd: OpenSheetMusicDisplay;
  let player: Player;
  try {
    const buf = await api.downloadScore(name);
    osmd = new OpenSheetMusicDisplay(scoreBox, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: "#22c55e", alpha: 0.45, follow: true }],
    });
    await osmd.load(toMusicXml(buf));
    osmd.zoom = settings.zoom;
    osmd.render();
    osmd.cursor.show();
    const score = extractScore(osmd, displayName(name));
    const inst = await getInstrument(settings.sound, (s) => (status.textContent = s));
    player = new Player(osmd, score, audioCtx(), inst);
    player.volume = settings.volume;
    pushRecent(name);

    // expose for tests / debugging
    (window as unknown as { __pianist: unknown }).__pianist = { player, score, osmd };

    buildControls(player, score, osmd, status);
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
  function zoom(d: number) {
    settings.zoom = Math.min(2.5, Math.max(0.4, +(settings.zoom + d).toFixed(2)));
    saveSettings(settings);
    const step = player.currentStep;
    osmd.zoom = settings.zoom;
    osmd.render();
    osmd.cursor.show();
    player.seekStep(step);
  }

  playBtn.addEventListener("click", () => (player.playing ? player.pause() : void player.play()));
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
    if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
    if (e.code === "ArrowRight") player.seekMeasure(player.measureIndex + 1);
    if (e.code === "ArrowLeft") player.seekMeasure(Math.max(0, player.measureIndex - 1));
  };
  document.addEventListener("keydown", onKey);
  const prevDispose = disposePlayer;
  disposePlayer = () => { document.removeEventListener("keydown", onKey); prevDispose?.(); };

  const bar = h(
    "footer",
    { class: "controls" },
    panel,
    h("div", { class: "row" }, stopBtn, playBtn, h("div", { class: "speedbox" }, speed, speedLabel), pos),
    h(
      "div",
      { class: "row wrap" },
      hasHands && h("div", { class: "group" }, h("span", { class: "gl" }, "手"), ...Object.values(handBtns)),
      score.parts.length > 1 && h("div", { class: "group" }, h("span", { class: "gl" }, "声部"), ...partBtns),
      h("div", { class: "grow" }),
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
