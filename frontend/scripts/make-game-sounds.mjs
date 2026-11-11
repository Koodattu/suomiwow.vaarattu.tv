// Synthesises the interface's smallest tones, which need exact pitch and length more than they need
// texture: a progress tick, a pick, a refusal, a panel opening and closing. They are heard hundreds
// of times, so every one is low, soft-edged and short: nothing bright, nothing that clicks. Everything with a body (coins, water,
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

// A soft thump: low noise through a closing filter over a falling sine, with no click at its start.
function thump(from, to, seconds, seed) {
  const out = wave(seconds); let state = seed, low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate, k = t / seconds;
    state = (state * 16807) % 2147483647;
    low += ((state / 1073741823.5 - 1) - low) * (0.05 - 0.035 * k);
    out[i] = low * 2.2 * Math.sin(Math.PI * Math.min(1, t / 0.012) / 2) * Math.exp(-t / (seconds * 0.3));
  }
  const body = tone(from, to, seconds, seconds * 0.35, 0.012);
  for (let i = 0; i < out.length; i++) out[i] += body[i] * 0.8;
  return fade(out, seconds * 0.4);
}
// name: [wave, peak (0..1)]
const SOUNDS = {
  // A quest bar's tick and the wheel's passing notes: a round, mallet-like note.
  blip: [seq([tone(520, 510, 0.12, 0.045, 0.006), 0, 1], [tone(1040, 1020, 0.06, 0.02, 0.006), 0, 0.12]), 0.4],
  fill: [fade(tone(260, 620, 0.5, 0.6, 0.03), 0.06), 0.3],
  // Picking a tab, a chip or a card: a soft wooden tap.
  pick: [seq([tone(330, 250, 0.08, 0.022, 0.006), 0, 1], [tone(660, 500, 0.04, 0.01, 0.006), 0, 0.15]), 0.35],
  deny: [seq([tone(150, 132, 0.1, 0.05, 0.008), 0, 1], [tone(132, 110, 0.15, 0.07, 0.008), 0.12, 1]), 0.4],
  unstar: [fade(tone(420, 300, 0.12, 0.04, 0.008)), 0.3],
  // A panel arriving and leaving: a breath and a low thump, rising to open and falling to close.
  open: [thump(110, 150, 0.22, 4711), 0.4],
  close: [thump(140, 90, 0.2, 9103), 0.35],
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
