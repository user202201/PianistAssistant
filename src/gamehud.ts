import type { Judgement, Level, Stats } from "./gamescore";
import type { MidiState } from "./midi";

/**
 * The score display of the game mode. It must not hide the music, so it is split in three:
 *  - `scoreBox` (next to the 3D button) and `comboBox` (under the demo / score switch): only the numbers, no background, in the game panel;
 *  - `chip` + `setup`: a small button (with a dot: is a piano connected) that opens a card with the piano connection and the level;
 *  - `result`: the summary (stars, score, accuracy, longest combo, how many of each kind) shown once, when the piece is over.
 */
export interface Hud {
  /** the total score: in the game panel next to the 3D button */
  scoreBox: HTMLElement;
  /** the combo: in the game panel under the demo / score switch */
  comboBox: HTMLElement;
  chip: HTMLElement;
  setup: HTMLElement;
  result: HTMLElement;
  reset(): void;
  update(s: Stats, accuracy: number): void;
  judged(j: Judgement): void;
  showResult(s: Stats, stars: number, accuracy: number): void;
  midi(s: MidiState): void;
  /** the microphone (an acoustic piano): on / off / why not */
  micState(s: "off" | "on" | "denied" | "unsupported"): void;
  micLevel(l: number): void;
  /** the tone the microphone heard last (a note name like C4), or null when it is long ago */
  micHeard(name: string | null): void;
  setLevel(l: Level): void;
  openSetup(open?: boolean): void;
  setHidden(hidden: boolean): void;
  /** the piano button is for score mode only */
  setChip(show: boolean): void;
  destroy(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "", kids: (Node | null)[] = []) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  for (const k of kids) if (k) e.append(k);
  return e;
};
const KINDS: [keyof Stats, string, string][] = [["perfect", "完美", "#ffd60a"], ["good", "不错", "#7dff6b"], ["early", "偏早", "#9ad1ff"], ["late", "偏晚", "#ffb86b"], ["miss", "漏掉", "#ff5a5a"], ["wrong", "错键", "#ff5a5a"]];

