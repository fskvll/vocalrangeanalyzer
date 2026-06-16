'use strict';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const VOICE_TYPES = [
  {
    name: 'Bass',
    lowMidi: 40, highMidi: 64,
    desc: 'The deepest male voice. Thick and powerful, sitting at the very bottom of the choir.',
  },
  {
    name: 'Baritone',
    lowMidi: 45, highMidi: 69,
    desc: 'The most common male voice. Sits comfortably in the middle register, warm and flexible.',
  },
  {
    name: 'Tenor',
    lowMidi: 48, highMidi: 72,
    desc: 'The highest common male voice. Bright and carrying, usually the lead in opera and pop.',
  },
  {
    name: 'Alto',
    lowMidi: 53, highMidi: 77,
    desc: 'The deepest female voice. Dark and rich with a strong lower register.',
  },
  {
    name: 'Mezzo-Soprano',
    lowMidi: 57, highMidi: 81,
    desc: 'A middle female voice. Has the depth of an alto but can reach up into soprano territory.',
  },
  {
    name: 'Soprano',
    lowMidi: 60, highMidi: 84,
    desc: 'The highest female voice. Clear and bright at the top, typically the lead melody.',
  },
];

function detectPitch(inputBuf, sampleRate) {
  const MIN_FREQ = 50;
  const MAX_FREQ = 1100;
  const MAX_LAG = Math.ceil(sampleRate / MIN_FREQ);
  const MIN_LAG = Math.floor(sampleRate / MAX_FREQ);

  let rms = 0;
  for (let i = 0; i < inputBuf.length; i++) rms += inputBuf[i] * inputBuf[i];
  rms = Math.sqrt(rms / inputBuf.length);
  if (rms < 0.008) return -1;

  const buf = inputBuf.slice(0, Math.min(inputBuf.length, MAX_LAG * 2));
  const n = buf.length;

  const c = new Float32Array(MAX_LAG);
  for (let lag = 0; lag < MAX_LAG; lag++) {
    for (let j = 0; j < n - lag; j++) c[lag] += buf[j] * buf[j + lag];
  }

  let d = 0;
  while (d < MAX_LAG - 1 && c[d] > c[d + 1]) d++;
  let maxVal = -1, maxPos = -1;
  for (let i = Math.max(d, MIN_LAG); i < MAX_LAG; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos < 1 || maxPos >= MAX_LAG - 1) return -1;

  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = c[maxPos + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const T0 = a ? maxPos - b / (2 * a) : maxPos;

  const freq = sampleRate / T0;
  return (freq >= MIN_FREQ && freq <= MAX_FREQ) ? freq : -1;
}

function freqToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[((midi % 12) + 12) % 12] + octave;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function classifyVoice(lowMidi, highMidi) {
  const userCenter = (lowMidi + highMidi) / 2;
  let best = null, bestScore = -Infinity;
  for (const vt of VOICE_TYPES) {
    const overlapLo = Math.max(lowMidi, vt.lowMidi);
    const overlapHi = Math.min(highMidi, vt.highMidi);
    const overlap = Math.max(0, overlapHi - overlapLo);
    const vtCenter = (vt.lowMidi + vt.highMidi) / 2;
    const distPenalty = Math.abs(userCenter - vtCenter);
    const score = overlap * 3 - distPenalty;
    if (score > bestScore) { bestScore = score; best = vt; }
  }
  return best;
}

let audioCtx = null;
let analyser = null;
let micStream = null;
let sampleTimer = null;
let waveAnimId = null;

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  audioCtx = new AudioContext();
  await audioCtx.resume();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
}

