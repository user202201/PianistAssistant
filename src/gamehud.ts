import type { Judgement, Level, Stats } from "./gamescore";
import type { MidiState } from "./midi";

/**
 * The score display of the game mode. It must not hide the music, so it is split in three:
 *  - `compact`: only score, combo and accuracy, transparent, in a corner of the game panel;
 *  - `chip` + `setup`: a small button (with a dot: is a piano connected) that opens a card with the piano connection and the level;
 *  - `result`: the summary (stars, score, accuracy, longest combo, how many of each kind) shown once, when the piece is over.
 */
export interface Hud {
  compact: HTMLElement;
  chip: HTMLElement;
  setup: HTMLElement;
  result: HTMLElement;
  reset(): void;
  update(s: Stats, accuracy: number): void;
  judged(j: Judgement): void;
  showResult(s: Stats, stars: number, accuracy: number): void;
  midi(s: MidiState): void;
  setLevel(l: Level): void;
  openSetup(open?: boolean): void;
  setHidden(hidden: boolean): void;
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

export function createHud(o: { level: Level; onLevel: (l: Level) => void; onConnect: () => void; onPair: (() => void) | null; onRetry: () => void }): Hud {
  // ---- compact numbers
  const compact = el("div", "hudcompact");
  const score = el("div", "hudscore", "0");
  const comboNum = el("b", "", "0"), accNum = el("b", "", "100%");
  const combo = el("div", "hudline", "", [el("span", "", "连击"), comboNum]);
  const acc = el("div", "hudline", "", [el("span", "", "准确率"), accNum]);
  compact.append(score, combo, acc);

  // ---- the chip and the setup card
  const dot = el("span", "hudleddot");
  const chip = el("button", "hudchip", "", [dot, el("span", "", "钢琴")]);
  chip.title = "钢琴";
  const setup = el("div", "gamesetup");
  setup.hidden = true;
  const status = el("div", "hudstatus");
  const connect = el("button", "hudbtn", "连接钢琴");
  connect.onclick = () => o.onConnect();
  const pair = o.onPair ? el("button", "hudbtn", "蓝牙钢琴") : null;
  if (pair) pair.onclick = () => o.onPair!();
  const levelRow = el("div", "hudlevel");
  const levelBtns: Record<Level, HTMLButtonElement> = { easy: el("button", "seg", "轻松"), normal: el("button", "seg", "标准"), hard: el("button", "seg", "挑战") };
  (Object.keys(levelBtns) as Level[]).forEach((l) => { levelBtns[l].onclick = () => { o.onLevel(l); setLevel(l); }; levelRow.append(levelBtns[l]); });
  setup.append(status, connect, ...(pair ? [pair] : []), levelRow);
  const place = () => { const r = chip.getBoundingClientRect(); setup.style.left = `${Math.max(8, r.left)}px`; setup.style.bottom = `${window.innerHeight - r.top + 8}px`; };
  const openSetup = (open?: boolean) => { const want = open ?? setup.hidden; if (want) place(); setup.hidden = !want; };
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
    compact, chip, setup, result,
    reset() { result.hidden = true; this.update({ score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0, total: 0 }, 1); },
    update(s, a) { score.textContent = String(s.score); comboNum.textContent = String(s.combo); accNum.textContent = `${Math.round(a * 100)}%`; },
    judged(j) {
      if (j.kind !== "miss" && j.kind !== "wrong" && j.combo > 0 && j.combo % 10 === 0) popCombo();
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
    setLevel, openSetup,
    setHidden(hidden) { compact.hidden = hidden; chip.hidden = hidden; if (hidden) { setup.hidden = true; result.hidden = true; } },
    destroy() { document.removeEventListener("click", closeOutside); compact.remove(); chip.remove(); setup.remove(); result.remove(); },
  };
}
