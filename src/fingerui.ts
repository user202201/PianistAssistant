import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { suggest } from "./fingering";
import { noteKey, parseXml, serialize, setFingering, walkNotes, type XNote } from "./musicxml";

interface Spot {
  x: number;
  y: number;
  note: XNote;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Tiny spatial index: boxes bucketed into square cells, so "does this label hit anything" is fast. */
class Grid {
  private cells = new Map<string, Box[]>();
  constructor(private size: number) {}
  private range(x0: number, x1: number): number[] {
    const out: number[] = [];
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++) out.push(i);
    return out;
  }
  add(b: Box) {
    for (const i of this.range(b.l, b.r)) for (const j of this.range(b.t, b.b)) (this.cells.get(`${i},${j}`) ?? this.cells.set(`${i},${j}`, []).get(`${i},${j}`)!).push(b);
  }
  /** total overlap area (px²) of `q` with stored boxes; overlaps up to `margin` px thick are ignored (0 = any contact counts, e.g. a 1px stem) */
  overlap(q: Box, margin: number): number {
    let sum = 0;
    const seen = new Set<Box>();
    for (const i of this.range(q.l, q.r)) {
      for (const j of this.range(q.t, q.b)) {
        for (const b of this.cells.get(`${i},${j}`) ?? []) {
          if (seen.has(b)) continue;
          seen.add(b);
          const w = Math.min(q.r, b.r) - Math.max(q.l, b.l);
          const h = Math.min(q.b, b.b) - Math.max(q.t, b.t);
          if (w > margin && h > margin) sum += Math.max(w, 1) * Math.max(h, 1);
        }
      }
    }
    return sum;
  }
}

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/**
 * Fingering on top of the OSMD score. Priority, per note:
 *   1. fingering written in the MusicXML (drawn by OSMD, black)
 *   2. rule-based suggestion (blue overlay, reference only)
 *   3. edits made here (orange overlay until saved; saving writes them into the MusicXML)
 */
export class FingerTools implements FingerApi {
  readonly doc: Document;
  readonly notes: XNote[];
  private byKey = new Map<string, XNote>();
  /** master switch: hides XML fingering, suggestions and edits (editing forces it on) */
  visible = true;
  showXml = true;
  showAuto: boolean;
  editing = false;
  selected: number | null = null;
  pending = new Map<number, number | null>();
  private history: { idx: number; prev: number | null | undefined }[] = [];
  private auto = new Map<number, number>();
  private spots: Spot[] = [];
  private layer: HTMLDivElement;
  onChange: () => void = () => {};

  constructor(
    private osmd: OpenSheetMusicDisplay,
    private host: HTMLElement,
    xml: string,
    enabled = true,
  ) {
    this.doc = parseXml(xml);
    this.notes = enabled ? walkNotes(this.doc) : []; // disabled: fingering tools are unavailable (supported = false)
    for (const n of this.notes) if (!n.grace) this.byKey.set(noteKey(n.part, n.measure, n.staff, n.onset, n.midi), n);
    this.showAuto = this.xmlCount === 0 && this.notes.length > 0;
    this.layer = document.createElement("div");
    this.layer.className = "flayer";
    host.append(this.layer);
    this.recomputeAuto();
    host.addEventListener("click", (e) => this.onTap(e));
    window.addEventListener("resize", this.onResize);
  }

