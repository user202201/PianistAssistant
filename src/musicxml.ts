/**
 * Minimal MusicXML (partwise) reader/editor, used for fingering:
 *  - walkNotes: every pitched note with part / measure / staff / onset, matching OSMD's graphical notes
 *  - setFingering: write or remove <fingering> in the XML so it is saved with the score
 */
export interface XNote {
  idx: number;
  el: Element;
  part: number;
  measure: number; // 0-based, in document order
  staff: number; // 0-based within the part
  onset: number; // whole notes from the start of the measure
  midi: number;
  hand: "R" | "L";
  tieStop: boolean;
  grace: boolean;
  /** fingering already written in the XML (1-5), if any */
  fingering: number | null;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ONSET_GRID = 3840; // 2^8*3*5: exact for common tuplets

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("MusicXML 解析失败");
  return doc;
}

export const noteKey = (part: number, measure: number, staff: number, onset: number, midi: number) =>
  `${part}|${measure}|${staff}|${Math.round(onset * ONSET_GRID)}|${midi}`;

const kids = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName === tag);
const txt = (el: Element, tag: string) => kids(el, tag)[0]?.textContent?.trim() ?? "";

export function walkNotes(doc: Document): XNote[] {
  const root = doc.documentElement;
  if (root.tagName !== "score-partwise") return [];
  const out: XNote[] = [];
  kids(root, "part").forEach((part, pi) => {
    let divisions = 1;
    const clef = new Map<number, string>();
    // a part with two staves (piano): the upper staff is the right hand, the lower one the left hand, whatever the clefs say. Converted PDFs often have the same
    // clef on both staves (or the left hand written in a treble clef, like in some fugues); judging by the clef would put both staves in ONE hand, and notes sounding together on the two
    // staves would then be fingered as one chord (5 on every upper note, 1 on every lower one)
    const staffCount = Math.max(parseInt(part.getElementsByTagName("staves")[0]?.textContent ?? "") || 1, ...Array.from(part.getElementsByTagName("staff")).map((s) => parseInt(s.textContent ?? "") || 1));
    kids(part, "measure").forEach((meas, mi) => {
      let pos = 0; // whole notes
      let lastOnset = 0;
      for (const ch of Array.from(meas.children)) {
        const tag = ch.tagName;
        if (tag === "attributes") {
          const d = parseInt(txt(ch, "divisions"));
          if (d > 0) divisions = d;
          for (const c of kids(ch, "clef")) clef.set(parseInt(c.getAttribute("number") ?? "1") || 1, txt(c, "sign"));
        } else if (tag === "backup" || tag === "forward") {
          const d = parseFloat(txt(ch, "duration")) || 0;
          pos += (tag === "forward" ? d : -d) / (divisions * 4);
        } else if (tag === "note") {
          const isChord = kids(ch, "chord").length > 0;
          const grace = kids(ch, "grace").length > 0;
          const rest = kids(ch, "rest").length > 0;
          const dur = grace ? 0 : (parseFloat(txt(ch, "duration")) || 0) / (divisions * 4);
          const onset = isChord ? lastOnset : pos;
          if (!isChord && !grace) lastOnset = pos;
          const pitch = kids(ch, "pitch")[0];
          if (pitch && !rest) {
            const midi = (parseInt(txt(pitch, "octave")) + 1) * 12 + (STEP[txt(pitch, "step")] ?? 0) + Math.round(parseFloat(txt(pitch, "alter")) || 0);
            const staffNo = parseInt(txt(ch, "staff")) || 1;
            const fing = ch.getElementsByTagName("fingering")[0];
            const f = fing ? parseInt(fing.textContent ?? "") : NaN;
            const ties = kids(ch, "tie").map((t) => t.getAttribute("type"));
            out.push({
              idx: out.length,
              el: ch,
              part: pi,
              measure: mi,
              staff: staffNo - 1,
              onset,
              midi,
              hand: staffCount >= 2 ? (staffNo === 1 ? "R" : "L") : clef.get(staffNo) === "F" ? "L" : "R",
              tieStop: ties.includes("stop"),
              grace,
              fingering: f >= 1 && f <= 5 ? f : null,
            });
          }
          if (!isChord && !grace) pos += dur;
        }
      }
    });
  });
  return out;
}

/** Write (1-5) or remove (null) the fingering of one <note>. */
export function setFingering(note: Element, finger: number | null) {
  const doc = note.ownerDocument;
  for (const f of Array.from(note.getElementsByTagName("fingering"))) {
    const tech = f.parentElement!;
    f.remove();
    if (!tech.children.length) {
      const nots = tech.parentElement;
      tech.remove();
      if (nots && nots.tagName === "notations" && !nots.children.length) nots.remove();
    }
  }
  if (finger === null) return;
  let nots = kids(note, "notations")[0];
  if (!nots) {
    nots = doc.createElement("notations");
    const before = Array.from(note.children).find((c) => ["lyric", "play", "listen"].includes(c.tagName));
    if (before) note.insertBefore(nots, before);
    else note.append(nots);
  }
  let tech = kids(nots, "technical")[0];
  if (!tech) {
    tech = doc.createElement("technical");
    nots.append(tech);
  }
  const f = doc.createElement("fingering");
  f.textContent = String(finger);
  tech.append(f);
}

export function serialize(doc: Document): string {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith("<?xml") ? s : `<?xml version="1.0" encoding="UTF-8"?>\n${s}`;
}
