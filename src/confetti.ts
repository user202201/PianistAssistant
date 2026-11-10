/**
 * The unlock celebration of the hidden game mode (first time only): a neon "level up" burst from the middle of the message: two shock-wave rings,
 * rays of light, and glowing music notes, stars and pixel squares that fly out and drift down, leaving short light trails.
 */
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
  const r = host.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cols = ["#19d3ff", "#7dff6b", "#ff4fd8", "#ffe14a", "#9a7bff", "#ffffff"];
  const glyphs = ["♪", "♫", "♩", "★", "✦", "♪", "♫"];
  const bits = Array.from({ length: 70 }, () => {
    const a = Math.random() * Math.PI * 2, sp = 140 + Math.random() * 520;
    return { x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, size: 14 + Math.random() * 20, a: (Math.random() - 0.5) * 0.8, va: (Math.random() - 0.5) * 5, col: cols[(Math.random() * cols.length) | 0], g: glyphs[(Math.random() * glyphs.length) | 0] };
  });
  const rays = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + Math.random() * 0.2, len: 180 + Math.random() * 260, col: cols[i % 4] }));
  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const life = (now - t0) / 1000;
    // trails: instead of clearing, fade what was drawn
    ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    // shock-wave rings
    for (const [delay, col] of [[0, "#19d3ff"], [0.16, "#7dff6b"]] as [number, string][]) {
      const u = (life - delay) / 0.9; if (u < 0 || u > 1) continue;
      ctx.globalAlpha = (1 - u) * 0.9; ctx.strokeStyle = col; ctx.lineWidth = 5 * (1 - u) + 1; ctx.shadowColor = col; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.arc(cx, cy, 30 + u * Math.max(W, H) * 0.42, 0, Math.PI * 2); ctx.stroke();
    }
    // rays of light
    if (life < 0.7) for (const ry of rays) {
      const u = life / 0.7; ctx.globalAlpha = (1 - u) * 0.8; ctx.strokeStyle = ry.col; ctx.lineWidth = 2; ctx.shadowColor = ry.col; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ry.a) * (40 + u * 120), cy + Math.sin(ry.a) * (40 + u * 120)); ctx.lineTo(cx + Math.cos(ry.a) * (40 + u * 120 + ry.len * (1 - u * 0.4)), cy + Math.sin(ry.a) * (40 + u * 120 + ry.len * (1 - u * 0.4))); ctx.stroke();
    }
    // notes, stars, squares
    ctx.shadowBlur = 16; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const b of bits) {
      b.vy += 260 * dt; b.vx *= 1 - 1.1 * dt; b.vy *= 1 - 0.5 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, 2.9 - life)); ctx.fillStyle = b.col; ctx.shadowColor = b.col;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.font = `${b.size}px system-ui, sans-serif`; ctx.fillText(b.g, 0, 0); ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.globalCompositeOperation = "source-over";
    if (life < 2.9 && c.isConnected) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
