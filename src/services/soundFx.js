// ─── Cyber Terminal Sound FX Engine (Web Audio API) ────────────────────────
// Pure client-side synthesizer: zero external audio assets required.

let audioCtx = null;
let isMuted = typeof window !== "undefined" ? localStorage.getItem("btc_desk_sfx_muted") === "true" : false;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const SoundFX = {
  isMuted() {
    return isMuted;
  },

  setMuted(muted) {
    isMuted = muted;
    if (typeof window !== "undefined") {
      localStorage.setItem("btc_desk_sfx_muted", String(muted));
    }
  },

  toggleMute() {
    this.setMuted(!isMuted);
    return isMuted;
  },

  // 1. Radar Ping / Sonar sweep when scanning opportunities
  playRadarPing() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.18);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Audio context might be blocked prior to user gesture
    }
  },

  // 2. Success / Target Locked / Trade Executed Chime (Major Triad Chord)
  playSuccessChime() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.05);

        gain.gain.setValueAtTime(0.06, ctx.currentTime + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.05 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.05);
        osc.stop(ctx.currentTime + idx * 0.05 + 0.35);
      });
    } catch {}
  },

  // 3. Warning Siren / Defense Mode Beep (Two-tone pulse)
  playWarningAlert() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      [0, 0.12].forEach((delay, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(idx === 0 ? 587.33 : 440, ctx.currentTime + delay);

        gain.gain.setValueAtTime(0.05, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.1);
      });
    } catch {}
  },

  // 4. Subtle Tactile Cyber Click
  playClick() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.03);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.03);
    } catch {}
  }
};
