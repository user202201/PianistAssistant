import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { suggest } from "./fingering";
import { noteKey, parseXml, serialize, setFingering, walkNotes, type XNote } from "./musicxml";

interface Spot {
  x: number;
  y: number;
  note: XNote;
}

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/**
 * Fingering on top of the OSMD score. Priority, per note:
 *   1. fingering written in the MusicXML (drawn by OSMD, black)
 *   2. rule-based suggestion (blue overlay, reference only)
 *   3. edits made here (orange overlay until saved; saving writes them into the MusicXML)
 */
export class FingerTools {
  readonly doc: Document;
  readonly notes: XNote[];
  private byKey = new Map<string, XNote>();
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
  ) {
    this.doc = parseXml(xml);
    this.notes = walkNotes(this.doc);
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
    for (const s of this.spots) {
      const idx = s.note.idx;
      let text: string | null = null;
      let cls = "";
      if (this.pending.has(idx)) {
        const v = this.pending.get(idx);
        text = v === null || v === undefined ? "✕" : String(v);
        cls = "pend";
      } else if (this.showAuto && s.note.fingering === null && this.auto.has(idx)) {
        text = String(this.auto.get(idx));
        cls = "auto";
      }
      if (text !== null) {
        const b = document.createElement("div");
        b.className = `fbadge ${cls}`;
        b.textContent = text;
        b.style.left = `${s.x}px`;
        b.style.top = `${s.y + (s.note.hand === "R" ? -34 : 20)}px`;
        this.layer.append(b);
      }
      if (this.editing) {
        const ring = document.createElement("div");
        ring.className = "fhit" + (idx === this.selected ? " sel" : "");
        ring.style.left = `${s.x}px`;
        ring.style.top = `${s.y}px`;
        this.layer.append(ring);
      }
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
