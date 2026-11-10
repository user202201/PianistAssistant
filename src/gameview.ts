import type { Player } from "./player";
import type { NoteEvent, ParsedScore } from "./score";
import { icon } from "./icons";

/**
 * The game panel: notes fall onto a piano keyboard (the keys to play glow). The whole canvas can lean back into a perspective view (like a
 * real keyboard seen from the player's seat) and back to the flat view; the lean is a CSS 3D transform, so the change is animated.
 * It only reads the clock of the Player (score time), so it follows play / pause / seek / speed / hand choice by itself.
 */
export interface GameView {
  el: HTMLElement;
  setTilt(on: boolean): void;
  destroy(): void;
}

const WINDOW = 3; // seconds of score shown above the keyboard
const RIGHT = "#19d3ff", LEFT = "#7dff6b";

export function createGameView(player: Player, score: ParsedScore, opts: { tilt: boolean; onTilt: (on: boolean) => void; title: (k: "flat" | "tilt") => string }): GameView {
  const canvas = document.createElement("canvas");
  canvas.className = "gcanvas";
  const stage = document.createElement("div");
  stage.className = "gstage";
  stage.append(canvas);
  const tiltBtn = document.createElement("button");
  tiltBtn.className = "icon gtilt";
  const el = document.createElement("section");
  el.className = "gamepanel";
  el.append(stage, tiltBtn);

  const events = [...score.events].sort((a, b) => a.sec - b.sec);
  let lo = 60, hi = 72;
  if (events.length) { lo = Math.min(...events.map((e) => e.midi)); hi = Math.max(...events.map((e) => e.midi)); }
  // whole octaves C … B around the notes, at least two octaves
  lo = Math.floor((lo - 1) / 12) * 12; hi = Math.ceil((hi + 2) / 12) * 12 - 1;
  while (hi - lo < 23) { if (lo > 24) lo -= 12; else hi += 12; }
  const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const whiteIndex = new Map(whites.map((m, i) => [m, i]));

  let tilt = opts.tilt, raf = 0, W = 0, H = 0, dead = false;
  const apply = () => {
    el.classList.toggle("tilt", tilt);
    tiltBtn.replaceChildren(icon(tilt ? "keys-tilt" : "keys-flat", 22));
    tiltBtn.title = opts.title(tilt ? "flat" : "tilt");
    tiltBtn.setAttribute("aria-label", tiltBtn.title);
  };
  apply();
  tiltBtn.onclick = () => { tilt = !tilt; apply(); opts.onTilt(tilt); };

  const resize = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  function keyBox(m: number, ww: number, kh: number): { x: number; w: number; black: boolean } {
    if (!isBlack(m)) return { x: (whiteIndex.get(m) ?? 0) * ww, w: ww, black: false };
    const prev = whiteIndex.get(m - 1) ?? 0; // the white key below
    const bw = ww * 0.62;
    return { x: (prev + 1) * ww - bw / 2, w: bw, black: true };
  }
  const colour = (e: NoteEvent) => (e.staff % 2 === 0 ? RIGHT : LEFT);

  function draw() {
    if (dead) return;
    if (!el.isConnected) { raf = requestAnimationFrame(draw); return; }
    if (!W || !H) resize();
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const t = player.position();
    const ww = W / whites.length, kh = Math.min(H * 0.3, 120), top = H - kh;
    // octave guide lines
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(25,211,255,.13)";
    for (const m of whites) if (m % 12 === 0 || m % 12 === 5) { const x = (whiteIndex.get(m) ?? 0) * ww; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, top); ctx.stroke(); }
    // find the first event that could still be visible
    let a = 0, b = events.length;
    while (a < b) { const mid = (a + b) >> 1; if (events[mid].sec < t - 6) a = mid + 1; else b = mid; }
    const active = new Map<number, string>();
    for (let i = a; i < events.length && events[i].sec <= t + WINDOW; i++) {
      const e = events[i];
      if (e.midi < lo || e.midi > hi || !player.isAudible(e)) continue;
      const end = e.sec + Math.max(e.dur, 0.12);
      if (end < t) continue;
      const k = keyBox(e.midi, ww, kh);
      const y1 = top - ((e.sec - t) / WINDOW) * top; // bottom edge (start of the note)
      const y0 = Math.max(-20, top - ((end - t) / WINDOW) * top);
      const yb = Math.min(y1, top);
      if (yb - y0 < 1) { if (e.sec <= t && t < end) active.set(e.midi, colour(e)); continue; }
      const col = colour(e);
      const x = k.x + (k.black ? 1 : 2), w = k.w - (k.black ? 2 : 4);
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      const g = ctx.createLinearGradient(0, y0, 0, yb); g.addColorStop(0, col + "55"); g.addColorStop(1, col);
      ctx.fillStyle = g;
      const r = Math.min(8, w / 2, (yb - y0) / 2);
      ctx.beginPath(); (ctx as CanvasRenderingContext2D & { roundRect?: (...a: number[]) => void }).roundRect ? (ctx as any).roundRect(x, y0, w, Math.max(2, yb - y0), r) : ctx.rect(x, y0, w, Math.max(2, yb - y0)); ctx.fill();
      ctx.shadowBlur = 0;
      if (e.sec <= t && t < end) active.set(e.midi, col);
    }
    // the keyboard
    ctx.shadowBlur = 0;
    const draws = (black: boolean) => {
      for (let m = lo; m <= hi; m++) {
        if (isBlack(m) !== black) continue;
        const k = keyBox(m, ww, kh); const on = active.get(m);
        const h = black ? kh * 0.62 : kh;
        if (on) { ctx.shadowColor = on; ctx.shadowBlur = 26; }
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        if (on) { g.addColorStop(0, on); g.addColorStop(1, on + "99"); }
        else if (black) { g.addColorStop(0, "#1a2340"); g.addColorStop(1, "#05070f"); }
        else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#c9d6ee"); }
        ctx.fillStyle = g;
        ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(k.x + 0.5, top, k.w - 1, h, [0, 0, 5, 5]) : ctx.rect(k.x + 0.5, top, k.w - 1, h); ctx.fill();
        ctx.shadowBlur = 0;
      }
    };
    draws(false); draws(true);
    // glowing hit line
    ctx.fillStyle = "rgba(25,211,255,.9)"; ctx.shadowColor = RIGHT; ctx.shadowBlur = 16; ctx.fillRect(0, top - 2, W, 2); ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return {
    el,
    setTilt(on) { tilt = on; apply(); },
    destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); el.remove(); },
  };
}
