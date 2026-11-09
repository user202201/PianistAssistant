# TODO / ideas (not started)

Things that were discussed and are **not built yet**. When one of them is picked up: follow `CLAUDE.md` (translations in all 5 languages, tests that fail on
the old code, layout suites, screenshots) and move it out of this file.

## 1. Sorting of the home lists  (decided: a *global* setting)
**Now:** every tab lists its items by name only, ascending (`localeCompare(..., "zh")`: digits, then A–Z ignoring case, then Chinese by pinyin).
The "Recently opened" row above the tabs is separate (last 4 opened, newest first, kept on this device).

**Wanted:** ONE small control at the right end of the tab bar (an icon, a small menu). It sets the order for **all four tabs at once** (global, remembered on the device).
- Name: A → Z / Z → A
- Recently used: just opened first / oldest first
- Date added: newest first / oldest first
- (open question) direction as one ↑↓ toggle next to the criterion, or two entries per criterion in the menu.

**What it needs / the catch**
- *Recently used*: store a timestamp per item when it is opened (device only; items never opened go last, by name). Starts counting from the update.
- *Date added*: the GitHub list API gives only name + size, no dates; asking for the commit date of every file is too slow for a big library. So: remember the time **this device first saw** the item
  (exact for what this device uploads / converts, approximate for what was already there: all of that counts as one time).
- Four-hand pairs, scores and PDFs are sorted together in "All" and "Favourites" (as now). Maybe an option "four hands first".
- PDFs are sorted by file name **including** `.pdf` (scores without extension): make them consistent while at it.
- Setting lives in `src/settings.ts`, the sort in `renderList()` of `src/main.ts`; the data stays behind `src/api.ts` (rule 4).
- Tests: order per criterion and direction, remembered after reload, all four tabs follow the same setting, nothing changes for the default.

## 2. Apple Pencil: write the finger number by hand
Today the Pencil only *taps* (a note, then a number button), like a finger. Idea: in the fingering edit mode write the digit 1–5 next to a note with the Pencil and
recognise it (small stroke-based recogniser for 5 digits, no library). Needs a real iPad + Pencil to tune; ask before building.

## 3. Offline PDF → score on the device (store app)
Cloud conversion (Audiveris / homr / oemer) needs the internet. For the store app a licence-clean engine (oemer, MIT) would have to run on the device
(ONNX models ~100 MB + post-processing). Go / no-go after the measured accuracy of oemer (workflow `ocr-lab-deep`) and the model-weight licence check.

## 4. Things only a real device / account can confirm
- Apple Pencil feel (pressure, palm, scrolling), full-screen and keep-awake on a real iPad; the unsigned `.ipa` sideload; StoreKit trial + purchase in TestFlight (sandbox).
- The German / Japanese / Korean translations were made by an AI: let a native speaker read the main screens before a release.
- Privacy policy page and App Store listing (name, description, keywords, screenshots) in German / Japanese / Korean.
- Piano sounds for the store app: sizes (workflow `sound-sizes`), which ones to pack in, whether to offer downloading more.

## 5. Smaller ideas
- Part menu of four hands closes after a choice (now only when tapping elsewhere).
- "Four hands first" option in the lists; counts / icons on the tabs (still in the markup, hidden with CSS).
