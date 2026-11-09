/**
 * Handwritten annotations on PDF pages (Apple Pencil, mouse, optionally a finger).
 *
 * Every page has a transparent canvas over the page. Strokes are stored relative to the page (x: 0..1 of its width, y: 0..1 of its height,
 * pen width as a fraction of the page width), so they stay where they were drawn at every zoom / window size / device.
 * No library: a stroke is just a list of points drawn as smooth curves; pressure of the Pencil changes the width.
 */
export interface Stroke {
  /** pen, or highlighter (wide, see-through) */
  k: "pen" | "hl";
  c: string;
  /** width as a fraction of the page width */
  w: number;
  /** x, y, pressure triples */
  p: number[];
}
export interface NotesData {
  version: 1;
  pages: Record<string, Stroke[]>;
  /** automatic page turn: seconds to stay on each page (page number -> seconds); pages without an entry use the default */
  turn?: Record<string, number>;
}
export type Tool = "pen" | "hl" | "eraser";
export const PEN_COLORS = ["#1a1a1a", "#e53935", "#1e66f5"];
export const HL_COLOR = "#ffd60a";
/** thin / medium / thick, as a fraction of the page width */
export const SIZES = [0.0016, 0.0032, 0.0065];
const HL_FACTOR = 6;
const ERASE_RADIUS = 0.014;

type Op =
  | { t: "add"; page: number; stroke: Stroke }
  | { t: "del"; page: number; items: { i: number; stroke: Stroke }[] }
  | { t: "clear"; page: number; strokes: Stroke[] };

