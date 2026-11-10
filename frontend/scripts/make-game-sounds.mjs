// Synthesises the interface's smallest tones, which need exact pitch and length more than they need
// texture: a progress tick, a rising fill, a pick, a refusal. Everything with a body (coins, water,
// wood) is generated and mastered by scripts/master-game-sounds.mjs instead.
// Run from frontend with ffmpeg on the path: node scripts/make-game-sounds.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rate = 44100, TAU = Math.PI * 2;
const wave = (seconds) => new Float64Array(Math.ceil(seconds * rate));
// A sine whose pitch runs from `from` to `to`, dying away over `decay` seconds.
function tone(from, to, seconds, decay, attack = 0.003) {
  const out = wave(seconds); let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    phase += TAU * (from * (to / from) ** (t / seconds)) / rate;
    out[i] = Math.sin(phase) * Math.exp(-t / decay) * Math.min(1, t / attack);
  }
  return out;
}
function fade(input, seconds = 0.02) { const tail = Math.min(input.length, Math.floor(seconds * rate)); for (let i = 0; i < tail; i++) input[input.length - 1 - i] *= i / tail; return input; }
const seq = (...parts) => {
  const out = wave(Math.max(...parts.map(([sound, at]) => at + sound.length / rate)));
  for (const [sound, at, gain = 1] of parts) { const start = Math.round(at * rate); for (let i = 0; i < sound.length; i++) out[start + i] += sound[i] * gain; }
  return fade(out);
};

// name: [wave, peak (0..1)]
const SOUNDS = {
  blip: [seq([tone(880, 900, 0.07, 0.03), 0, 1], [tone(1760, 1780, 0.05, 0.015), 0, 0.25]), 0.4],
  fill: [fade(tone(420, 1260, 0.5, 0.6, 0.02), 0.04), 0.35],
  pick: [seq([tone(1500, 1250, 0.05, 0.012), 0, 1], [tone(3000, 2500, 0.03, 0.006), 0, 0.3]), 0.45],
  deny: [seq([tone(150, 132, 0.09, 0.05), 0, 1], [tone(300, 264, 0.09, 0.05), 0, 0.3], [tone(132, 110, 0.14, 0.07), 0.11, 1], [tone(264, 220, 0.14, 0.07), 0.11, 0.3]), 0.5],
  unstar: [fade(tone(1400, 900, 0.1, 0.035)), 0.35],
};

function wav(samples, peakTarget) {
  const peak = samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0) || 1, data = Buffer.alloc(samples.length * 2), head = Buffer.alloc(44);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(value / peak * peakTarget * 32767), i * 2));
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "game-sounds-"));
for (const [name, [samples, peak]] of Object.entries(SOUNDS)) {
  const source = path.join(work, `${name}.wav`);
  fs.writeFileSync(source, wav(samples, peak));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-ar", "44100", "-ac", "1", "-b:a", "96k", path.join("public/figurines/audio", `${name}.mp3`)]);
}
fs.rmSync(work, { recursive: true });
console.log(`${Object.keys(SOUNDS).length} sounds written`);