  private resizeTimer = 0;
  private onResize = () => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.refresh(), 600); // after OSMD has re-rendered
  };
  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.layer.remove();
  }

  get supported() {
    return this.notes.length > 0;
  }
  get xmlCount() {
    return this.notes.filter((n) => n.fingering !== null).length;
  }
  get dirty() {
    return this.pending.size > 0;
  }

  private fixed = (n: XNote): number | null => (this.pending.has(n.idx) ? this.pending.get(n.idx)! : n.fingering);
  private recomputeAuto() {
    this.auto = this.showAuto ? suggest(this.notes, this.fixed) : new Map();
  }

  setAuto(on: boolean) {
    this.showAuto = on;
    this.recomputeAuto();
    this.refresh();
  }
  setEditing(on: boolean) {
    this.editing = on;
    if (!on) this.selected = null;
    this.refresh();
    this.onChange();
  }

  /** Recompute screen positions of all notes and redraw the overlay. Call after every OSMD render. */
  refresh() {
    const svg = this.host.querySelector("svg");
    this.layer.replaceChildren();
    this.spots = [];
    if (!svg) return;
    const hr = this.host.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const ox = sr.left - hr.left;
    const oy = sr.top - hr.top;
    const k = 10 * this.osmd.zoom;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheet: any = this.osmd.Sheet;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gs: any = this.osmd.GraphicSheet;
    gs.MeasureList.forEach((row: any[], mi: number) =>
      row.forEach((gm) => {
        if (!gm) return;
        for (const se of gm.staffEntries)
          for (const gve of se.graphicalVoiceEntries)
            for (const gn of gve.notes) {
              const sn = gn.sourceNote;
              if (sn.isRest() || sn.IsGraceNote) continue;
              const staff = sn.ParentStaffEntry.ParentStaff;
              const inst = staff.ParentInstrument;
              const key = noteKey(sheet.Instruments.indexOf(inst), mi, inst.Staves.indexOf(staff), se.relInMeasureTimestamp.RealValue, sn.halfTone + 12);
              const note = this.byKey.get(key);
              if (!note || note.tieStop) continue;
              const a = gn.PositionAndShape.AbsolutePosition;
              this.spots.push({ x: ox + a.x * k, y: oy + a.y * k, note });
            }
      }),
    );
    const show = this.visible || this.editing;
    if (show) this.placeBadges(svg, hr);
    if (this.editing) {
      for (const s of this.spots) {
        const ring = document.createElement("div");
        ring.className = "fhit" + (s.note.idx === this.selected ? " sel" : "");
        ring.style.left = `${s.x}px`;
        ring.style.top = `${s.y}px`;
        this.layer.append(ring);
      }
    }
  }

  // ---------- label placement: put every number where it does not cover printed music ----------
  /** All printed shapes (noteheads, stems, beams, accidentals, rests, text ...) in holder coordinates. */
  private collectObstacles(svg: SVGElement, hr: DOMRect): Grid {
    const grid = new Grid(48);
    const R = 3.5; // half size of the boxes laid along a slanted shape
    for (const el of Array.from(svg.querySelectorAll("path, rect, text"))) {
      if (el.closest(".vf-stave, .vf-curve, .osmd-title, .osmd-subtitle, .osmd-composer, .vf-brace, .vf-connector")) continue; // staff lines, slurs, ...
      const r = el.getBoundingClientRect();
      if ((r.height < 3 && r.width > 100) || (r.width > 300 && r.height > 200) || (r.width === 0 && r.height === 0)) continue; // long thin lines, page background
      if (el.tagName === "path" && r.width > 30 && r.height > 10 && r.width < 900) {
        // slanted beams: a bounding box would block a big empty triangle, so follow the real outline instead
        const path = el as SVGPathElement;
        const ctm = path.getScreenCTM();
        if (ctm) {
          const len = path.getTotalLength();
          for (let d = 0; d <= len; d += 5) {
            const p = path.getPointAtLength(d).matrixTransform(ctm);
            const x = p.x - hr.left;
            const y = p.y - hr.top;
            grid.add({ l: x - R, t: y - R, r: x + R, b: y + R });
          }
          continue;
        }
      }
      grid.add({ l: r.left - hr.left, t: r.top - hr.top, r: r.right - hr.left, b: r.bottom - hr.top });
    }
    return grid;
  }

  private placeBadges(svg: SVGElement, hr: DOMRect) {
    const obstacles = this.collectObstacles(svg, hr);
    const placed = new Grid(48);
    const W = 20;
    const H = 22;
    // how many notes sound together: chord members prefer the side of the chord (left), single notes above / below
    const size = new Map<string, number>();
    const gk = (n: XNote) => `${n.part}|${n.staff}|${n.measure}|${Math.round(n.onset * 3840)}`;
    for (const s of this.spots) size.set(gk(s.note), (size.get(gk(s.note)) ?? 0) + 1);

    interface Item { spot: Spot; text: string; pend: boolean }
    const items: Item[] = [];
    for (const s of this.spots) {
      const idx = s.note.idx;
      if (this.pending.has(idx)) {
        const v = this.pending.get(idx);
        items.push({ spot: s, text: v === null || v === undefined ? "✕" : String(v), pend: true });
      } else if (this.showAuto && s.note.fingering === null && this.auto.has(idx)) {
        items.push({ spot: s, text: String(this.auto.get(idx)), pend: false });
      }
    }
    items.sort((a, b) => a.spot.x - b.spot.x || a.spot.y - b.spot.y);

    // candidate positions (offset of the badge centre from the notehead), nearest and most natural first
    const cands = (hand: "R" | "L", chord: boolean) => {
      const base: [number, number][] = [
        [0, -30], [-15, -28], [15, -28], [0, 30], [-15, 28], [15, 28],
        [-26, 0], [26, 0], [0, -48], [0, 48], [-30, -22], [30, -22], [-30, 22], [30, 22],
        [-46, 0], [46, 0], [0, -66], [0, 66], [-20, -50], [20, -50], [-20, 50], [20, 50], [0, -86], [0, 86],
      ];
      return base
        .map(([dx, dy]) => {
          let cost = Math.hypot(dx, dy);
          if (hand === "R" ? dy > 0 : dy < 0) cost += 12; // right hand: above, left hand: below
          if (chord && dy === 0 && dx < 0) cost -= 14; // chord: beside the chord, aligned with its note
          return { dx, dy, cost };
        })
        .sort((a, b) => a.cost - b.cost);
    };
    const cache = new Map<string, ReturnType<typeof cands>>();

    for (const it of items) {
      const { spot } = it;
      const chord = (size.get(gk(spot.note)) ?? 1) > 1;
      const key = `${spot.note.hand}${chord}`;
      const list = cache.get(key) ?? cache.set(key, cands(spot.note.hand, chord)).get(key)!;
      const w = Math.max(W, 12 * it.text.length + 8);
      let best: { cx: number; cy: number } | null = null;
      let bestScore = Infinity;
      for (const c of list) {
        const cx = spot.x + c.dx;
        const cy = spot.y + c.dy;
        const rect = { l: cx - w / 2, t: cy - H / 2, r: cx + w / 2, b: cy + H / 2 };
        // 0 = free; otherwise how much it overlaps something (the candidates are tried best-first)
        // only the digit itself must stay clear (the pill around it may touch things); any contact counts, even a 1px stem
        const digit = { l: rect.l + 4, t: rect.t + 4, r: rect.r - 4, b: rect.b - 4 };
        const o = obstacles.overlap(digit, 0) * 3 + placed.overlap(rect, 1) * 2;
        if (o === 0) {
          best = { cx, cy };
          break;
        }
        if (o + c.cost * 0.05 < bestScore) {
          bestScore = o + c.cost * 0.05;
          best = { cx, cy };
        }
      }
      if (!best) continue;
      placed.add({ l: best.cx - w / 2, t: best.cy - H / 2, r: best.cx + w / 2, b: best.cy + H / 2 });
      const b = document.createElement("div");
      b.className = `fbadge ${it.pend ? "pend" : "auto"}`;
      b.textContent = it.text;
      b.style.left = `${best.cx}px`;
      b.style.top = `${best.cy - H / 2}px`;
      this.layer.append(b);
    }
  }

  private onTap(e: MouseEvent) {
    if (!this.editing) return;
    const r = this.host.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: Spot | null = null;
    let bd = 34 * 34; // generous radius for fingers
    for (const s of this.spots) {
      const d = (s.x - px) ** 2 + (s.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      this.selected = best.note.idx;
      this.refresh();
      this.onChange();
    }
  }

  describeSelected(): string {
    if (this.selected === null) return "点谱面上的音符，再点数字";
    const n = this.notes[this.selected];
    const cur = this.pending.has(n.idx) ? this.pending.get(n.idx) : n.fingering ?? this.auto.get(n.idx);
    return `第 ${n.measure + 1} 小节 · ${n.hand === "R" ? "右手" : "左手"} · ${noteName(n.midi)}${cur ? ` · 当前 ${cur}` : ""}`;
  }

  /** Set (1-5) or clear (null) the selected note's fingering, then move on to the next note. */
  apply(f: number | null) {
    if (this.selected === null) return;
    const idx = this.selected;
    this.history.push({ idx, prev: this.pending.has(idx) ? this.pending.get(idx) : undefined });
    this.pending.set(idx, f);
    this.selected = this.nextOf(idx) ?? idx;
    this.recomputeAuto();
    this.refresh();
    this.onChange();
  }

  undo() {
    const h = this.history.pop();
    if (!h) return;
    if (h.prev === undefined) this.pending.delete(h.idx);
    else this.pending.set(h.idx, h.prev);
    this.selected = h.idx;
    this.recomputeAuto();
    this.refresh();
    this.onChange();
  }

  private nextOf(idx: number): number | null {
    const n = this.notes[idx];
    const seq = this.spots
      .map((s) => s.note)
      .filter((m) => m.part === n.part && m.staff === n.staff)
      .sort((a, b) => a.measure - b.measure || a.onset - b.onset || a.midi - b.midi);
    const i = seq.findIndex((m) => m.idx === idx);
    return i >= 0 && i + 1 < seq.length ? seq[i + 1].idx : null;
  }

  discard() {
    this.pending.clear();
    this.history = [];
    this.recomputeAuto();
    this.refresh();
    this.onChange();
  }

  parts() {
    return [this];
  }

  /** Writes pending edits into the MusicXML and persists via `write`. Returns the new XML text. */
  async save(write: (xml: string) => Promise<void>): Promise<string> {
    for (const [idx, f] of this.pending) setFingering(this.notes[idx].el, f);
    const xml = serialize(this.doc);
    await write(xml); // on failure the edits stay pending so saving can be retried
    for (const [idx, f] of this.pending) this.notes[idx].fingering = f;
    this.pending.clear();
    this.history = [];
    this.recomputeAuto();
    this.onChange();
    return xml;
  }
}