function stopMic() {
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (waveAnimId) { cancelAnimationFrame(waveAnimId); waveAnimId = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
}

let currentPhase = 'idle';
let phaseTimer = null;
let pitchesThisPhase = [];
let lowestMidi = null;
let highestMidi = null;
let freePitches = [];

const PHASE_LOWEST = 5000;
const PHASE_HIGHEST = 5000;
const PHASE_FREE = 6000;

function showPhase(name) {
  currentPhase = name;
  document.querySelectorAll('.phase').forEach(el => el.classList.remove('active'));
  const map = { idle: 'phase-idle', results: 'phase-results' };
  document.getElementById(map[name] || 'phase-recording').classList.add('active');
}

function setInstruction(text) {
  document.getElementById('instruction-text').textContent = text;
}

function setNoteDisplay(freq) {
  const noteEl = document.getElementById('current-note');
  const freqEl = document.getElementById('current-freq');
  if (freq > 0) {
    noteEl.textContent = midiToName(freqToMidi(freq));
    freqEl.textContent = freq.toFixed(1) + ' Hz';
    noteEl.classList.add('lit');
  } else {
    noteEl.textContent = '-';
    freqEl.textContent = '- Hz';
    noteEl.classList.remove('lit');
  }
}

function animateProgress(durationMs) {
  const bar = document.getElementById('progress-bar');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  void bar.offsetWidth;
  bar.style.transition = `transform ${durationMs}ms linear`;
  bar.style.transform = 'scaleX(0)';
}

function drawWaveform() {
  if (currentPhase === 'idle' || currentPhase === 'results') return;

  const canvas = document.getElementById('waveform');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (analyser) {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);

    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';

    const step = W / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const x = i * step;
      const y = ((buf[i] + 1) / 2) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  waveAnimId = requestAnimationFrame(drawWaveform);
}

function startSegment(phaseName, instruction, duration) {
  showPhase(phaseName);
  setInstruction(instruction);
  pitchesThisPhase = [];
  document.getElementById('detected-note-label').textContent = '';

  animateProgress(duration);

  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = setInterval(() => {
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const freq = detectPitch(buf, audioCtx.sampleRate);
    setNoteDisplay(freq);
    if (freq > 0) {
      const midi = freqToMidi(freq);
      pitchesThisPhase.push(midi);
      if (phaseName === 'free') freePitches.push(midi);
    }
  }, 80);

  if (phaseTimer) clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    clearInterval(sampleTimer);
    sampleTimer = null;
    onSegmentEnd(phaseName);
  }, duration);
}

function onSegmentEnd(phaseName) {
  const med = median(pitchesThisPhase);

  if (phaseName === 'lowest') {
    lowestMidi = med !== null ? Math.round(med) : null;
    if (lowestMidi) {
      document.getElementById('detected-note-label').textContent = 'Detected: ' + midiToName(lowestMidi);
    }
    setTimeout(() => {
      startSegment('highest', 'Now sing your highest comfortable note and hold it', PHASE_HIGHEST);
    }, 900);

  } else if (phaseName === 'highest') {
    highestMidi = med !== null ? Math.round(med) : null;
    if (highestMidi) {
      document.getElementById('detected-note-label').textContent = 'Detected: ' + midiToName(highestMidi);
    }
    setTimeout(() => {
      startSegment('free', 'Now sing freely, go through your whole range', PHASE_FREE);
    }, 900);

  } else if (phaseName === 'free') {
    if (freePitches.length > 4) {
      const fMin = Math.min(...freePitches);
      const fMax = Math.max(...freePitches);
      if (lowestMidi === null || fMin < lowestMidi) lowestMidi = fMin;
      if (highestMidi === null || fMax > highestMidi) highestMidi = fMax;
    }
    setTimeout(showResults, 600);
  }
}

function showResults() {
  stopMic();

  if (lowestMidi === null || highestMidi === null) {
    alert('No pitch detected. Make sure your microphone is working and try again in a quiet space.');
    showPhase('idle');
    return;
  }

  if (lowestMidi > highestMidi) [lowestMidi, highestMidi] = [highestMidi, lowestMidi];

  const vt = classifyVoice(lowestMidi, highestMidi);

  document.getElementById('result-low').textContent = midiToName(lowestMidi);
  document.getElementById('result-high').textContent = midiToName(highestMidi);
  document.getElementById('voice-name').textContent = vt ? vt.name : 'Unknown';

  showPhase('results');
  requestAnimationFrame(() => drawRangeDiagram(lowestMidi, highestMidi, vt));
}

