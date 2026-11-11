/**
 * A small error log kept ON THE DEVICE (the last 30 problems: what went wrong, when, where in the app). Nothing is sent by itself: the feedback dialog
 * can attach it to the e-mail the user writes, and the user sees what is attached. Tokens, addresses with access keys and file names between the Chinese quotation marks are removed.
 */
const KEY = "pianist.errlog.v1";
const MAX = 30;
export interface ErrEntry { t: number; msg: string; where: string; stack?: string }

/** take out what must not leave the device */
export function scrub(s: string): string {
  return s
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[token]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [token]")
    .replace(/([?&#](?:token|access_token|key|auth)=)[^&\s]+/gi, "$1[removed]")
    .replace(/\u300c[^\u300d]*\u300d/g, "[name]")
    .replace(/\/repos\/[^/\s]+\/[^/\s]+/g, "/repos/[owner]/[repo]");
}

export function getLog(): ErrEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ErrEntry[]; } catch { return []; }
}
export function clearLog() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function record(e: unknown, where = ""): void {
  try {
    const err = e as { message?: string; stack?: string } | string | undefined;
    const msg = scrub(String(typeof err === "string" ? err : err?.message ?? err ?? "error")).slice(0, 300);
    const stack = typeof err === "object" && err?.stack ? scrub(String(err.stack)).split("\n").slice(0, 5).join("\n").slice(0, 600) : undefined;
    const log = getLog();
    const last = log[log.length - 1];
    if (last && last.msg === msg && Date.now() - last.t < 2000) return; // the same error again at once: once is enough
    log.push({ t: Date.now(), msg, where: scrub(where || location.hash.replace(/^#\/?/, "").split("/")[0] || "home"), stack });
    localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX)));
  } catch { /* storage full / private mode: no log, no harm */ }
}

/** the log as text for an e-mail (the newest first, at most `max` characters) */
export function formatLog(max = 1500): string {
  const lines = getLog().slice().reverse().map((x) => `${new Date(x.t).toISOString().slice(0, 19).replace("T", " ")} [${x.where}] ${x.msg}${x.stack ? "\n" + x.stack : ""}`);
  let out = "";
  for (const l of lines) { if ((out + l).length > max) break; out += l + "\n"; }
  return out.trim();
}

/** record everything the page does not catch itself */
export function startErrorLog() {
  window.addEventListener("error", (ev) => record(ev.error ?? ev.message, "uncaught"));
  window.addEventListener("unhandledrejection", (ev) => record((ev as PromiseRejectionEvent).reason ?? "rejected promise", "promise"));
}