/** What the controls need from the fingering tools: one score, or several (paired four-hand files, one tool set per screen). */
export interface FingerApi {
  readonly supported: boolean;
  readonly xmlCount: number;
  visible: boolean;
  showXml: boolean;
  readonly showAuto: boolean;
  readonly editing: boolean;
  readonly dirty: boolean;
  readonly pending: { size: number };
  onChange: () => void;
  setAuto(on: boolean): void;
  setEditing(on: boolean): void;
  apply(f: number | null): void;
  undo(): void;
  discard(): void;
  describeSelected(): string;
  refresh(): void;
  dispose(): void;
  /** the individual tool sets, in screen order (for saving each to its own file) */
  parts(): FingerTools[];
}

/** Independent fingering tools per screen, driven together: shared switches, edits go to the screen last tapped. */
export class FingerGroup implements FingerApi {
  private active = 0;
  constructor(private tools: FingerTools[]) {}
  get supported() { return this.tools.some((t) => t.supported); }
  get xmlCount() { return this.tools.reduce((n, t) => n + t.xmlCount, 0); }
  get visible() { return this.tools[0]?.visible ?? true; }
  set visible(v: boolean) { this.tools.forEach((t) => (t.visible = v)); }
  get showXml() { return this.tools[0]?.showXml ?? true; }
  set showXml(v: boolean) { this.tools.forEach((t) => (t.showXml = v)); }
  get showAuto() { return this.tools[0]?.showAuto ?? false; }
  get editing() { return this.tools.some((t) => t.editing); }
  get dirty() { return this.tools.some((t) => t.dirty); }
  get pending() { return { size: this.tools.reduce((n, t) => n + t.pending.size, 0) }; }
  set onChange(fn: () => void) {
    this.tools.forEach((t, i) => (t.onChange = () => {
      if (t.selected !== null) this.active = i; // edits go to the screen of the last selected note
      fn();
    }));
  }
  setAuto(on: boolean) { this.tools.forEach((t) => t.setAuto(on)); }
  setEditing(on: boolean) { this.tools.forEach((t) => t.setEditing(on)); }
  apply(f: number | null) { this.tools[this.active]?.apply(f); }
  undo() { this.tools[this.active]?.undo(); }
  discard() { this.tools.forEach((t) => t.discard()); }
  describeSelected() {
    const t = this.tools[this.active];
    return t ? `${this.tools.length > 1 ? `${String.fromCharCode(65 + this.active)} 声部 · ` : ""}${t.describeSelected()}` : "";
  }
  refresh() { this.tools.forEach((t) => t.refresh()); }
  dispose() { this.tools.forEach((t) => t.dispose()); }
  parts() { return this.tools; }
}
