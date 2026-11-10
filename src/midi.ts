/**
 * Input from a MIDI keyboard / digital piano. Two ways in, the same events out:
 *  - Web MIDI (desktop Chrome / Edge, Android Chrome): `navigator.requestMIDIAccess`;
 *  - the iOS app: a small native plugin (`PianistMidi`, mobile/ios-store/) because iPad Safari has no Web MIDI.
 * Nothing is sent anywhere: the notes are only used on the device.
 */
export interface MidiNote {
  type: "on" | "off";
  note: number;
  velocity: number;
  /** performance.now() clock (ms) at which the key was struck (as exactly as the source tells) */
  time: number;
}
export interface MidiState {
  /** "unsupported": this browser cannot do MIDI; "off": not started; "none": started, no keyboard found; "ready": at least one keyboard */
  kind: "unsupported" | "off" | "none" | "ready" | "denied";
  devices: string[];
  backend: "native" | "web" | null;
}

interface NativeMidi {
  start(): Promise<{ devices: string[] }>;
  stop(): Promise<void>;
  devices(): Promise<{ devices: string[] }>;
  showBluetoothUI(): Promise<void>;
  addListener(ev: string, fn: (d: never) => void): Promise<{ remove(): void }> | { remove(): void };
}
type WebMidiInput = { name?: string | null; onmidimessage: ((e: { data: Uint8Array; timeStamp: number }) => void) | null };
type WebMidiAccess = { inputs: Map<string, WebMidiInput> | { values(): Iterable<WebMidiInput> }; onstatechange: (() => void) | null };

function nativePlugin(): NativeMidi | undefined {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, NativeMidi>; getPlatform?: () => string; registerPlugin?: (n: string) => NativeMidi } }).Capacitor;
  if (!cap) return undefined;
  return cap.Plugins?.PianistMidi ?? (cap.getPlatform?.() === "ios" ? cap.registerPlugin?.("PianistMidi") : undefined);
}

/** Turn the raw bytes of one MIDI message into a note event (or null for everything that is not a key press / release). */
export function parseMidi(data: ArrayLike<number>, time: number): MidiNote | null {
  if (data.length < 3) return null;
  const kind = data[0] & 0xf0;
  if (kind !== 0x90 && kind !== 0x80) return null;
  const note = data[1], velocity = data[2];
  return { type: kind === 0x90 && velocity > 0 ? "on" : "off", note, velocity, time };
}

export class MidiInput {
  private state: MidiState = { kind: "off", devices: [], backend: null };
  private access: WebMidiAccess | null = null;
  private handlers = new Set<(n: MidiNote) => void>();
  private watchers = new Set<(s: MidiState) => void>();
  private native: NativeMidi | undefined;

  /** is there any way to read a keyboard on this device (the button "connect" is only shown then) */
  static available(): boolean {
    return !!nativePlugin() || (typeof navigator !== "undefined" && typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess === "function");
  }
  get isNative() { return !!nativePlugin(); }
  status(): MidiState { return this.state; }
  onNote(fn: (n: MidiNote) => void) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onState(fn: (s: MidiState) => void) { this.watchers.add(fn); return () => this.watchers.delete(fn); }
  private set(s: MidiState) { this.state = s; this.watchers.forEach((f) => f(s)); }
  private emit(n: MidiNote | null) { if (n) this.handlers.forEach((f) => f(n)); }

  async start(): Promise<MidiState> {
    if (this.state.kind === "ready" || this.state.kind === "none") return this.state;
    const nat = nativePlugin();
    if (nat) {
      this.native = nat;
      try {
        await nat.addListener("midi", ((d: { type: "on" | "off"; note: number; velocity: number }) => this.emit({ type: d.type, note: d.note, velocity: d.velocity, time: performance.now() })) as never);
        await nat.addListener("devices", ((d: { devices: string[] }) => this.set({ kind: d.devices.length ? "ready" : "none", devices: d.devices, backend: "native" })) as never);
        const r = await nat.start();
        this.set({ kind: r.devices.length ? "ready" : "none", devices: r.devices, backend: "native" });
      } catch {
        this.set({ kind: "unsupported", devices: [], backend: null });
      }
      return this.state;
    }
    const req = (navigator as unknown as { requestMIDIAccess?: (o?: { sysex: boolean }) => Promise<WebMidiAccess> }).requestMIDIAccess;
    if (typeof req !== "function") { this.set({ kind: "unsupported", devices: [], backend: null }); return this.state; }
    try {
      this.access = await req.call(navigator, { sysex: false });
    } catch {
      this.set({ kind: "denied", devices: [], backend: "web" });
      return this.state;
    }
    const attach = () => {
      const names: string[] = [];
      const ins = this.access!.inputs as { values(): Iterable<WebMidiInput> };
      for (const input of ins.values()) {
        names.push(input.name || "MIDI");
        input.onmidimessage = (e) => this.emit(parseMidi(e.data, e.timeStamp));
      }
      this.set({ kind: names.length ? "ready" : "none", devices: names, backend: "web" });
    };
    this.access.onstatechange = attach; // a piano plugged in or out later
    attach();
    return this.state;
  }

  /** iOS app: the system screen to pair a Bluetooth MIDI keyboard */
  async pairBluetooth() { try { await nativePlugin()?.showBluetoothUI(); } catch { /* ignore */ } }

  async stop() {
    try { await this.native?.stop(); } catch { /* ignore */ }
    if (this.access) { for (const i of (this.access.inputs as { values(): Iterable<WebMidiInput> }).values()) i.onmidimessage = null; this.access.onstatechange = null; }
    this.access = null;
    this.set({ kind: "off", devices: [], backend: null });
  }
}

/** one shared input for the whole app */
export const midi = new MidiInput();
