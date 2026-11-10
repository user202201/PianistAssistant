import type { Player } from "./player";
import type { NoteEvent, ParsedScore } from "./score";
import type { Judgement } from "./gamescore";
import { icon } from "./icons";

/**
 * The game panel: notes fall onto a piano keyboard (the keys to play glow). The whole canvas can lean back into a perspective view (like a
 * real keyboard seen from the player's seat) and back to the flat view; the lean is a CSS 3D transform, so the change is animated.
 * It only reads the clock of the Player (score time), so it follows play / pause / seek / speed / hand choice by itself.
 */
export interface GameView {
  el: HTMLElement;
  setTilt(on: boolean): void;
  /** score mode: nothing is played or lit by itself, the player\'s own keys light up */
  setScoring(on: boolean): void;
  judge(j: Judgement): void;
  /** a long combo: a big banner and rings of light across the lane */
  milestone(combo: number): void;
  press(midi: number, colour: string): void;
  release(midi: number): void;
  destroy(): void;
}

/** how long a note is shown / lit: as WRITTEN (the sounding length includes the pedal, which would keep keys pressed for seconds) */
export const noteLength = (e: NoteEvent) => Math.max(e.dur0, 0.12);

/** game start: after GO the notes fall in for this many seconds before the music begins; before GO everything stands still */
export const GAME_PRE = 2.2;
const WINDOW = 3;
const PULSE = 0.45; // a struck key glows only briefly (a flash that fades): the note's length is shown by the block above, a held key is NOT kept lit // seconds of score shown above the keyboard
const RIGHT = "#19d3ff", LEFT = "#7dff6b";
// neon-tube notes: pale lilac at the edges, melting into a bright core
const EDGE = "#b79cff";
const CORE: Record<string, string> = { [RIGHT]: "#b8f9ff", [LEFT]: "#d3ffb8" };
function neon(ctx: CanvasRenderingContext2D, x: number, w: number, col: string, alpha: string): CanvasGradient {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, EDGE + alpha); g.addColorStop(0.28, col + alpha); g.addColorStop(0.5, (CORE[col] ?? "#ffffff") + alpha); g.addColorStop(0.72, col + alpha); g.addColorStop(1, EDGE + alpha);
  return g;
}

