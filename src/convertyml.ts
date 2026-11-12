// The file that makes a repository convert PDFs (.github/workflows/convert.yml) comes from scores-repo-template/, the single source of truth: the app carries a copy
// of it, so the user does not have to find, open and copy anything: one button opens GitHub's "new file" page of THEIR repository with the name and the content filled in.
import yml from "../scores-repo-template/.github/workflows/convert.yml?raw";

export const CONVERT_YML_PATH = ".github/workflows/convert.yml";

/** GitHub's "create new file" page for this repository, file name and content already filled in (the user only presses "Commit changes"). */
export function createConvertYmlUrl(repo: string, branch = "main"): string {
  return `https://github.com/${repo}/new/${encodeURIComponent(branch)}?filename=${encodeURIComponent(CONVERT_YML_PATH)}&value=${encodeURIComponent(yml)}`;
}
export const convertYmlText = (): string => yml;
