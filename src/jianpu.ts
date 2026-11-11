/**
 * Jianpu (numbered notation, 简谱) as one line under every staff: the digits are written into a copy of the MusicXML as lyrics, so the score engraver
 * puts them at the SAME height under each staff, centred under their notes, and makes room for them. Movable do (首调): 1 = the tonic of the key
 * signature (the relative major for a minor key). Accidentals in front, octave dots above / below the digit. Chords: the highest note. Rests and
 * tied-on notes get nothing. Only the copy that is drawn contains the digits, the file itself is never changed.
 */
const STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PC = [0, 2, 4, 5, 7, 9, 11]; // pitch class of the natural notes C D E F G A B
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DOT_ABOVE = "̇";
const DOT_BELOW = "̣";

interface Pitch { step: number; alter: number; octave: number }

/** the tonic (step, alter) of a major key with this many sharps (+) or flats (-) */
function tonicOf(fifths: number): { step: number; alter: number } {
  const step = (((fifths * 4) % 7) + 7) % 7; // the circle of fifths walks C G D A E B F: 4 steps of the letters each
  return { step, alter: fifths >= 6 ? 1 : fifths <= -2 ? -1 : 0 };
}

/** the text of one note: for example "♯4", "5̇", "1̣" */
export function jianpuText(p: Pitch, fifths: number): string {
  const t = tonicOf(fifths);
  const tonicPc = (PC[t.step] + t.alter + 120) % 12;
  // the octave in which "1" has no dot: the tonic lies between C4 and B4
  let tonicOct = 4;
  const tonicMidi = (o: number) => (o + 1) * 12 + PC[t.step] + t.alter;
  if (tonicMidi(tonicOct) < 60) tonicOct++;
  else if (tonicMidi(tonicOct) > 71) tonicOct--;
  const diff = p.octave * 7 + p.step - (tonicOct * 7 + t.step);
  const degree = ((diff % 7) + 7) % 7; // 0 .. 6
  const shift = Math.floor(diff / 7); // octaves above (+) or below (-) the middle one
  const pc = (PC[p.step] + p.alter + 120) % 12;
  let acc = ((pc - tonicPc - MAJOR[degree]) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;
  const mark = acc === 0 ? "" : acc > 0 ? "♯".repeat(Math.min(acc, 2)) : "♭".repeat(Math.min(-acc, 2));
  return mark + String(degree + 1) + (shift > 0 ? DOT_ABOVE.repeat(Math.min(shift, 3)) : DOT_BELOW.repeat(Math.min(-shift, 3)));
}

function pitchOf(note: Element): Pitch | null {
  const pe = note.getElementsByTagName("pitch")[0];
  if (!pe) return null;
  const step = STEP[pe.getElementsByTagName("step")[0]?.textContent ?? ""];
  const octave = parseInt(pe.getElementsByTagName("octave")[0]?.textContent ?? "");
  if (step === undefined || Number.isNaN(octave)) return null;
  return { step, alter: Math.round(parseFloat(pe.getElementsByTagName("alter")[0]?.textContent ?? "0") || 0), octave };
}
const midiOf = (p: Pitch) => (p.octave + 1) * 12 + PC[p.step] + p.alter;

/** the MusicXML with a jianpu line (lyrics, verse "jianpu") added; the original string when it cannot be read */
export function addJianpu(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.tagName !== "score-partwise") return xml;
    for (const part of Array.from(doc.getElementsByTagName("part"))) {
      let fifths = 0;
      for (const meas of Array.from(part.getElementsByTagName("measure"))) {
        for (const k of Array.from(meas.getElementsByTagName("key"))) fifths = parseInt(k.getElementsByTagName("fifths")[0]?.textContent ?? "") || 0;
        // chords: the notes after the first one of a group carry <chord/>; the digit goes to the highest of the group
        let group: Element[] = [];
        const flush = () => {
          if (!group.length) return;
          let best: Element | null = null;
          let bestMidi = -1;
          for (const n of group) {
            if (n.getElementsByTagName("rest")[0] || n.getElementsByTagName("grace")[0]) continue;
            if (Array.from(n.getElementsByTagName("tie")).some((t) => t.getAttribute("type") === "stop")) continue;
            const p = pitchOf(n);
            if (p && midiOf(p) > bestMidi) { best = n; bestMidi = midiOf(p); }
          }
          group = [];
          if (!best) return;
          const text = jianpuText(pitchOf(best)!, fifths);
          const lyric = doc.createElement("lyric");
          lyric.setAttribute("number", "jianpu");
          const syl = doc.createElement("syllabic"); syl.textContent = "single";
          const tx = doc.createElement("text"); tx.textContent = text;
          lyric.append(syl, tx);
          best.append(lyric);
        };
        for (const ch of Array.from(meas.children)) {
          if (ch.tagName !== "note") continue;
          if (ch.getElementsByTagName("chord")[0]) group.push(ch);
          else { flush(); group = [ch]; }
        }
        flush();
      }
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}
