# End-to-end tests

Browser tests (Playwright + Chromium, iPad-sized window, touch) against the app running with a **pretend GitHub** (`e2e/harness.cjs`
answers the GitHub API from memory), so nothing real is touched. One file per feature or bug that was ever reported
(`suites.txt` lists them; the number in the name is the order in which they were written):

- every feature from the user's requests (upload, same-name questions, pairing, four-hand split view, fingering, PDF keep / view / convert,
  languages, offline copy, on-device storage, favourites, messages, count-in, feedback mail ...)
- one test per bug that came back from the user (stars not lighting up, blank part after folding, lines cut off, messages stacking ...)

Run everything: `npm run test:e2e` (about 10 minutes). One suite: `tests/run-all.sh 30-fold-resize-blank`.
On every push that changes the app, GitHub runs all of it (`.github/workflows/tests.yml`); **the mobile packages are built only when it passes**.

Rules: a new feature or a fixed bug gets a suite (or a check in an existing one) in the same change; a test must fail on the old code
(check it before trusting it). Fixtures are in `fixtures/`; output (screenshots, logs) goes to `tests/out/` (ignored by git).
Not testable here: a real iPad / iPhone (safe areas are emulated), real piano sounds, real Apple / Google accounts, real homr / Audiveris runs
(those are measured by the OCR lab workflows).

## Converter script (no browser)
`tests/shell/convert-script.sh` runs `scores-repo-template/convert.sh` against fake Audiveris / homr / oemer programs: which engine handles which
file, how results are named (`X.musicxml`, `X [homr].musicxml`, `X [oemer].musicxml`), that engine notes are cleaned up, that an unreadable PDF
fails with a message and does not stop the other files. `run-all.sh` runs it first when no suite names are given.

## Languages and layout
The UI has six languages (zh, en, fr, de, ja, ko). `37-layout-de/ja/ko` open the main screens (home, settings, feedback, PDF dialog, player + panels, four hands,
PDF viewer + annotation tools + seconds dialog, unlock dialog) on a tablet, an iPad in portrait and a small phone (360 px) and fail on: text pushed off screen /
clipped / spilling out of its button, overlapping buttons, a page wider than the screen, or a text that is still Chinese. They also save screenshots
(`tests/out/work/layout-*.png`) — **look at them** when a screen is new. `src/fit.ts` is the safety net for long texts: smaller font → tighter spacing →
a segmented control becomes a drop-down; single-line buttons shrink their text a little (never below 78 %).