export function createGameView(player: Player, score: ParsedScore, opts: { tilt: boolean; onTilt: (on: boolean) => void; title: (k: "flat" | "tilt") => string; height: () => number; onHeight: (px: number) => void; scoring: boolean; onMode: (scoring: boolean) => void; judgeText: () => boolean }): GameView {
  const canvas = document.createElement("canvas");
  canvas.className = "gcanvas";
  const stage = document.createElement("div");
  stage.className = "gstage";
  const fx = document.createElement("canvas"); // words and banners: drawn upright on top, whatever the angle of the lane
  fx.className = "gfx";
  stage.append(canvas, fx);
  const tiltBtn = document.createElement("button");
  tiltBtn.className = "icon gtilt";
  const el = document.createElement("section");
  el.className = "gamepanel";
  const grip = document.createElement("div");
  grip.className = "ggrip"; grip.setAttribute("role", "separator");
  // demo (the app plays and shows) / score (you play, the app judges)
  let scoring = opts.scoring;
  const modeBtn = (sc: boolean, label: string) => { const b = document.createElement("button"); b.className = "seg"; b.dataset.gmode = sc ? "score" : "demo"; b.textContent = label; b.onclick = () => { if (scoring === sc) return; scoring = sc; syncMode(); opts.onMode(sc); }; return b; };
  const modes = document.createElement("div");
  modes.className = "group gmode";
  const bDemo = modeBtn(false, "演示"), bScore = modeBtn(true, "计分");
  modes.append(bDemo, bScore);
  const syncMode = () => { bDemo.classList.toggle("on", !scoring); bScore.classList.toggle("on", scoring); el.classList.toggle("scoring", scoring); };
  const topLeft = document.createElement("div");
  topLeft.className = "gtopleft";
  topLeft.append(modes);
  el.append(stage, tiltBtn, topLeft, grip);
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

  let tilt = opts.tilt, raf = 0, W = 0, H = 0, Hp = 0, persp = 600, dead = false;
  setTimeout(() => syncMode(), 0);
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
    W = Math.max(1, Math.round(r.width)); Hp = Math.max(1, Math.round(r.height));
    // The drawing is several times as tall as the panel: flat, only its lower part shows; leaned back (CSS 3D) the far end of the lane reaches the top
    // of the panel, so the notes come down from the very top instead of the picture just being folded.
    const K = Math.max(1, Math.min(3.2, 900 / Hp));
    H = Math.round(Hp * K);
    canvas.style.height = `${H}px`;
    let lo2 = 20, hi2 = 65; // the angle at which the far end projects exactly to the top: K * (2.5 cos t - sin t) = 2.5 (perspective = 2.5 panel heights)
    for (let i = 0; i < 30; i++) { const m = (lo2 + hi2) / 2, rad = (m * Math.PI) / 180; if (K * (2.5 * Math.cos(rad) - Math.sin(rad)) > 2.5) lo2 = m; else hi2 = m; }
    el.style.setProperty("--persp", `${Math.round(Hp * 2.5)}px`);
    el.style.setProperty("--tiltdeg", `${((lo2 + hi2) / 2).toFixed(1)}deg`);
    persp = Hp * 2.5;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.width = Math.round(W * dpr); fx.height = Math.round(Hp * dpr);
    fx.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  const pressed = new Map<number, string>(); // keys the player holds (score mode)
  const popups: { x: number; text: string; col: string; t: number; life: number; lift: number; liftTo: number }[] = [];
  const banners: { text: string; col: string; t: number }[] = [];
  let geo = { ww: 20, top: 100 };
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
    // before the start (and while stopped at the beginning) the lane is EMPTY: the notes are still above the picture; keys light up only while playing
    const playing = player.playing;
    let t = player.position();
    const kh0 = Math.min(Hp * 0.56, 112), pxPerSec = Math.max(20, (Hp - kh0) / WINDOW), winT = Math.min((H - kh0) / pxPerSec, 9);
    if (!playing && t <= 0.001) t = -winT - 1;
    else if (playing && t < -GAME_PRE * player.speed - 0.02) t = -winT - 1; // READY ... GO: still empty, nothing moves yet
    const ww = W / whites.length, kh = kh0, top = H - kh;
    // octave guide lines
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(25,211,255,.13)";
    for (const m of whites) if (m % 12 === 0 || m % 12 === 5) { const x = (whiteIndex.get(m) ?? 0) * ww; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, top); ctx.stroke(); }
    // find the first event that could still be visible
    let a = 0, b = events.length;
    while (a < b) { const mid = (a + b) >> 1; if (events[mid].sec < t - 12) a = mid + 1; else b = mid; }
    const ring = new Map<number, { col: string; u: number }>(); // keys that still RING after the strike (sustain): shown pale, fading out
    const active = new Map<number, string>(); const age = new Map<number, number>(); // age: seconds since the key was struck
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    for (let i = a; i < events.length && events[i].sec <= t + winT; i++) {
      const e = events[i];
      if (e.midi < lo || e.midi > hi || !player.isShown(e)) continue;
      const end = e.sec + noteLength(e);
      const ringEnd = e.sec + Math.max(e.dur, noteLength(e)); // how long it SOUNDS (pedal included)
      if (t - e.sec >= PULSE && t < ringEnd) {
        const u = 0.34 * (1 - (t - e.sec) / (ringEnd - e.sec));
        if (u > (ring.get(e.midi)?.u ?? 0)) ring.set(e.midi, { col: colour(e), u });
      }
      if (end < t) continue;
      const k = keyBox(e.midi, ww, kh);
      const y1 = top - (e.sec - t) * pxPerSec; // bottom edge (start of the note)
      const y0 = Math.max(-20, top - (end - t) * pxPerSec);
      const yb = Math.min(y1, top);
      if (yb - y0 < 1) { if (e.sec <= t && t < end && t - e.sec < PULSE) { active.set(e.midi, colour(e)); age.set(e.midi, Math.min(age.get(e.midi) ?? 99, t - e.sec)); } continue; }
      const col = colour(e);
      const x = k.x + (k.black ? 1 : 2), w = k.w - (k.black ? 2 : 4);
      const rr = (yy: number, hh: number, r2: number) => { ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(x, yy, w, Math.max(2, hh), r2) : ctx.rect(x, yy, w, Math.max(2, hh)); ctx.fill(); };
      const long = yb - y0 > 30; // a held note: a see-through body shows how long, a bright head at its START shows when to press
      ctx.shadowColor = col; ctx.shadowBlur = long ? 8 : 14;
      if (long) { ctx.fillStyle = neon(ctx, x, w, col, "44"); rr(y0, yb - y0, Math.min(8, w / 2)); }
      const headH = long ? Math.min(22, yb - y0) : yb - y0;
      ctx.shadowBlur = 16; ctx.fillStyle = neon(ctx, x, w, col, ""); rr(yb - headH, headH, Math.min(8, w / 2, headH / 2));
      ctx.shadowBlur = 0;
      if (e.sec <= t && t < end && t - e.sec < PULSE) { active.set(e.midi, col); age.set(e.midi, Math.min(age.get(e.midi) ?? 99, t - e.sec)); }
    }
    if (!playing || scoring) { active.clear(); ring.clear(); }
    geo = { ww, top };
    // the keyboard
    ctx.shadowBlur = 0;
    const draws = (black: boolean) => {
      for (let m = lo; m <= hi; m++) {
        if (isBlack(m) !== black) continue;
        const k = keyBox(m, ww, kh); const on = active.get(m);
        const h = black ? kh * 0.62 : kh;
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        if (black) { g.addColorStop(0, "#1a2340"); g.addColorStop(1, "#05070f"); } else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#c9d6ee"); }
        ctx.fillStyle = g;
        const path = () => { ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(k.x + 0.5, top, k.w - 1, h, [0, 0, 5, 5]) : ctx.rect(k.x + 0.5, top, k.w - 1, h); ctx.fill(); };
        path();
        const rg = ring.get(m);
        if (rg && !on) { ctx.globalAlpha = rg.u; ctx.fillStyle = rg.col; path(); ctx.globalAlpha = 1; } // the sound still rings: pale, and gone when it has died away
        const pr = pressed.get(m);
        if (pr) { ctx.globalAlpha = 0.92; ctx.shadowColor = pr; ctx.shadowBlur = 26; const pg = ctx.createLinearGradient(0, top, 0, top + h); pg.addColorStop(0, pr); pg.addColorStop(1, pr + "aa"); ctx.fillStyle = pg; path(); ctx.globalAlpha = 1; ctx.shadowBlur = 0; }
        if (on) { // the strike flash: full colour first, fading out within PULSE seconds
          const u = Math.max(0, 1 - (age.get(m) ?? 0) / PULSE);
          ctx.globalAlpha = u; ctx.shadowColor = on; ctx.shadowBlur = 30 * u;
          const gg = ctx.createLinearGradient(0, top, 0, top + h); gg.addColorStop(0, on); gg.addColorStop(1, on + "99"); ctx.fillStyle = gg; path();
          ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        }
      }
    };
    draws(false); draws(true);
    // effects
    ctx.globalCompositeOperation = "lighter";
    for (const [m, col] of active) {
      const k = keyBox(m, ww, kh), cx = k.x + k.w / 2;
      const g = ctx.createLinearGradient(0, top - 110, 0, top); g.addColorStop(0, col + "00"); g.addColorStop(1, col + "88"); // the beam above the key
      ctx.globalAlpha = Math.max(0, 1 - (age.get(m) ?? 0) / PULSE); ctx.fillStyle = g; ctx.fillRect(k.x + k.w * 0.2, top - 110, k.w * 0.6, 110); ctx.globalAlpha = 1;
      if (playing) {
        if (!prevActive.has(m)) { emit(cx, top, col, 3); flares.push({ x: cx, y: top, t: 0, col, w: Math.max(ww * 2.2, 36) }); }
        else if (Math.random() < 0.1) emit(cx, top, col, 1);
      }
    }
    prevActive = active;
    for (let i = flares.length - 1; i >= 0; i--) { // the flare: a ring of light that opens and fades
      const f = flares[i]; f.t += dt; const u = f.t / 0.38; if (u >= 1) { flares.splice(i, 1); continue; } if (u < 0) continue;
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
    // words and banners go on a second canvas that is never tilted: the lane's point is projected to where it appears on the screen
    const fctx = fx.getContext("2d")!;
    fctx.clearRect(0, 0, W, Hp);
    let mtx: DOMMatrix;
    try { mtx = new DOMMatrix(getComputedStyle(canvas).transform); } catch { mtx = new DOMMatrix(); }
    const project = (x: number, y: number) => { const q = mtx.transformPoint(new DOMPoint(x - W / 2, y - H, 0, 1)); const sc = persp / (persp - q.z); return { x: W / 2 + q.x * sc, y: Hp + q.y * sc }; };
    for (let i = popups.length - 1; i >= 0; i--) { // judgement words rise from the key and fade (a Miss goes quickly)
      const p = popups[i]; p.t += dt; const u = p.t / p.life; if (u >= 1) { popups.splice(i, 1); continue; }
      const q = project(Math.max(30, Math.min(W - 30, p.x)), top - 14 - u * 40 + Math.max(0, 1 - p.t / 0.12) * 8);
      fctx.save(); fctx.globalAlpha = Math.min(1, (1 - u) * 1.6); fctx.font = `800 ${Math.round(12 + (1 - u) * 3)}px system-ui, sans-serif`; fctx.textAlign = "center"; fctx.shadowColor = p.col; fctx.shadowBlur = 10; fctx.fillStyle = p.col;
      fctx.fillText(p.text, q.x, q.y); fctx.restore();
    }
    for (let i = banners.length - 1; i >= 0; i--) { // the big combo banner in the middle of the panel
      const b = banners[i]; b.t += dt; const u = b.t / 1.3; if (u >= 1) { banners.splice(i, 1); continue; }
      const grow = u < 0.18 ? 0.5 + (u / 0.18) * 0.7 : 1.2 - (u - 0.18) * 0.25;
      fctx.save(); fctx.globalAlpha = u < 0.7 ? 1 : (1 - u) / 0.3; fctx.translate(W / 2, Hp * 0.4); fctx.scale(grow, grow);
      fctx.font = `900 ${Math.round(Math.min(64, Math.max(30, W / 9)))}px "Arial Black", Impact, system-ui, sans-serif`; fctx.textAlign = "center"; fctx.textBaseline = "middle";
      fctx.shadowColor = b.col; fctx.shadowBlur = 30; fctx.lineWidth = 3; fctx.strokeStyle = "#fff"; fctx.strokeText(b.text, 0, 0); fctx.fillStyle = b.col; fctx.fillText(b.text, 0, 0); fctx.restore();
    }
    el.dataset.banners = String(banners.length); el.dataset.popups = String(popups.length); el.dataset.sparks = String(sparks.length); el.dataset.lit = [...active.keys()].join(","); el.dataset.ring = [...ring.keys()].join(",");
    // glowing hit line
    ctx.fillStyle = "rgba(25,211,255,.9)"; ctx.shadowColor = RIGHT; ctx.shadowBlur = 16; ctx.fillRect(0, top - 2, W, 2); ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return {
    el,
    setTilt(on) { tilt = on; apply(); },
    setScoring(on) { scoring = on; syncMode(); if (on) pressed.clear(); },
    judge(j) {
      const k = keyBox(j.midi, geo.ww, 0), cx = k.x + k.w / 2;
      const look: Record<string, [string, string]> = { perfect: ["PERFECT", "#ffd60a"], good: ["GOOD", "#7dff6b"], early: ["EARLY", "#9ad1ff"], late: ["LATE", "#ffb86b"], miss: ["MISS", "#ff5a5a"], wrong: ["×", "#ff5a5a"] };
      const [text, col] = look[j.kind];
      if (opts.judgeText()) for (const q of popups) q.t = Math.max(q.t, q.life * 0.85); // a new word: the older ones fade out at once (one word at a time, never on top of each other)
      if (opts.judgeText()) popups.push({ x: cx, text, col, t: 0, lift: 0, liftTo: 0, life: j.kind === "miss" || j.kind === "wrong" ? 0.5 : 0.9 });
      if (j.kind !== "miss" && j.kind !== "wrong") { flares.push({ x: cx, y: geo.top, t: 0, col, w: Math.max(geo.ww * 2.4, 40) }); emit(cx, geo.top, col, j.kind === "perfect" ? 3 : 2); }
    },
    milestone(n) {
      const col = n >= 100 ? "#ff4fd8" : n >= 50 ? "#ffd60a" : n >= 25 ? "#7dff6b" : "#19d3ff";
      banners.push({ text: `${n} COMBO!`, col, t: 0 });
      for (let i = 1; i <= 4; i++) flares.push({ x: (W * i) / 5, y: geo.top, t: -0.05 * i, col, w: Math.max(W / 4, 80) }); // rings of light across the lane
    },
    press(m, col) { pressed.set(m, col); },
    release(m) { pressed.delete(m); },
    destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", applyH); el.remove(); },
  };
}
