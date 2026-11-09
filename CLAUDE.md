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
6. **Tests.** Playwright suites live outside the repo (scratchpad); keep adding a suite for each new feature and run all before pushing.
7. **Answer the user in Chinese, step by step, and be honest about what could not be tested** (real iPad, real piano samples, real Apple/Google accounts).
