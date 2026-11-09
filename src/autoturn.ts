/**
 * Automatic page turn: every N seconds go to the next page, stop after the last one.
 * A manual page change restarts the countdown; while a stroke is being drawn the turn waits.
 * (`schedule` tells the screen to animate a countdown bar for that many seconds.)
 */
export class AutoTurn {
  running = false;
  private timer = 0;
  private held = false;
  private lock: { release(): Promise<void> } | null = null;
  constructor(
    private o: {
      seconds: () => number;
      /** go to the next page; false = there is none */
      next: () => boolean;
      schedule: (seconds: number) => void;
      onStop: (reason: "user" | "end") => void;
    },
  ) {
    document.addEventListener("visibilitychange", this.visible);
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.keepAwake();
    this.arm();
  }
  stop(reason: "user" | "end" = "user") {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    void this.lock?.release().catch(() => {});
    this.lock = null;
    this.o.onStop(reason);
  }
  /** the person turned the page: count again from here */
  reset() {
    if (this.running) this.arm();
  }
  /** a stroke is in progress: do not turn under the pen */
  hold(on: boolean) {
    this.held = on;
  }
  dispose() {
    this.running = false;
    clearTimeout(this.timer);
    void this.lock?.release().catch(() => {});
    document.removeEventListener("visibilitychange", this.visible);
  }

  private arm() {
    clearTimeout(this.timer);
    const s = Math.max(1, this.o.seconds());
    this.o.schedule(s);
    this.timer = window.setTimeout(this.fire, s * 1000);
  }
  private fire = () => {
    if (!this.running) return;
    if (this.held) {
      this.timer = window.setTimeout(this.fire, 600);
      return;
    }
    if (!this.o.next()) return this.stop("end");
    this.arm();
  };
  private async keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.lock = (await wl?.request("screen")) ?? null; // the screen must not go dark while the music turns by itself
    } catch { /* not available: fine */ }
  }
  private visible = () => {
    if (this.running && document.visibilityState === "visible" && !this.lock) void this.keepAwake();
  };
}
