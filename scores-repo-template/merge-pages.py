#!/usr/bin/env python3
"""Joins the MusicXML files of the pages of one score (sorted by file name) into one: measures of the same part are appended in order.
Usage: merge-pages.py <folder with *.musicxml> <output.musicxml> [title]   (title is used when the result has none)"""
import sys, glob
import xml.etree.ElementTree as ET
files = sorted(glob.glob(sys.argv[1] + "/*.musicxml") + glob.glob(sys.argv[1] + "/*.xml"))
if not files:
    sys.exit("no input")
base = ET.parse(files[0]); root = base.getroot(); parts = root.findall("part")
for extra in files[1:]:
    r = ET.parse(extra).getroot()
    for i, part in enumerate(r.findall("part")):
        if i >= len(parts):
            break
        last = 0
        for m in parts[i].findall("measure"):
            try: last = max(last, int(m.get("number", "0")))
            except ValueError: last += 1
        for m in part.findall("measure"):
            last += 1; m.set("number", str(last)); parts[i].append(m)

def length_of(m):
    """length of a measure in divisions: the longest of its staves that have real notes (a lone rest says nothing about the length)"""
    tot = {}; pitched = set()
    for e in m.findall("note"):
        st = e.findtext("staff") or "1"
        if e.find("chord") is None: tot[st] = tot.get(st, 0) + int(e.findtext("duration") or 0)
        if e.find("rest") is None: pitched.add(st)
    return max([tot[s] for s in pitched] or [0])

def repair_timing(root):
    """Recognisers often misread a time signature (3/4 as 2/4) and write whole-measure rests as whole notes of the wrong length. The measures then do not
    add up and the score is laid out wrongly. 1) when most measures after a time signature have the same length, which is not the one written, the
    time signature is corrected; 2) a rest that is alone on its staff in a measure gets the length of the measure."""
    for part in root.findall("part"):
        ms = part.findall("measure"); div = 1; segs = []; cur = None
        # notes on a second staff but no <staves>2</staves>: the reader draws everything on ONE staff (both hands on a single line)
        nst = max([int(n.findtext("staff") or 1) for n in part.iter("note")] or [1])
        first = next((a for a in part.iter("attributes")), None)
        if nst > 1 and first is not None and first.find("staves") is None:
            el = ET.Element("staves"); el.text = str(nst)
            ci = next((i for i, c in enumerate(first) if c.tag == "clef"), len(first)); first.insert(ci, el)
        for m in ms:
            for a in m.findall("attributes"):
                if a.findtext("divisions"): div = int(a.findtext("divisions"))
                if a.find("time") is not None: cur = {"time": a.find("time"), "div": div, "ms": []}; segs.append(cur)
            if cur is not None: cur["ms"].append((m, div))
        for s in segs:
            tm = s["time"]
            try: nominal = lambda b, t, d: b * d * 4 // t
            except Exception: continue
            lens = []
            for m, d in s["ms"]:
                notes = [n for n in m.findall("note") if n.find("rest") is None]
                if notes: lens.append((length_of(m), d))
            if len(lens) < 3: continue
            quarters = [l / d for l, d in lens]
            best = max(set(quarters), key=quarters.count)
            if quarters.count(best) < 0.6 * len(quarters) or best <= 0: continue
            b0, t0 = int(tm.findtext("beats") or 0), int(tm.findtext("beat-type") or 4)
            if abs(b0 * 4 / t0 - best) < 1e-6: continue
            if best == int(best): b, t = int(best), 4
            elif best * 2 == int(best * 2): b, t = int(best * 2), 8
            else: continue
            tm.find("beats").text = str(b); tm.find("beat-type").text = str(t)
        # time now in force for every measure, then lone rests
        cur_t = (4, 4); div = 1
        for m in ms:
            for a in m.findall("attributes"):
                if a.findtext("divisions"): div = int(a.findtext("divisions"))
                if a.find("time") is not None: cur_t = (int(a.findtext("time/beats") or 4), int(a.findtext("time/beat-type") or 4))
            full = cur_t[0] * div * 4 // cur_t[1]
            bystaff = {}
            for n in m.findall("note"):
                bystaff.setdefault(n.findtext("staff") or "1", []).append(n)
            kids = list(m)
            for st, ns in bystaff.items():
                if len(ns) == 1 and ns[0].find("rest") is not None and int(ns[0].findtext("duration") or 0) != full:
                    r = ns[0]; old = int(r.findtext("duration") or 0)
                    r.find("duration").text = str(full); r.find("rest").set("measure", "yes")
                    ty = r.find("type")
                    if ty is not None: ty.text = "whole"
                    i = kids.index(r)
                    if i + 1 < len(kids) and kids[i + 1].tag == "backup" and int(kids[i + 1].findtext("duration") or 0) == old:
                        kids[i + 1].find("duration").text = str(full)

repair_timing(root)
if len(sys.argv) > 3 and root.find("work/work-title") is None:
    work = ET.Element("work")
    ET.SubElement(work, "work-title").text = sys.argv[3]
    root.insert(0, work)
base.write(sys.argv[2], encoding="UTF-8", xml_declaration=True)
