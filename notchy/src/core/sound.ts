// WebAudio player with the same API and defaults as Coucou's SoundEngine:
// master gain 0.12 (slider 0–0.2), overlapping sounds, the context suspended
// 1.5 s after the last sound so a quiet island costs no CPU.
//
// Sounds are read from /sounds/<name>.wav (public/sounds). The folder ships
// empty: a missing file is simply silent. See README.md for what to put there.

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "finish", "error", "send", "love", "pop", "proud", "wink", "yawn",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

class SoundEngine {
  enabled = true;
  volume = 0.12;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;

  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (typeof window === "undefined" || !window.AudioContext) return;
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.wav`);
            if (!res.ok) return;
            this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // No file, or not a sound: stays silent.
          }
        }),
      );
    })();
    return this.loading;
  }

  play(name: string) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    this.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.start();
  }

  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  /** The island went quiet: suspend the audio thread a moment later. */
  idle() {
    if (!this.ctx || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.ctx?.state === "running") void this.ctx.suspend();
    }, 1500);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(0.2, v));
    if (this.master) this.master.gain.value = this.volume;
  }
}

export const Sound = new SoundEngine();
