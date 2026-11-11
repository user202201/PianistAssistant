# TODO / ideas (not started)

Things that were discussed and are **not built yet**. When one of them is picked up: follow `CLAUDE.md` (translations in all 5 languages, tests that fail on
the old code, layout suites, screenshots) and move it out of this file.

## 1. Apple Pencil: write the finger number by hand
Today the Pencil only *taps* (a note, then a number button), like a finger. Idea: in the fingering edit mode write the digit 1–5 next to a note with the Pencil and
recognise it (small stroke-based recogniser for 5 digits, no library). Needs a real iPad + Pencil to tune; ask before building.

## 2. Offline PDF → score on the device (store app)
**Licence check (2026-11-11, read from the projects' own README / LICENSE_FAQ, not legal advice):** homr is AGPL-3.0 (same as Audiveris), its weights are AGPL too "but the AGPL can't grant more rights than the training data allows"; the training data include Camera-PrIMuS (CC BY-NC on the Hugging Face copy = non-commercial) and the maintainers say whether that carries over to the weights is an open legal question; no commercial licence is offered. oemer: licence NOT confirmed (the "MIT" in the older note below is unverified), no licence stated for its checkpoints or its datasets (CvcMuscima-Distortions, DeepScores-extended). => homr has NO licence advantage over Audiveris; neither is clean to ship inside a store app. Today they only run in the user's own repository (cloud), nothing of them is distributed by the app. Do not embed any engine before a proper legal review.
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
- **Done so far (step 0/1):** hidden switch-on (10 taps on the note, popups), Practice/Game switch in the score top bar, neon game theme (`:root[data-game="1"]`: fluorescent blue + glow).
- **Hands**: the hand choice (both / right / left, per pane for four hands) stays in game mode and decides which notes fall / count.
- **Done (score mode):** Demo / Score switch in the panel, MIDI input (`src/midi.ts`: Web MIDI on desktop / Android Chrome; the iOS app has the native `PianistMidi` plugin, `mobile/ios-store/PianistMidiPlugin.swift`, with the system Bluetooth-pairing screen), timing judgement (`src/gamescore.ts`: Perfect / Good / Early / Late / Miss / wrong key, combo, accuracy, stars, levels easy / normal / hard), floating score window (`src/gamehud.ts`), judgement words + flares on the keys. READY / GO start.
- **Microphone (acoustic piano):** `src/mic.ts` listens only for the notes that are due (fundamental energy + sudden rise, neighbour-semitone check, re-arm), button in the piano card. Tested with a fake microphone playing synthetic tones, NOT with a real piano: real pianos have inharmonicity / noise / room; expect to tune thresholds. Cannot see wrong keys (only due notes are listened for), octave confusion possible.
- **Not tested on real hardware:** a real MIDI piano on a real iPad (native plugin only compiled in CI), Android WebView (the Android app) may not offer Web MIDI.
- **Still open:** touch keyboard for big screens, microphone input, saving best scores, latency calibration ("my piano feels late"), a proper result page.
- Open question: names for the screens ("Practice" / "Game"; the falling-note view "Waterfall").

## 5. Game: saving scores (nice-to-have, decided: not now)
Plan if we do it: store per piece (key = file name + hand/part choice + level) the **best score, best accuracy, stars, last 10 results (date, score, accuracy, max combo)** in `settings`-like localStorage `pianist.scores.v1`, and — only in GitHub mode — also in the scores repo as `history/<name>.json` through `src/api.ts` (so backup/restore already includes it). Show: a small "best ★★★ 92 %" line on the card in the result popup, and in the score's menu a "history" list (one row per result, tiny sparkline). Delete with the piece; "clear history" in Settings. Merge rule when two devices wrote: keep the best, union the last-10 by date. Test: play demo twice, reload, check the best/last values; layout suites for the new list. Texts in 6 languages.

## 6. Game: on-screen touch keyboard — feasibility notes (not building now)
Concerns to settle before building:
- **Finger vs key size**: a white key must be ≥ ~9 mm wide to be hit reliably. On a phone in landscape (~6 cm of width per octave at best) only ~1.5–2 octaves fit, black keys are too small → large screens (tablet ≥ 10") only, or a limited range (the range of the piece, scrollable).
- **Which key is pressed**: use pointer events per touch (`pointerdown` with `pointerId`), hit-test against key rectangles (black keys first); sliding finger = new key (glissando) must be a design choice; the touch contact area is large, so judge by the touch centre.
- **Simultaneous touches**: iPadOS reports up to ~11 touches, many Android phones 5–10, some cheap devices only 2–5; Safari may swallow gestures with 5 fingers (system gestures). We need **10 fingers for chords with both hands** → add a one-time **multi-touch diagnostic** ("put all fingers on the screen": counts max `pointers`) and show the result; if < 4, warn that chords may be missed.
- **Latency/feel**: no haptics on iPad; sound latency of WebAudio is the dominant delay (use the existing latency compensation).
- Test plan: Playwright `touchscreen` / CDP `Input.dispatchTouchEvent` with several touch points (chords, glissando, edge keys), WebKit run, real-device check by the user.

## 7. Four hands: align the bars of A and B (user request, idea stage)
Both parts are laid out independently, so bar lines of A and B do not line up (different notes per bar -> different widths). Helps when two players read together / a teacher points at "bar 13". Options: (a) setting "align bars" = same number of bars per system for both parts (OSMD `RenderXMeasuresPerLine`-style, same value in both panes, user picks 2/3/4/auto), simple and robust; (b) fixed bar width (equal width for every bar, wasteful for dense bars); (c) true alignment (take the wider of A/B for each bar and pad the other) — needs custom layout, large. Recommended: (a), in Settings, default off. Test: bar numbers at the start of each system equal in both panes.

## 8. Jianpu (numbered notation, 简谱) — user request. PHASE 1 DONE (src/jianpu.ts, Settings -> "显示简谱", default off; digits are written as lyrics into the drawn copy, so one row at the same height under every staff; test 67-jianpu). Chords: highest note only. Phase 2 (durations) open.
Convention to confirm with a Chinese teacher: movable-do (首调): 1 = tonic of the key signature (relative major for minor keys, e.g. A minor -> 1 = C, so A is 6), accidentals as ♯/♭ in front, octave dots above/below (combining dots U+0307 / U+0323), rests 0.
- **Phase 1 (about a day): a digit under every note** on the staff, drawn by the same overlay as the fingering numbers (they already follow the notes, zoom, four hands, hand selection). Own colour / small size so it is not mixed up with fingerings; switch in the bottom bar (or an option of the fingering button); key changes per measure from `<key><fifths>`. Test: C major scale -> 1 2 3 4 5 6 7, A minor starts 6 7 1, accidentals, octave dots, key change, four hands.
- **Phase 2 (a few days, optional): a real jianpu line / view** with durations (dashes for longer notes, underlines for shorter), bar lines, line breaks per measure, replacing or sitting under each staff system. Needs its own layout, the OSMD system geometry gives the measure x-ranges to align with.
- Not covered: fixed-do, lyrics under jianpu, complicated tuplets in phase 1.
