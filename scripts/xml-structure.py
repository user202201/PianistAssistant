#!/usr/bin/env python3
"""One-paragraph structure report of a MusicXML file: parts, staves, clefs, notes per staff, pitch range per staff.
Used by the OCR lab to see WHY a result looks different (e.g. a grand staff squeezed onto one staff). Usage: xml-structure.py file.musicxml"""
import sys
import xml.etree.ElementTree as ET
STEP = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}
r = ET.parse(sys.argv[1]).getroot()
print("  parts:", len(r.findall("part")), "| score-part names:", [(p.get("id"), (p.findtext("part-name") or "")) for p in r.findall("part-list/score-part")])
for part in r.findall("part"):
    ms = part.findall("measure")
    staves = sorted({a.findtext("staves") for m in ms for a in m.findall("attributes") if a.findtext("staves")})
    clefs = []
    for i, m in enumerate(ms):
        for a in m.findall("attributes"):
            for c in a.findall("clef"):
                clefs.append(f"m{i+1}:{c.get('number') or '1'}={c.findtext('sign')}{c.findtext('line')}")
    per = {}
    for n in part.iter("note"):
        p = n.find("pitch")
        if p is None:
            continue
        s = n.findtext("staff") or "1"
        v = int(p.findtext("octave")) * 7 + STEP[p.findtext("step")]
        lo, hi, c = per.get(s, (999, -999, 0)); per[s] = (min(lo, v), max(hi, v), c + 1)
    name = lambda v: "CDEFGAB"[v % 7] + str(v // 7)
    rng = {s: f"{name(lo)}..{name(hi)} ({c} notes)" for s, (lo, hi, c) in sorted(per.items())}
    print(f"  part {part.get('id')}: {len(ms)} measures | <staves>: {staves or 'none'} | clefs: {clefs[:6]}{'…' if len(clefs) > 6 else ''} | by <staff>: {rng}")
    print("  new-system marks:", sum(1 for m in ms for _ in m.findall("print")), "| first measure children:", [c.tag for c in ms[0]][:14] if ms else [])
