/**
 * Web Audio ringtone synthesizer and Web Speech API reader.
 * Mirrors CallService (ringtone + vibration) and CallActivity (MediaPlayer / TextToSpeech).
 */

let audioCtx: AudioContext | null = null;
let ringInterval: number | null = null;
let vibrateInterval: number | null = null;
let activeOscillators: OscillatorNode[] = [];
let activeVoiceAudio: HTMLAudioElement | null = null;
let activeVoiceUrl: string | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function playRingBurst(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Soft modern melodic phone chime (two gentle arpeggiated pulses inside an 800ms window)
  const notes = [
    { freq: 587.33, start: 0, dur: 0.22 },     // D5
    { freq: 739.99, start: 0.14, dur: 0.22 },  // F#5
    { freq: 880.0, start: 0.28, dur: 0.36 },   // A5
    { freq: 1174.66, start: 0.42, dur: 0.36 }, // D6
  ];

  notes.forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + start);

    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.14, now + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);

    activeOscillators.push(osc);
    osc.onended = () => {
      activeOscillators = activeOscillators.filter((o) => o !== osc);
    };
  });
}

export function startRinging(): void {
  stopRinging();
  playRingBurst();
  ringInterval = window.setInterval(playRingBurst, 1500);

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([800, 700]);
      vibrateInterval = window.setInterval(() => {
        navigator.vibrate([800, 700]);
      }, 1500);
    } catch {
      // Vibration blocked or unsupported.
    }
  }
}

export function stopRinging(): void {
  if (ringInterval !== null) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (vibrateInterval !== null) {
    clearInterval(vibrateInterval);
    vibrateInterval = null;
  }
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch {
      // Already stopped.
    }
  });
  activeOscillators = [];

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore.
    }
  }
}

export function playTestChime(): void {
  unlockAudio();
  playRingBurst();
}

export function stopCallAudio(): void {
  if (activeVoiceAudio) {
    try {
      activeVoiceAudio.pause();
      activeVoiceAudio.currentTime = 0;
    } catch {
      // Ignore.
    }
    activeVoiceAudio = null;
  }
  if (activeVoiceUrl) {
    URL.revokeObjectURL(activeVoiceUrl);
    activeVoiceUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore.
    }
  }
}

export async function playVoiceBlob(blob: Blob): Promise<boolean> {
  stopCallAudio();
  try {
    const url = URL.createObjectURL(blob);
    activeVoiceUrl = url;
    const audio = new Audio(url);
    activeVoiceAudio = audio;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export function speakTask(caller: string, task: string): boolean {
  stopCallAudio();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(`${caller} says: ${task}`);
    utterance.rate = 0.98;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
