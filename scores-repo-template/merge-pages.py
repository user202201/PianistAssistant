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
if len(sys.argv) > 3 and root.find("work/work-title") is None:
    work = ET.Element("work")
    ET.SubElement(work, "work-title").text = sys.argv[3]
    root.insert(0, work)
base.write(sys.argv[2], encoding="UTF-8", xml_declaration=True)
