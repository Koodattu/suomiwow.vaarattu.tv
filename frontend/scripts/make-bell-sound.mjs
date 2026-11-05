// Synthesises the town bell's two strikes: the inharmonic partials of a cast bell over a short
// clapper knock. Run from frontend with ffmpeg on the path: node scripts/make-bell-sound.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rate = 44100;
// Hum, prime, tierce, quint, nominal and upper partials as [ratio, gain, decay seconds].
const PARTIALS = [[0.5, 0.55, 2.9], [1, 0.9, 2.1], [1.19, 0.5, 1.5], [1.5, 0.3, 1.1], [2, 0.62, 0.85], [2.51, 0.28, 0.55], [2.98, 0.22, 0.42], [4.07, 0.14, 0.24], [5.3, 0.08, 0.14]];

function strike(base, seconds, seed) {
  const samples = Math.floor(seconds * rate), wave = new Float64Array(samples);
  let state = seed;
  const noise = () => { state = (state * 16807) % 2147483647; return state / 1073741823.5 - 1; };
  for (const [ratio, gain, decay] of PARTIALS) {
    const frequency = base * ratio, beat = 0.6 + ratio * 0.17, phase = noise() * Math.PI;
    for (let i = 0; i < samples; i++) {
      const t = i / rate;
      wave[i] += gain * Math.exp(-t / decay) * (1 + 0.16 * Math.cos(2 * Math.PI * beat * t)) * Math.sin(2 * Math.PI * frequency * t + phase);
    }
  }
  let low = 0;
  for (let i = 0; i < 2600; i++) { low += (noise() - low) * 0.22; wave[i] += low * 1.5 * Math.exp(-i / 420); }
  const attack = Math.floor(0.0015 * rate), tail = Math.floor(0.5 * rate);
  for (let i = 0; i < attack; i++) wave[i] *= i / attack;
  for (let i = 0; i < tail; i++) wave[samples - 1 - i] *= (i / tail) ** 2;
  return wave;
}

function wav(wave) {
  const peak = wave.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0), data = Buffer.alloc(wave.length * 2), head = Buffer.alloc(44);
  wave.forEach((value, i) => data.writeInt16LE(Math.round(value / peak * 0.85 * 32767), i * 2));
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "bell-"));
for (const [name, base, seconds, seed] of [["bell-a", 311, 3.6, 7001], ["bell-b", 277, 3.8, 9103]]) {
  const source = path.join(work, `${name}.wav`);
  fs.writeFileSync(source, wav(strike(base, seconds, seed)));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-af", "highpass=f=70,loudnorm=I=-18:TP=-2:LRA=11", "-ar", "44100", "-ac", "1", "-b:a", "96k", path.join("public/figurines/audio", `${name}.mp3`)]);
}
fs.rmSync(work, { recursive: true });
