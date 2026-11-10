# TODO / ideas (not started)

Things that were discussed and are **not built yet**. When one of them is picked up: follow `CLAUDE.md` (translations in all 5 languages, tests that fail on
the old code, layout suites, screenshots) and move it out of this file.

## 1. Apple Pencil: write the finger number by hand
Today the Pencil only *taps* (a note, then a number button), like a finger. Idea: in the fingering edit mode write the digit 1–5 next to a note with the Pencil and
recognise it (small stroke-based recogniser for 5 digits, no library). Needs a real iPad + Pencil to tune; ask before building.

## 2. Offline PDF → score on the device (store app)
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

## 3. Listen to the player and score (practice check-in)  — big project, ask before building
Idea (user): like "虫虫钢琴": the app listens (microphone) while you play along with the score, then shows how much you completed and whether you kept up, with a score.
- Core: pitch detection from the microphone (polyphonic is hard; start with single notes / one hand, or use MIDI keyboards via Web MIDI, which is exact and easy on desktop / Android, NOT on iOS Safari).
- Compare played notes with the expected notes at the expected time (tolerance window), per measure: hit / wrong / missed / late. Result: percentage, per-measure heat map, history per piece (practice log / streak).
- Needs real-device testing (room noise, speaker feedback: the app's own playback must be muted while listening, latency differs per device). Not testable in the sandbox.

## 4. "Game mode" (decided direction, plan below; not started)
A **练习 / 游戏 (Practice / Game) toggle** in the empty middle of the top bar of the score screen. Practice = exactly today's screen. Game = a different lower part:
- **Views inside game mode** (a second small switch): ① *Falling notes* (notes fall onto a keyboard, keys glow blue/green when to play – like the 3rd/4th picture), ② *Score + keyboard* (one or two lines of score on top, keyboard below with the current notes lit – like the 2nd picture), ③ combined (small score strip on top, falling notes below).
- **Keyboard**: on-screen piano (88 or the range of the piece, scrollable on phones), keys of the notes to play glow; touching a key plays the sound (existing smplr sounds).
- **Start**: big Play → "Ready … Go" countdown (reuse the count-in bar of the metronome) → notes come down at the tempo of the piece (speed slider as today).
- **Scoring (timing is what matters)**: each expected note has a time window; Perfect ≤ 60 ms, Good ≤ 120 ms, Late/Early ≤ 250 ms, else Miss; wrong key = wrong note. Combo, accuracy %, stars at the end, per-measure result. Chords: all notes of the chord within the window. Hands: choose right / left / both (the existing hand switch decides which notes count).
- **Input order**: (1) touch keyboard (works on every device, testable in Playwright with fake touches), (2) Web MIDI keyboard (desktop/Android), (3) microphone (item 3, hard, real-device only).
- **Steps**: A) keyboard component + falling-note canvas, auto-play only (no scoring) → B) touch input + scoring + result screen → C) MIDI → D) microphone. Each step with a test; new texts in 6 languages; layout suites for phone/tablet.
- Open question: names for the screens ("Practice" / "Game"; the falling-note view "Waterfall").
