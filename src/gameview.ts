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

/** how long a note is shown / lit: as WRITTEN (the sounding length includes the pedal, which would keep keys pressed for seconds) */
export const noteLength = (e: NoteEvent) => Math.max(e.dur0, 0.12);

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

  // smoke and light: when a key is struck a flare opens and a few soft puffs of light drift up from it (no hard particles: they would hide the keys behind);
  // a held key keeps a thin trickle of puffs and a soft beam stands above a sounding key
  interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; col: string }
  const sparks: Puff[] = []; // (the puffs)
  const flares: { x: number; y: number; t: number; col: string; w: number }[] = [];
  let prevActive = new Map<number, string>(), last = 0;
  const emit = (x: number, y: number, col: string, n: number) => {
    for (let i = 0; i < n && sparks.length < 60; i++) sparks.push({ x: x + (Math.random() - 0.5) * 12, y: y - 4, vx: (Math.random() - 0.5) * 22, vy: -(22 + Math.random() * 34), life: 0, max: 0.9 + Math.random() * 0.7, r: 12 + Math.random() * 16, col });
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
    const active = new Map<number, string>(); const age = new Map<number, number>(); // age: seconds since the key was struck
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    for (let i = a; i < events.length && events[i].sec <= t + WINDOW; i++) {
      const e = events[i];
      if (e.midi < lo || e.midi > hi || !player.isShown(e)) continue;
      const end = e.sec + noteLength(e);
      if (end < t) continue;
      const k = keyBox(e.midi, ww, kh);
      const y1 = top - ((e.sec - t) / WINDOW) * top; // bottom edge (start of the note)
      const y0 = Math.max(-20, top - ((end - t) / WINDOW) * top);
      const yb = Math.min(y1, top);
      if (yb - y0 < 1) { if (e.sec <= t && t < end) { active.set(e.midi, colour(e)); age.set(e.midi, Math.min(age.get(e.midi) ?? 99, t - e.sec)); } continue; }
      const col = colour(e);
      const x = k.x + (k.black ? 1 : 2), w = k.w - (k.black ? 2 : 4);
      const rr = (yy: number, hh: number, r2: number) => { ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(x, yy, w, Math.max(2, hh), r2) : ctx.rect(x, yy, w, Math.max(2, hh)); ctx.fill(); };
      const long = yb - y0 > 30; // a held note: a see-through body shows how long, a bright head at its START shows when to press
      ctx.shadowColor = col; ctx.shadowBlur = long ? 8 : 14;
      if (long) { const g = ctx.createLinearGradient(0, y0, 0, yb); g.addColorStop(0, col + "22"); g.addColorStop(1, col + "66"); ctx.fillStyle = g; rr(y0, yb - y0, Math.min(8, w / 2)); }
      const headH = long ? Math.min(22, yb - y0) : yb - y0;
      ctx.shadowBlur = 16; ctx.fillStyle = col; rr(yb - headH, headH, Math.min(8, w / 2, headH / 2));
      ctx.shadowBlur = 0;
      if (e.sec <= t && t < end) { active.set(e.midi, col); age.set(e.midi, Math.min(age.get(e.midi) ?? 99, t - e.sec)); }
    }
    // the keyboard
    ctx.shadowBlur = 0;
    const draws = (black: boolean) => {
      for (let m = lo; m <= hi; m++) {
        if (isBlack(m) !== black) continue;
        const k = keyBox(m, ww, kh); const on = active.get(m);
        const h = black ? kh * 0.62 : kh;
        if (on) { ctx.shadowColor = on; ctx.shadowBlur = (age.get(m) ?? 0) < 0.2 ? 28 : 12; }
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        if (on) { const fresh = (age.get(m) ?? 0) < 0.2; g.addColorStop(0, fresh ? on : on + "cc"); g.addColorStop(1, fresh ? on + "99" : on + "55"); }
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
        if (!prevActive.has(m)) { emit(cx, top, col, 3); flares.push({ x: cx, y: top, t: 0, col, w: Math.max(ww * 2.2, 36) }); }
        else if (Math.random() < 0.1) emit(cx, top, col, 1);
      }
    }
    prevActive = active;
    for (let i = flares.length - 1; i >= 0; i--) { // the flare: a ring of light that opens and fades
      const f = flares[i]; f.t += dt; const u = f.t / 0.38; if (u >= 1) { flares.splice(i, 1); continue; }
      const r = f.w * (0.3 + u * 0.9), g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, f.col + Math.round((1 - u) * 170).toString(16).padStart(2, "0")); g.addColorStop(1, f.col + "00");
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
    }
    for (let i = sparks.length - 1; i >= 0; i--) { // a puff: a soft round glow that rises slowly, grows and fades
      const p = sparks[i]; p.life += dt; if (p.life >= p.max) { sparks.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const u = p.life / p.max, r = p.r * (1 + u * 1.2), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, p.col + Math.round((1 - u) * 70).toString(16).padStart(2, "0")); g.addColorStop(1, p.col + "00");
      ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
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
