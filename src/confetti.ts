/** A short burst of confetti over everything (used once, when the hidden game mode is unlocked for the first time). */
export function confetti(host: HTMLElement) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  host.append(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const cols = ["#19d3ff", "#7dff6b", "#ffd60a", "#ff5ea8", "#b47cff", "#ffffff"];
  const bits = Array.from({ length: 110 }, () => ({
    x: W * (0.2 + Math.random() * 0.6), y: H * 0.35 + (Math.random() - 0.5) * 40,
    vx: (Math.random() - 0.5) * 520, vy: -260 - Math.random() * 420,
    w: 5 + Math.random() * 7, h: 3 + Math.random() * 5, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 14, col: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const life = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 620 * dt; b.vx *= 1 - 0.9 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, 2.6 - life)); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.col; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (life < 2.6 && c.isConnected) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
