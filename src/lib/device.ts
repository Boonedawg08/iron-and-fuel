/** Small wrappers around phone features that may be missing: screen wake lock, sound, vibration. */
import { useEffect } from 'react';

/** Keeps the screen on while `active` is true. Silently does nothing where unsupported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release().catch(() => {});
        else lock = l;
      } catch { /* denied, low battery or unsupported: the app works without it */ }
    };
    // The lock is dropped whenever the page is hidden, so take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

let audio: AudioContext | null = null;
/**
 * Phones only allow sound that starts from a tap. Call this from a tap handler (checking off a set)
 * so a later, timer-driven beep is allowed to play.
 */
export function unlockAudio(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* sound is best-effort */ }
}

/** Two short tones plus a vibration (Android). No-op if the phone refuses. */
export function alertDone(): void {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* unsupported */ }
  try {
    const ctx = audio;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + i * 0.22);
      osc.stop(t0 + i * 0.22 + 0.2);
    });
  } catch { /* sound is best-effort */ }
}
