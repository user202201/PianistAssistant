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
