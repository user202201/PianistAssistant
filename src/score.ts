import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { unzipSync, strFromU8 } from "fflate";

export interface NoteEvent {
  /** seconds from start at 100% speed */
  sec: number;
  dur: number;
  midi: number;
  part: number;
  /** staff within the part: 0 = upper (right hand), 1 = lower (left hand) */
  staff: number;
  /** cursor step index this note starts on */
  step: number;
}

export interface StepInfo {
  sec: number;
  measure: number; // 0-based measure index in the source
}

export interface ParsedScore {
  title: string;
  parts: string[];
  /** staves per part */
  staffCounts: number[];
  events: NoteEvent[];
  steps: StepInfo[];
  duration: number;
  baseBpm: number;
  measureCount: number;
  /** time signature of the first measure (for the metronome) */
  timeSig: { num: number; den: number };
}

/** Turn uploaded bytes (.mxl zip or plain XML) into MusicXML text. */
export function toMusicXml(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const container = files["META-INF/container.xml"];
    let root: string | undefined;
    if (container) {
      root = /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
    }
    if (!root || !files[root]) {
      root = Object.keys(files).find((n) => /\.(xml|musicxml)$/i.test(n) && !n.startsWith("META-INF"));
    }
    if (!root) throw new Error("Invalid .mxl file");
    return strFromU8(files[root]);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Walk the OSMD cursor once to collect every note with its timing.
 * Using the cursor means repeats are expanded exactly as the cursor will play them.
 */
export function extractScore(osmd: OpenSheetMusicDisplay, fallbackTitle: string): ParsedScore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet: any = osmd.Sheet;
  const cursor = osmd.cursor;
  cursor.reset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const it: any = cursor.Iterator;
  const defaultBpm: number = sheet.DefaultStartTempoInBpm > 0 ? sheet.DefaultStartTempoInBpm : 100;

  const parts: string[] = sheet.Instruments.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (i: any, idx: number) => i.Name || `Part ${idx + 1}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffCounts: number[] = sheet.Instruments.map((i: any) => i.Staves.length);

  interface Raw { beat: number; bpm: number; measure: number }
  const raws: Raw[] = [];
  interface RawNote { beat: number; lenBeats: number; midi: number; part: number; staff: number; step: number }
  const notes: RawNote[] = [];

  // NOTE: iterator.currentTimeStamp is *source* time: it jumps back when a repeat is taken.
  // We build our own monotonic playback beat: measureStart (accumulated) + offset inside the measure.
  let guard = 0;
  let prevMeasure = -1;
  let prevTs = -1;
  let measureStart = 0; // playback beat where the current pass of the measure began
  let prevMeasureLen = 0;
  let endBeat = 0;
  while (!it.EndReached && guard++ < 200000) {
    const ts: number = it.currentTimeStamp.RealValue * 4;
    const measure = it.CurrentMeasureIndex as number;
    const cm = it.CurrentMeasure;
    const mAbs: number = (cm?.AbsoluteTimestamp?.RealValue ?? 0) * 4;
    const mLen: number = (cm?.Duration?.RealValue ?? 0) * 4;
    if (prevMeasure >= 0 && (measure !== prevMeasure || ts < prevTs - 1e-9)) measureStart += prevMeasureLen;
    prevMeasure = measure;
    prevTs = ts;
    prevMeasureLen = mLen;
    const beat = measureStart + (ts - mAbs);
    endBeat = measureStart + mLen;
    const bpm: number = cm?.TempoInBPM > 0 ? cm.TempoInBPM : defaultBpm;
    const step = raws.length;
    raws.push({ beat, bpm, measure });
    for (const ve of it.CurrentVoiceEntries) {
      const staffObj = ve.ParentSourceStaffEntry.ParentStaff;
      const inst = staffObj.ParentInstrument;
      const part = sheet.Instruments.indexOf(inst);
      const staff = Math.max(0, inst.Staves.indexOf(staffObj));
      for (const n of ve.Notes) {
        if (n.isRest() || n.IsGraceNote) continue;
        const tie = n.NoteTie;
        if (tie && tie.StartNote !== n) continue; // continuation of a tied note
        let len = n.Length.RealValue;
        if (tie && tie.Notes) {
          len = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const tn of tie.Notes as any[]) len += tn.Length.RealValue;
        }
        notes.push({ beat, lenBeats: len * 4, midi: n.halfTone + 12, part, staff, step });
      }
    }
    cursor.next();
  }
  cursor.reset();

  // beat -> seconds, honouring tempo changes
  const secs: number[] = [];
  let acc = 0;
  for (let i = 0; i < raws.length; i++) {
    secs.push(acc);
    if (i + 1 < raws.length) acc += ((raws[i + 1].beat - raws[i].beat) * 60) / raws[i].bpm;
  }
  const beatToSec = (b: number): number => {
    // find segment containing b (linear scan from end is fine; use binary search)
    let lo = 0, hi = raws.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (raws[mid].beat <= b + 1e-9) lo = mid; else hi = mid - 1;
    }
    return secs[lo] + ((b - raws[lo].beat) * 60) / raws[lo].bpm;
  };

  const events: NoteEvent[] = notes.map((n) => {
    const s = beatToSec(n.beat);
    return {
      sec: s,
      dur: Math.max(0.05, beatToSec(n.beat + n.lenBeats) - s),
      midi: n.midi,
      part: n.part,
      staff: n.staff,
      step: n.step,
    };
  });
  const duration = Math.max(
    beatToSec(endBeat),
    events.reduce((m, e) => Math.max(m, e.sec + e.dur), 0),
  );

  return {
    title: sheet.TitleString || fallbackTitle,
    parts,
    staffCounts,
    events,
    steps: raws.map((r, i) => ({ sec: secs[i], measure: r.measure })),
    duration,
    baseBpm: defaultBpm,
    measureCount: sheet.SourceMeasures.length,
    timeSig: {
      num: sheet.SourceMeasures[0]?.ActiveTimeSignature?.Numerator || 4,
      den: sheet.SourceMeasures[0]?.ActiveTimeSignature?.Denominator || 4,
    },
  };
}
