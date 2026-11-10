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

export function createGameView(player: Player, score: ParsedScore, opts: { tilt: boolean; onTilt: (on: boolean) => void; title: (k: "flat" | "tilt") => string; height: () => number; onHeight: (px: number) => void }): GameView {
  const canvas = document.createElement("canvas");
  canvas.className = "gcanvas";
  const stage = document.createElement("div");
  stage.className = "gstage";
  stage.append(canvas);
  const tiltBtn = document.createElement("button");
  tiltBtn.className = "icon gtilt";
  const el = document.createElement("section");
  el.className = "gamepanel";
  const grip = document.createElement("div");
  grip.className = "ggrip"; grip.setAttribute("role", "separator");
  el.append(stage, tiltBtn, grip);
  // The panel height: default a little more than the keyboard; the user drags the top edge. Never lower than the keyboard plus a strip of the coming notes.
  const MINH = 150;
  const maxH = () => Math.max(MINH, Math.round(window.innerHeight * 0.6));
  const defH = () => Math.max(MINH, Math.min(250, Math.round(window.innerHeight * 0.3)));
  const setH = (px: number) => { el.style.height = `${Math.max(MINH, Math.min(maxH(), Math.round(px)))}px`; };
  const applyH = () => setH(opts.height() || defH());
  applyH();
  window.addEventListener("resize", applyH);
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = el.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => setH(h0 + (y0 - ev.clientY));
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); opts.onHeight(Math.round(el.getBoundingClientRect().height)); };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });

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

  // sparks: when a key is struck a flare and a burst of sparks fly up from it; a held key keeps trickling a few; a soft beam stands above a sounding key
  interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; col: string }
  const sparks: Spark[] = [];
  const flares: { x: number; y: number; t: number; col: string; w: number }[] = [];
  let prevActive = new Map<number, string>(), last = 0;
  const emit = (x: number, y: number, col: string, n: number, spread = 1) => {
    for (let i = 0; i < n && sparks.length < 500; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2 * spread, sp = 50 + Math.random() * 190;
      sparks.push({ x: x + (Math.random() - 0.5) * 10, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.45 + Math.random() * 0.7, size: 1.2 + Math.random() * 2.6, col });
    }
  };
  function draw(now = 0) {
    if (dead) return;
    if (!el.isConnected) { raf = requestAnimationFrame(draw); return; }
    if (!W || !H) resize();
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const t = player.position();
    const ww = W / whites.length, kh = Math.min(H * 0.56, 112), top = H - kh;
    // octave guide lines
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(25,211,255,.13)";
    for (const m of whites) if (m % 12 === 0 || m % 12 === 5) { const x = (whiteIndex.get(m) ?? 0) * ww; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, top); ctx.stroke(); }
    // find the first event that could still be visible
    let a = 0, b = events.length;
    while (a < b) { const mid = (a + b) >> 1; if (events[mid].sec < t - 6) a = mid + 1; else b = mid; }
    const active = new Map<number, string>();
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
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
    // effects
    const playing = player.playing;
    ctx.globalCompositeOperation = "lighter";
    for (const [m, col] of active) {
      const k = keyBox(m, ww, kh), cx = k.x + k.w / 2;
      const g = ctx.createLinearGradient(0, top - 110, 0, top); g.addColorStop(0, col + "00"); g.addColorStop(1, col + "88"); // the beam above the key
      ctx.fillStyle = g; ctx.fillRect(k.x + k.w * 0.2, top - 110, k.w * 0.6, 110);
      if (playing) {
        if (!prevActive.has(m)) { emit(cx, top, col, 16); flares.push({ x: cx, y: top, t: 0, col, w: Math.max(ww * 2.2, 36) }); }
        else if (Math.random() < 0.45) emit(cx, top, col, 1, 0.6);
      }
    }
    prevActive = active;
    for (let i = flares.length - 1; i >= 0; i--) { // the flare: a ring of light that opens and fades
      const f = flares[i]; f.t += dt; const u = f.t / 0.38; if (u >= 1) { flares.splice(i, 1); continue; }
      const r = f.w * (0.3 + u * 0.9), g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, f.col + Math.round((1 - u) * 170).toString(16).padStart(2, "0")); g.addColorStop(1, f.col + "00");
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]; p.life += dt; if (p.life >= p.max) { sparks.splice(i, 1); continue; }
      p.vy += 140 * dt; p.vx *= 1 - 0.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const u = 1 - p.life / p.max; ctx.globalAlpha = u; ctx.fillStyle = p.col; ctx.shadowColor = p.col; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + u * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.globalCompositeOperation = "source-over";
    el.dataset.sparks = String(sparks.length);
    // glowing hit line
    ctx.fillStyle = "rgba(25,211,255,.9)"; ctx.shadowColor = RIGHT; ctx.shadowBlur = 16; ctx.fillRect(0, top - 2, W, 2); ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return {
    el,
    setTilt(on) { tilt = on; apply(); },
    destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", applyH); el.remove(); },
  };
}
