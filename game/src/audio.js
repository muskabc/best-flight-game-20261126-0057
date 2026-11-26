// audio.js — tiny WebAudio synth: engine hum, ring chime, touchdown thud, crash.
// No audio files; every sound is generated. Starts on the first user gesture.

export function makeAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let propOsc = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 55;
    propOsc = ctx.createOscillator();
    propOsc.type = "square";
    propOsc.frequency.value = 110;
    const propGain = ctx.createGain();
    propGain.gain.value = 0.35;
    engineOsc.connect(filter);
    propOsc.connect(propGain);
    propGain.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();
    propOsc.start();
    return true;
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 700;
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t);
  }

  return {
    unlock() { if (ensure() && ctx.state === "suspended") ctx.resume(); },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.value = 0; },
    isMuted() { return muted; },
    // Called every frame while flying: pitch and loudness follow the throttle.
    engine(throttle, speed, running) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const base = running ? 48 + throttle * 95 + speed * 0.35 : 0;
      engineOsc.frequency.setTargetAtTime(Math.max(30, base), t, 0.08);
      propOsc.frequency.setTargetAtTime(Math.max(60, base * 2.02), t, 0.08);
      engineGain.gain.setTargetAtTime(running ? 0.05 + throttle * 0.1 : 0, t, 0.1);
    },
    ring() { blip(880, 0.22, "sine", 0.2); setTimeout(() => blip(1320, 0.3, "sine", 0.16), 90); },
    touchdown() { noiseBurst(0.18, 0.25); blip(90, 0.25, "sine", 0.2, 55); },
    crash() { noiseBurst(0.7, 0.5); blip(140, 0.6, "sawtooth", 0.22, 40); },
    warning() { blip(620, 0.14, "square", 0.07); },
    success() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.3, "triangle", 0.18), i * 130)); },
    click() { blip(700, 0.06, "triangle", 0.1); },
  };
}
