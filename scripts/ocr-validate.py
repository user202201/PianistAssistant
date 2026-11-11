#!/usr/bin/env python3
"""Structural check of a MusicXML file made by a PDF recogniser -- needs NO reference score. It measures things that a correct score always satisfies:
  * every staff of every measure adds up to the length of the time signature in force  (the main sign of misread notes / rests / time signatures)
  * the declared number of staves matches the staves the notes use
  * notes lie in a believable range for their clef (a lot of far-away ledger lines = wrong clef / wrong staff)
  * measures that are completely empty, and how many notes were found at all
Usage: ocr-validate.py file.musicxml [--json]   ->  one line (markdown table row without the name) or JSON.  Exit code 0 = file could be read."""
import sys, json
import xml.etree.ElementTree as ET
STEP = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
CENTRE = {("G", "2"): 4 * 7 + 6, ("F", "4"): 3 * 7 + 1, ("C", "3"): 4 * 7 + 0, ("C", "4"): 3 * 7 + 5}  # middle line B4 / D3 / C4 / A3

def validate(path):
    r = ET.parse(path).getroot(); out = {"parts": 0, "measures": 0, "notes": 0, "staffMeasures": 0, "badStaffMeasures": 0, "badMeasures": [], "empty": 0, "farNotes": 0, "stavesDeclared": 0, "stavesUsed": 0, "timeSigs": []}
    for part in r.findall("part"):
        out["parts"] += 1; div = 1; beats, bt = 4, 4; clef = {}
        declared = 1; used = set()
        for m in part.findall("measure"):
            out["measures"] += 1
            for a in m.findall("attributes"):
                if a.findtext("divisions"): div = int(a.findtext("divisions"))
                if a.findtext("staves"): declared = max(declared, int(a.findtext("staves")))
                t = a.find("time")
                if t is not None:
                    beats, bt = int(t.findtext("beats") or 4), int(t.findtext("beat-type") or 4); out["timeSigs"].append(f"m{m.get('number')}:{beats}/{bt}")
                for c in a.findall("clef"): clef[c.get("number") or "1"] = (c.findtext("sign"), c.findtext("line"))
            full = beats * div * 4 // bt; tot = {}; pitched = False
            for n in m.findall("note"):
                s = n.findtext("staff") or "1"; used.add(s)
                vs = (s, n.findtext("voice") or "1")  # several voices on one staff each add up on their own (Audiveris writes voices 1, 2 ... with <backup>)
                if n.find("chord") is None: tot[vs] = tot.get(vs, 0) + int(n.findtext("duration") or 0)
                p = n.find("pitch")
                if p is not None:
                    pitched = True; out["notes"] += 1
                    c = CENTRE.get(clef.get(s, ("G", "2")))
                    if c is not None and abs(int(p.findtext("octave")) * 7 + STEP[p.findtext("step")] - c) > 14: out["farNotes"] += 1  # more than ~5 ledger lines away
            if not pitched: out["empty"] += 1
            bad = False
            for vs, d in tot.items():
                out["staffMeasures"] += 1
                if d != full: out["badStaffMeasures"] += 1; bad = True
            if bad: out["badMeasures"].append(int(m.get("number") or 0))
        out["stavesDeclared"] = max(out["stavesDeclared"], declared); out["stavesUsed"] = max(out["stavesUsed"], len(used))
    return out

if __name__ == "__main__":
    try: v = validate(sys.argv[1])
    except Exception as e:
        print("UNREADABLE", e); sys.exit(1)
    ok = 100.0 * (v["staffMeasures"] - v["badStaffMeasures"]) / v["staffMeasures"] if v["staffMeasures"] else 0.0
    v["okPercent"] = round(ok, 1)
    if "--json" in sys.argv: print(json.dumps(v))
    else:
        flags = []
        if v["stavesUsed"] > v["stavesDeclared"]: flags.append(f"{v['stavesUsed']} staves used but {v['stavesDeclared']} declared")
        if v["farNotes"] > 0.03 * max(v["notes"], 1): flags.append(f"{v['farNotes']} notes far from their clef")
        print(f"{v['measures']} | {v['notes']} | {v['okPercent']} % | {len(v['badMeasures'])} bad (first: {','.join(map(str, v['badMeasures'][:6])) or '-'}) | {v['empty']} | {', '.join(v['timeSigs'][:4])}{'…' if len(v['timeSigs']) > 4 else ''} | {'; '.join(flags) or '-'}")
