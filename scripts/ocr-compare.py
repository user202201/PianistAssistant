#!/usr/bin/env python3
"""Scores how well an OMR result matches the known score.
Usage: ocr-compare.py truth.musicxml result.musicxml
Prints measures / notes found, the share of notes with the right pitch ("recall"), and the share of the result's notes that are right ("precision").
Notes are compared per measure and per part as sets of pitches (order inside a measure does not matter), so a missing page shows up
as missing measures and a misread note as a wrong pitch. Exit code 0 always (it is a report, not a test)."""
import sys, json
from collections import Counter
import xml.etree.ElementTree as ET

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

def load(path):
    root = ET.parse(path).getroot()
    parts = []
    for part in root.findall("part"):
        measures = []
        for m in part.findall("measure"):
            notes = Counter()
            for n in m.findall("note"):
                p = n.find("pitch")
                if p is None or n.find("grace") is not None:
                    continue
                if any(t.get("type") == "stop" for t in n.findall("tie")):
                    continue
                alter = p.findtext("alter")
                midi = (int(p.findtext("octave")) + 1) * 12 + STEP[p.findtext("step")] + (round(float(alter)) if alter else 0)
                notes[midi] += 1
            measures.append(notes)
        parts.append(measures)
    return parts

def flat(parts):
    # staves of all parts joined: OMR often puts both piano staves into one part, the truth may have them split the same way
    out = []
    n = max((len(p) for p in parts), default=0)
    for i in range(n):
        c = Counter()
        for p in parts:
            if i < len(p):
                c.update(p[i])
        out.append(c)
    return out

truth, result = flat(load(sys.argv[1])), flat(load(sys.argv[2]))
t_notes = sum(sum(m.values()) for m in truth)
r_notes = sum(sum(m.values()) for m in result)
matched = sum(sum((truth[i] & result[i]).values()) for i in range(min(len(truth), len(result))))
# position-free view: is the material there at all (a shifted measure number must not hide a good result)
whole = sum((sum((m for m in truth), Counter()) & sum((m for m in result), Counter())).values())
rep = {
    "measures_truth": len(truth), "measures_result": len(result),
    "notes_truth": t_notes, "notes_result": r_notes,
    "recall_by_measure": round(matched / t_notes, 3) if t_notes else None,
    "precision_by_measure": round(matched / r_notes, 3) if r_notes else None,
    "recall_anywhere": round(whole / t_notes, 3) if t_notes else None,
}
print(json.dumps(rep))
