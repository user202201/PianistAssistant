# Pianist Assistant — standing rules for every change

1. **Languages.** The UI is Chinese / English / French (`src/i18n.ts`, texts in `src/i18n-data.ts`, keyed by the Chinese source text).
   Every new or changed UI text must get an English and a French entry. `npm run check:i18n` (part of `npm run build` and of the
   deploy workflow) fails when one is missing.
2. **Always build before pushing:** `npx tsc --noEmit && BASE_PATH=/ npx vite build` (a CSS typo once passed dev and broke the build).
3. **Web must keep working.** The GitHub Pages site (`/PianistAssistant/`) and the mobile packages (relative base, see `mobile/`) are built
   from the same code. Do not add anything that only works at one of them (absolute asset paths, server-only features).
4. **Storage.** Data access goes through `src/api.ts` only (`list` / `getBytes` / `put` / `remove`). Keep it that way so another backend
   (offline cache, on-device storage for the mobile apps) can be swapped in without touching the UI.
5. **Automate.** Anything that has to be done on every release (packaging, translations check, deploy) belongs in a workflow or script,
   not in a to-do list for the user.
6. **Tests.** The end-to-end suites are in `tests/` (see `tests/README.md`); `npm run test:e2e` runs them, and the mobile packaging workflow runs them first and
   only builds when they pass. Every new feature and every fixed bug gets a suite (or a check) in the same change, and the test must fail on the old code.
7. **Answer the user in Chinese, step by step, and be honest about what could not be tested** (real iPad, real piano samples, real Apple/Google accounts).
8. **PDF conversion quality is measured, not guessed.** `.github/workflows/ocr-lab.yml` converts PDFs made from known scores (`samples/ocr-lab/`)
   and prints a per-measure comparison. Before changing `scores-repo-template/convert-one.sh`, run it (Actions → ocr-lab) and compare.
   Known: Audiveris is near-perfect on clean PDFs; the full English Tesseract model is needed for titles; a last system without a final barline is lost.
9. **Going private / paid services.** `docs/going-private/README.md` is the user's self-service guide. Keep `scores-repo-bundle.zip` (built by
   `scripts/make-scores-repo-bundle.sh`) in sync with `scores-repo-template/`; the user copies it into the scores repo once.
10. **Every action answers.** Each user action that takes time or changes data shows a message through `toast()` in `src/main.ts`: `working=true` (spinner)
    while it runs, closed when done, then a result message (or the error). Messages are always in the top band (a popover above dialogs), never elsewhere.
    Cancelling a confirmation must not produce a "done" message. Add the English / French texts.
11. **Store builds are local-only.** `mobile/scripts/build-*.sh` build with `LOCAL_ONLY=1` (no account, no GitHub, nothing leaves the device).
    The privacy policy is `public/privacy/index.html`; the feedback mail address comes from the repository variable `FEEDBACK_EMAIL`.
12. **Fingering logic is documented.** `docs/fingering-logic.md` explains how `src/fingering.ts` produces its suggestions (for teachers / professionals who ask). Change both together.