function drawRangeDiagram(userLow, userHigh, matchedVt) {
  const canvas = document.getElementById('range-diagram');
  const ctx = canvas.getContext('2d');

  const DPR = window.devicePixelRatio || 1;
  const CSSw = canvas.offsetWidth;
  const CSSh = 290;
  canvas.width = CSSw * DPR;
  canvas.height = CSSh * DPR;
  canvas.style.height = CSSh + 'px';
  ctx.scale(DPR, DPR);

  const W = CSSw, H = CSSh;
  const PAD_L = 88, PAD_R = 16, PAD_T = 16, PAD_B = 52;
  const DRAW_W = W - PAD_L - PAD_R;
  const MIDI_MIN = 36, MIDI_MAX = 96;
  const MIDI_SPAN = MIDI_MAX - MIDI_MIN;
  const ROW_H = 28, ROW_GAP = 7;

  function midiX(midi) {
    return PAD_L + ((midi - MIDI_MIN) / MIDI_SPAN) * DRAW_W;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  for (let oct = 2; oct <= 7; oct++) {
    const midi = (oct + 1) * 12;
    const x = midiX(midi);
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, H - PAD_B + 8); ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('C' + oct, x, H - PAD_B + 22);
  }

  VOICE_TYPES.forEach((vt, i) => {
    const y = PAD_T + i * (ROW_H + ROW_GAP);
    const x1 = midiX(vt.lowMidi);
    const x2 = midiX(vt.highMidi);
    const barW = x2 - x1;
    const isMatch = matchedVt && vt.name === matchedVt.name;

    ctx.fillStyle = isMatch ? '#fff' : '#1c1c1c';
    roundRect(ctx, x1, y, barW, ROW_H, 4);
    ctx.fill();

    if (isMatch) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      roundRect(ctx, x1, y, barW, ROW_H, 4);
      ctx.stroke();
    }

    ctx.fillStyle = isMatch ? '#fff' : '#444';
    ctx.font = isMatch ? 'bold 12px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(vt.name, PAD_L - 8, y + ROW_H / 2 + 4);

    ctx.fillStyle = isMatch ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(midiToName(vt.lowMidi), x1 + 4, y + ROW_H / 2 + 3);
    ctx.textAlign = 'right';
    ctx.fillText(midiToName(vt.highMidi), x2 - 4, y + ROW_H / 2 + 3);
  });

  const ux1 = midiX(userLow);
  const ux2 = midiX(userHigh);
  const uh = VOICE_TYPES.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const uy = PAD_T;

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(ux1, uy, ux2 - ux1, uh);

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(ux1, uy, ux2 - ux1, uh);
  ctx.setLineDash([]);

  const labelY = H - PAD_B + 36;
  ctx.font = '10px monospace';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText('your range', (ux1 + ux2) / 2, H - PAD_B + 22);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(midiToName(userLow), ux1, labelY);
  ctx.fillText(midiToName(userHigh), ux2, labelY);

  ctx.fillStyle = '#fff';
  ctx.fillRect(ux1 - 1, H - PAD_B + 9, 2, 7);
  ctx.fillRect(ux2 - 1, H - PAD_B + 9, 2, 7);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBgWave() {
  const canvas = document.getElementById('bg-wave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;
  let t = 0;

  function frame() {
    if (currentPhase !== 'idle') return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;

    for (let line = 0; line < 3; line++) {
      const amp = 18 - line * 5;
      const freq = 0.012 + line * 0.004;
      const speed = 0.012 - line * 0.003;
      const yBase = H * (0.35 + line * 0.15);

      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = yBase + Math.sin(x * freq + t * speed * 60) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    t++;
    requestAnimationFrame(frame);
  }
  frame();
}

drawBgWave();

document.getElementById('start-btn').addEventListener('click', async () => {
  try {
    await startMic();
    lowestMidi = null;
    highestMidi = null;
    freePitches = [];
    startSegment('lowest', 'Sing your lowest comfortable note and hold it', PHASE_LOWEST);
    drawWaveform();
  } catch (err) {
    console.error(err);
    alert('Microphone access was denied. Please allow microphone access in your browser and try again.');
  }
});

document.getElementById('restart-btn').addEventListener('click', () => {
  showPhase('idle');
});