export function createHud(o: { level: Level; onLevel: (l: Level) => void; onConnect: () => void; onPair: (() => void) | null; onRetry: () => void; latency: number; onLatency: (ms: number) => void; onMic: () => void; micSens: number; onMicSens: (n: number) => void }): Hud {
  // ---- compact numbers
  const scoreBox = el("div", "hudscorebox");
  const score = el("div", "hudscore", "0");
  scoreBox.append(score);
  const comboNum = el("b", "", "0");
  const combo = el("div", "hudcombo", "", [el("span", "", "连击"), comboNum]);
  const comboBox = el("div", "hudcombobox", "", [combo]);

  // ---- the chip and the setup card
  const dot = el("span", "hudleddot");
  const chip = el("button", "hudchip", "", [dot, el("span", "", "钢琴")]);
  chip.title = "钢琴";
  const setup = el("div", "gamesetup");
  setup.hidden = true;
  const status = el("div", "hudstatus");
  const connect = el("button", "hudbtn", "连接钢琴");
  connect.onclick = () => o.onConnect();
  const micBtn = el("button", "hudbtn", "用麦克风听");
  micBtn.onclick = () => o.onMic();
  const micText = el("div", "hudstatus");
  const meter = el("div", "hudmeter"), meterFill = el("i");
  meter.append(meterFill); meter.hidden = true;
  const heard = el("div", "hudheard"); heard.hidden = true;
  const sensRow = el("div", "hudsens", "", [el("span", "", "麦克风灵敏度")]);
  const sensBtns = [el("button", "seg", "低"), el("button", "seg", "中"), el("button", "seg", "高")];
  const setSens = (n: number) => sensBtns.forEach((b, i) => b.classList.toggle("on", i === n));
  sensBtns.forEach((b, i) => { b.onclick = () => { o.onMicSens(i); setSens(i); }; sensRow.append(b); });
  setSens(o.micSens);
  sensRow.hidden = true;
  const pair = o.onPair ? el("button", "hudbtn", "蓝牙钢琴") : null;
  if (pair) pair.onclick = () => o.onPair!();
  const levelRow = el("div", "hudlevel");
  const levelBtns: Record<Level, HTMLButtonElement> = { easy: el("button", "seg", "轻松"), normal: el("button", "seg", "标准"), hard: el("button", "seg", "挑战") };
  (Object.keys(levelBtns) as Level[]).forEach((l) => { levelBtns[l].onclick = () => { o.onLevel(l); setLevel(l); }; levelRow.append(levelBtns[l]); });
  // "my piano feels late": a few ms earlier / later for every key
  let lat = o.latency;
  const latVal = el("b", "", `${lat} ms`);
  const step = (d: number) => { lat = Math.max(-200, Math.min(200, lat + d)); latVal.textContent = `${lat} ms`; o.onLatency(lat); };
  const minus = el("button", "hudbtn small", "−"), plus = el("button", "hudbtn small", "+");
  minus.onclick = () => step(-10); plus.onclick = () => step(10);
  const latRow = el("div", "hudlat", "", [el("span", "", "延迟补偿"), el("div", "hudlatctl", "", [minus, latVal, plus])]);
  // rarely needed: hidden behind a handle at the bottom edge of the card; click it or pull it down to show
  const more = el("div", "hudmore");
  more.append(latRow);
  const handle = el("button", "hudmorehandle");
  handle.title = "延迟补偿";
  handle.append(el("span", "hudgrip"), el("span", "hudcaret", "⌄"));
  const toggleMore = (open?: boolean) => { const on = open ?? !setup.classList.contains("open"); setup.classList.toggle("open", on); handle.querySelector(".hudcaret")!.textContent = on ? "⌃" : "⌄"; };
  let y0: number | null = null;
  handle.onpointerdown = (e) => { y0 = e.clientY; };
  handle.onpointermove = (e) => { if (y0 !== null && e.clientY - y0 > 10) { toggleMore(true); y0 = null; } else if (y0 !== null && y0 - e.clientY > 10) { toggleMore(false); y0 = null; } };
  handle.onpointerup = () => { y0 = null; };
  handle.onclick = () => toggleMore();
  setup.append(status, connect, ...(pair ? [pair] : []), micBtn, micText, meter, heard, sensRow, levelRow, more, handle);
  const place = () => { const r = chip.getBoundingClientRect(); setup.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - (setup.offsetWidth || 250) - 8))}px`; setup.style.bottom = `${window.innerHeight - r.top + 8}px`; };
  const openSetup = (open?: boolean) => { const want = open ?? setup.hidden; setup.hidden = !want; if (want) place(); }; // (shown first: its width is needed to keep it on the screen)
  chip.onclick = (e) => { e.stopPropagation(); openSetup(); };
  const closeOutside = (e: Event) => { if (!setup.hidden && !(e.target as HTMLElement).closest(".gamesetup, .hudchip")) setup.hidden = true; };
  document.addEventListener("click", closeOutside);

  // ---- the summary
  const result = el("div", "gameresult");
  result.hidden = true;
  const stars = el("div", "hudstars"), resScore = el("div", "hudresscore"), resCounts = el("div", "hudcounts");
  const retry = el("button", "hudbtn primary", "再来一次"), close = el("button", "hudbtn", "关闭");
  retry.onclick = () => { result.hidden = true; o.onRetry(); };
  close.onclick = () => { result.hidden = true; };
  result.append(el("div", "hudtitle", "完成！"), stars, resScore, resCounts, el("div", "hudrow", "", [close, retry]));

  function setLevel(l: Level) { (Object.keys(levelBtns) as Level[]).forEach((k) => levelBtns[k].classList.toggle("on", k === l)); }
  setLevel(o.level);
  const popCombo = () => { combo.classList.remove("pop"); void combo.offsetWidth; combo.classList.add("pop"); };

  return {
    scoreBox, comboBox, chip, setup, result,
    reset() { result.hidden = true; this.update({ score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0, total: 0 }, 1); },
    update(s, a) {
      void a; score.textContent = String(s.score); if (s.combo >= 2 || !s.score) comboNum.textContent = String(s.combo); // (when the run breaks the old number stays while it fades out) // (the accuracy is in the summary at the end)
      combo.classList.toggle("on", s.combo >= 2);
      combo.style.setProperty("--lv", String(Math.min(1, s.combo / 50))); // the glow of the combo grows with the run
    },
    judged(j) {
      if (j.points <= 0) return; // nothing was scored (a Miss / wrong key): nothing moves
      combo.classList.remove("hit"); void combo.offsetWidth; combo.classList.add("hit");
      if (j.combo > 0 && j.combo % 10 === 0) popCombo();
      score.classList.remove("bump"); void score.offsetWidth; score.classList.add("bump");
    },
    showResult(s, n, a) {
      stars.textContent = "★".repeat(n) + "☆".repeat(3 - n);
      resScore.replaceChildren(el("div", "hudbig", String(s.score)), el("div", "hudlabel", `${Math.round(a * 100)}%  ·  ${s.maxCombo}x`));
      resCounts.replaceChildren(...KINDS.map(([k, label, col]) => { const b = el("b", "", String(s[k])); b.style.color = col; return el("div", "hudcount", "", [el("span", "", label), b]); }));
      result.hidden = false;
    },
    midi(s) {
      connect.hidden = s.kind === "ready" || s.kind === "unsupported";
      status.replaceChildren(
        s.kind === "ready" ? el("span", "ok", "已连接") : s.kind === "none" ? el("span", "", "未找到钢琴") : s.kind === "unsupported" ? el("span", "", "这个浏览器不能连接钢琴") : s.kind === "denied" ? el("span", "", "没有获得 MIDI 许可") : el("span", "", "未连接钢琴"),
        ...(s.kind === "ready" ? [el("span", "devname", " " + s.devices.join(", "))] : []),
      );
      chip.classList.toggle("connected", s.kind === "ready");
    },
    micState(st) {
      micBtn.textContent = st === "on" ? "关闭麦克风" : "用麦克风听";
      meter.hidden = st !== "on"; sensRow.hidden = st !== "on"; heard.hidden = st !== "on";
      micText.replaceChildren(st === "on" ? el("span", "ok", "麦克风已开启") : st === "denied" ? el("span", "", "没有麦克风许可") : st === "unsupported" ? el("span", "", "这个浏览器不能用麦克风") : el("span", ""));
      micText.hidden = st === "off";
      chip.classList.toggle("mic", st === "on");
    },
    micHeard(name) { heard.replaceChildren(el("span", "", "听到"), el("b", "", name ?? "–")); },
    micLevel(l) { meterFill.style.width = `${Math.round(Math.max(0, Math.min(1, l)) * 100)}%`; },
    setLevel, openSetup,
    setChip(show) { chip.hidden = !show; if (!show) setup.hidden = true; },
    setHidden(hidden) { scoreBox.hidden = hidden; comboBox.hidden = hidden; if (hidden) { chip.hidden = true; setup.hidden = true; result.hidden = true; } },
    destroy() { document.removeEventListener("click", closeOutside); scoreBox.remove(); comboBox.remove(); chip.remove(); setup.remove(); result.remove(); },
  };
}
