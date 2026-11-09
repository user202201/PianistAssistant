/**
 * Trial + one-time purchase (iOS store build only).
 *
 * The App Store takes the money and keeps the receipts; the app only asks the device "does this person own the unlock?" and
 * "when was the app first downloaded?" through a tiny native plugin (`PianistStore`, mobile/ios-store/). Nothing is sent to us, no server.
 * Without that plugin (web, Android, HarmonyOS, developer builds) there is no trial and nothing is ever locked.
 *
 * App Store free trials exist only for subscriptions, so the 14 days are counted by the app, from the date Apple reports for the
 * first download (StoreKit `AppTransaction.originalPurchaseDate`) – reinstalling does not restart the trial.
 */
export const TRIAL_DAYS = 14;
const DAY = 86_400_000;

interface StorePlugin {
  /** firstInstall: ms since 1970 of the first download (if the device can tell), owned: the unlock was bought, price: localised */
  status(): Promise<{ firstInstall?: number; owned: boolean; price?: string }>;
  purchase(): Promise<{ owned: boolean; cancelled?: boolean }>;
  restore(): Promise<{ owned: boolean }>;
}
export type Access = { kind: "free" } | { kind: "owned" } | { kind: "trial"; daysLeft: number } | { kind: "expired" };

function plugin(): StorePlugin | undefined {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, StorePlugin>; getPlatform?: () => string; registerPlugin?: (n: string) => StorePlugin } }).Capacitor;
  if (!cap) return undefined;
  return cap.Plugins?.PianistStore ?? (cap.getPlatform?.() === "ios" ? cap.registerPlugin?.("PianistStore") : undefined);
}
/** true in the iOS store app (the only place with a trial) */
export const hasStore = () => !!plugin();

let price = "";
export const unlockPrice = () => price;

function localFirstSeen(): number {
  try {
    const k = "pianist.firstSeen.v1";
    const v = Number(localStorage.getItem(k));
    if (v > 0) return v;
    const now = Date.now();
    localStorage.setItem(k, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

export function accessFrom(first: number, owned: boolean, now = Date.now()): Access {
  if (owned) return { kind: "owned" };
  const left = TRIAL_DAYS - (now - first) / DAY;
  return left > 0 ? { kind: "trial", daysLeft: Math.max(1, Math.ceil(left)) } : { kind: "expired" };
}

export async function access(): Promise<Access> {
  const p = plugin();
  if (!p) return { kind: "free" };
  try {
    const s = await p.status();
    if (s.price) price = s.price;
    return accessFrom(s.firstInstall && s.firstInstall > 0 ? s.firstInstall : localFirstSeen(), !!s.owned);
  } catch {
    return accessFrom(localFirstSeen(), false); // the store could not be asked (offline): count the trial on this device
  }
}

/** true = bought (false = cancelled by the person); throws when the store fails */
export async function purchase(): Promise<boolean> {
  const p = plugin();
  if (!p) throw new Error("store unavailable");
  return !!(await p.purchase()).owned;
}
export async function restore(): Promise<boolean> {
  const p = plugin();
  if (!p) throw new Error("store unavailable");
  return !!(await p.restore()).owned;
}