export function parseNotes(text: string | null): NotesData {
  try {
    const j = JSON.parse(text ?? "") as NotesData;
    if (j && j.version === 1 && j.pages && typeof j.pages === "object") return j;
  } catch { /* none yet */ }
  return { version: 1, pages: {} };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, W: number, H: number) {
  const n = s.p.length / 3;
  if (n === 0) return;
  const px = (i: number) => s.p[i * 3] * W;
  const py = (i: number) => s.p[i * 3 + 1] * H;
  const pr = (i: number) => s.p[i * 3 + 2];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  if (s.k === "hl") {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineWidth = s.w * W * HL_FACTOR;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
    if (n > 1) ctx.lineTo(px(n - 1), py(n - 1));
    ctx.stroke();
  } else if (n === 1) {
    ctx.beginPath();
    ctx.arc(px(0), py(0), (s.w * W * (0.5 + pr(0))) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // smooth curve through the midpoints; the width follows the pressure of the pen
    let mx = px(0), my = py(0);
    for (let i = 1; i < n; i++) {
      const nx = i === n - 1 ? px(i) : (px(i) + px(i + 1)) / 2;
      const ny = i === n - 1 ? py(i) : (py(i) + py(i + 1)) / 2;
      ctx.lineWidth = s.w * W * (0.5 + pr(i));
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo(px(i), py(i), nx, ny);
      ctx.stroke();
      mx = nx;
      my = ny;
    }
  }
  ctx.restore();
}

/** All annotations of one PDF + the pen settings; the page layers draw and edit through it. */
export class NoteBook {
  data: NotesData;
  tool: Tool = "pen";
  colorIdx = 0;
  sizeIdx = 1;
  /** annotate mode: the pages react to the pen */
  enabled = false;
  /** a finger draws as well (otherwise only Pencil / mouse) */
  fingerDraw = false;
  /** something changed since the last save */
  dirty = false;
  /** called after every change of the strokes (save soon, update buttons) */
  onChange: () => void = () => {};
  /** the Apple Pencil touched a page while annotate mode was off: switch it on (like forScore's "enter annotation mode automatically") */
  onPencil: () => void = () => {};
  /** called while a stroke is being drawn / when it ends (an automatic page turn waits for it) */
  onBusy: (busy: boolean) => void = () => {};
  private layers = new Map<number, PageLayer>();
  private ops: Op[] = [];

  constructor(data: NotesData) {
    this.data = data;
  }

  strokes(page: number): Stroke[] {
    return (this.data.pages[String(page)] ??= []);
  }
  get count(): number {
    return Object.values(this.data.pages).reduce((n, a) => n + a.length, 0);
  }
  get canUndo() {
    return this.ops.length > 0;
  }
  serialize(): string {
    const pages: Record<string, Stroke[]> = {};
    for (const [k, v] of Object.entries(this.data.pages)) if (v.length) pages[k] = v;
    const out: NotesData = { version: 1, pages };
    if (this.data.turn && Object.keys(this.data.turn).length) out.turn = this.data.turn;
    return JSON.stringify(out);
  }

  attach(page: number, canvas: HTMLCanvasElement): PageLayer {
    const l = new PageLayer(this, page, canvas);
    this.layers.set(page, l);
    l.redraw();
    return l;
  }
  /** keeps the Pencil from scrolling the page (it writes; a finger still scrolls) */
  guardScroll(el: HTMLElement) {
    const stop = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if ((t as Touch & { touchType?: string }).touchType === "stylus" && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchstart", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
  }

  changed() {
    this.dirty = true;
    this.onChange();
  }
  push(op: Op) {
    this.ops.push(op);
    if (this.ops.length > 200) this.ops.shift();
  }
  undo(): boolean {
    const op = this.ops.pop();
    if (!op) return false;
    const list = this.strokes(op.page);
    if (op.t === "add") {
      const i = list.indexOf(op.stroke);
      if (i >= 0) list.splice(i, 1);
    } else if (op.t === "del") {
      for (const it of [...op.items].sort((a, b) => a.i - b.i)) list.splice(Math.min(it.i, list.length), 0, it.stroke);
    } else {
      list.splice(0, list.length, ...op.strokes);
    }
    this.layers.get(op.page)?.redraw();
    this.changed();
    return true;
  }
  clearPage(page: number): number {
    const list = this.strokes(page);
    if (!list.length) return 0;
    const strokes = list.splice(0, list.length);
    this.push({ t: "clear", page, strokes });
    this.layers.get(page)?.redraw();
    this.changed();
    return strokes.length;
  }
  get color(): string {
    return this.tool === "hl" ? HL_COLOR : PEN_COLORS[this.colorIdx] ?? PEN_COLORS[0];
  }
  /** seconds to stay on a page when the automatic page turn is on */
  turnSeconds(page: number, fallback: number): number {
    return this.data.turn?.[String(page)] ?? fallback;
  }
  setTurnSeconds(pages: number[], seconds: number) {
    this.data.turn ??= {};
    for (const p of pages) this.data.turn[String(p)] = seconds;
    this.changed();
  }
  drawable(e: PointerEvent): boolean {
    if (!this.enabled && e.pointerType === "pen") this.onPencil();
    if (!this.enabled) return false;
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return e.button === 0;
    return this.fingerDraw;
  }
}

export class PageLayer {
  private cur: Stroke | null = null;
  private pointer = -1;
  private erased: { i: number; stroke: Stroke }[] = [];
  private lastErase: [number, number, number] | null = null;
  constructor(private nb: NoteBook, readonly page: number, readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
  }

  redraw(live?: Stroke) {
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.nb.strokes(this.page)) drawStroke(ctx, s, this.canvas.width, this.canvas.height);
    if (live) drawStroke(ctx, live, this.canvas.width, this.canvas.height);
  }

  private at(e: PointerEvent): [number, number, number] {
    const r = this.canvas.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return [Math.round(((e.clientX - r.left) / r.width) * 1e4) / 1e4, Math.round(((e.clientY - r.top) / r.height) * 1e4) / 1e4, Math.round(pressure * 100) / 100];
  }

  private down = (e: PointerEvent) => {
    if (this.pointer >= 0 || !this.nb.drawable(e)) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable: fine */ }
    this.nb.onBusy(true);
    const pt = this.at(e);
    if (this.nb.tool === "eraser") {
      this.erased = [];
      this.lastErase = null;
      this.erase(pt);
    } else {
      this.cur = { k: this.nb.tool, c: this.nb.color, w: SIZES[this.nb.sizeIdx], p: [...pt] };
      this.redraw(this.cur);
    }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    e.preventDefault();
    const evs = (e.getCoalescedEvents?.() ?? []).filter((x) => x.pointerId === e.pointerId);
    for (const ev of evs.length ? evs : [e]) {
      const pt = this.at(ev);
      if (this.nb.tool === "eraser") {
        this.erase(pt);
      } else if (this.cur) {
        const n = this.cur.p.length;
        if (Math.abs(pt[0] - this.cur.p[n - 3]) + Math.abs(pt[1] - this.cur.p[n - 2]) < 0.0006) continue; // hardly moved
        this.cur.p.push(...pt);
      }
    }
    if (this.cur) this.redraw(this.cur);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.cur) {
      if (this.cur.p.length === 3) this.cur.p.push(...this.cur.p); // a tap is a dot
      this.nb.strokes(this.page).push(this.cur);
      this.nb.push({ t: "add", page: this.page, stroke: this.cur });
      this.cur = null;
      this.redraw();
      this.nb.changed();
    } else if (this.erased.length) {
      this.nb.push({ t: "del", page: this.page, items: this.erased });
      this.erased = [];
      this.nb.changed();
    }
    this.nb.onBusy(false);
  };

  /** rub out every stroke that passes near the eraser (also between two pointer events: a fast move must not skip a stroke) */
  private erase(pt: [number, number, number]) {
    const from = this.lastErase ?? pt;
    this.lastErase = pt;
    const list = this.nb.strokes(this.page);
    const ar = this.canvas.height / this.canvas.width; // x and y are fractions of different lengths
    const steps = Math.max(1, Math.ceil(Math.hypot(pt[0] - from[0], (pt[1] - from[1]) * ar) / (ERASE_RADIUS / 2)));
    let hit = false;
    for (let i = list.length - 1; i >= 0; i--) {
      let near = false;
      for (let k = 1; k <= steps && !near; k++) {
        const x = from[0] + ((pt[0] - from[0]) * k) / steps;
        const y = from[1] + ((pt[1] - from[1]) * k) / steps;
        near = distToStroke(list[i].p, x, y, ar) < ERASE_RADIUS;
      }
      if (near) {
        this.erased.push({ i, stroke: list.splice(i, 1)[0] });
        hit = true;
      }
    }
    if (hit) this.redraw();
  }
}

/** distance from a point to the polyline of a stroke (y is scaled by `ar` so that the distance is measured in one unit) */
function distToStroke(p: number[], x: number, y: number, ar: number): number {
  let best = Infinity;
  for (let j = 0; j < p.length; j += 3) {
    const ax = p[j], ay = p[j + 1] * ar;
    const bx = j + 3 < p.length ? p[j + 3] : ax, by = j + 3 < p.length ? p[j + 4] * ar : ay;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y * ar - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y * ar - (ay + t * dy)));
  }
  return best;
}
