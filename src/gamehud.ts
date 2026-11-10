import type { Judgement, Level, Stats } from "./gamescore";
import type { MidiState } from "./midi";

/**
 * The floating score window of the game mode (at the side): score, combo, accuracy, the count of each kind of hit, the state of the piano connection,
 * the level, and the result with stars when a round is over. It only shows what the game logic tells it.
 */
export interface Hud {
  el: HTMLElement;
  reset(): void;
  update(s: Stats, accuracy: number): void;
  judged(j: Judgement): void;
  result(s: Stats, stars: number, accuracy: number): void;
  midi(s: MidiState): void;
  setLevel(l: Level): void;
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

export function createHud(o: { level: Level; onLevel: (l: Level) => void; onConnect: () => void; onPair: (() => void) | null; onRetry: () => void }): Hud {
  const root = el("aside", "gamehud");
  if (window.innerWidth < 560) root.classList.add("min"); // a phone: starts folded to its title
  const head = el("button", "hudhead", "", [el("span", "", "计分"), el("span", "hudcaret", "▾")]);
  const body = el("div", "hudbody");
  const score = el("div", "hudscore", "0"), scoreLabel = el("div", "hudlabel", "分数");
  const combo = el("div", "hudcombo"), comboNum = el("b", "", "0"), comboLabel = el("span", "", "连击");
  combo.append(comboNum, comboLabel);
  const acc = el("div", "hudacc"), accNum = el("b", "", "100%"), accLabel = el("span", "", "准确率");
  acc.append(accNum, accLabel);
  const counts = el("div", "hudcounts");
  const kinds: [keyof Stats, string, string][] = [["perfect", "完美", "#ffd60a"], ["good", "不错", "#7dff6b"], ["early", "偏早", "#9ad1ff"], ["late", "偏晚", "#ffb86b"], ["miss", "漏掉", "#ff5a5a"], ["wrong", "错键", "#ff5a5a"]];
  const cnt: Record<string, HTMLElement> = {};
  for (const [k, label, col] of kinds) {
    const n = el("b", "", "0"); n.style.color = col;
    cnt[k] = n;
    counts.append(el("div", "hudcount", "", [el("span", "", label), n]));
  }
  const status = el("div", "hudmidi");
  const statusText = el("span", "hudstatus");
  const connect = el("button", "hudbtn", "连接钢琴");
  connect.onclick = () => o.onConnect();
  const pair = o.onPair ? el("button", "hudbtn", "蓝牙钢琴") : null;
  if (pair) pair.onclick = () => o.onPair!();
  status.append(statusText, connect);
  if (pair) status.append(pair);
  const levelRow = el("div", "hudlevel");
  const levelBtns: Record<Level, HTMLButtonElement> = {
    easy: el("button", "seg", "轻松"), normal: el("button", "seg", "标准"), hard: el("button", "seg", "挑战"),
  };
  (Object.keys(levelBtns) as Level[]).forEach((l) => { levelBtns[l].onclick = () => { o.onLevel(l); setLevel(l); }; levelRow.append(levelBtns[l]); });
  const resultBox = el("div", "hudresult");
  resultBox.hidden = true;
  const stars = el("div", "hudstars"), resScore = el("div", "hudresscore"), retry = el("button", "hudbtn primary", "再来一次");
  retry.onclick = () => { resultBox.hidden = true; o.onRetry(); };
  resultBox.append(el("div", "hudlabel", "完成！"), stars, resScore, retry);
  body.append(scoreLabel, score, combo, acc, counts, levelRow, status, resultBox);
  root.append(head, body);
  head.onclick = () => root.classList.toggle("min");

  function setLevel(l: Level) { (Object.keys(levelBtns) as Level[]).forEach((k) => levelBtns[k].classList.toggle("on", k === l)); }
  setLevel(o.level);

  const popCombo = () => { combo.classList.remove("pop"); void combo.offsetWidth; combo.classList.add("pop"); };
  return {
    el: root,
    reset() { resultBox.hidden = true; this.update({ score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0, total: 0 }, 1); },
    update(s, a) {
      score.textContent = String(s.score);
      comboNum.textContent = String(s.combo);
      accNum.textContent = `${Math.round(a * 100)}%`;
      for (const [k] of kinds) cnt[k].textContent = String(s[k]);
    },
    judged(j) {
      if (j.kind !== "miss" && j.kind !== "wrong" && j.combo > 0 && j.combo % 10 === 0) popCombo();
      score.classList.remove("bump"); void score.offsetWidth; score.classList.add("bump");
    },
    result(s, n, a) {
      stars.textContent = "★".repeat(n) + "☆".repeat(3 - n);
      resScore.textContent = `${s.score}  ·  ${Math.round(a * 100)}%  ·  ${s.maxCombo}x`;
      resultBox.hidden = false;
      root.classList.remove("min");
    },
    midi(s) {
      connect.hidden = s.kind === "ready" || s.kind === "unsupported";
      statusText.textContent = "";
      statusText.replaceChildren(
        s.kind === "ready" ? el("span", "ok", "已连接") : s.kind === "none" ? el("span", "", "未找到钢琴") : s.kind === "unsupported" ? el("span", "", "这个浏览器不能连接钢琴") : s.kind === "denied" ? el("span", "", "没有获得 MIDI 许可") : el("span", "", "未连接钢琴"),
        ...(s.kind === "ready" ? [el("span", "devname", " " + s.devices.join(", "))] : []),
      );
      root.classList.toggle("connected", s.kind === "ready");
    },
    setLevel,
    setHidden(hidden) { root.hidden = hidden; },
    destroy() { root.remove(); },
  };
}
