// Masters generated sound-effect takes into the world's cue files: trims each to its sound (a
// "single" stops at the first gap, so a take with two hits keeps one), fades the tail, brings the
// peak to a common level and writes mono MP3s named <cue>-a, -b, ... into public/figurines/audio.
//   node scripts/master-game-sounds.mjs <folder with one subfolder of takes per cue>
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// cue: [single event?, longest it may run in seconds]
const CUES = {
  coin: [true, 0.6], coins: [false, 1.4], "coins-few": [false, 0.9], swish: [false, 0.7], clack: [true, 0.25],
  "win-small": [false, 1.6], "win-big": [false, 2.6], "win-boost": [false, 2], splash: [false, 1], "splash-big": [false, 1.8],
  nibble: [true, 0.4], bite: [false, 1.1], reel: [false, 1], cast: [false, 0.8], escape: [false, 1.1], flop: [true, 0.6],
  "quest-done": [false, 1.4], stamp: [true, 0.6], open: [false, 0.7], close: [true, 0.5], trade: [false, 1.3], gift: [false, 1.5],
  paper: [false, 0.8], anvil: [true, 1], furnace: [false, 1.4], crunch: [false, 1.2], star: [true, 0.7], place: [true, 0.35],
};
const ffmpeg = (args) => spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { encoding: "utf8" }).stderr;
const source = process.argv[2];
if (!source) throw new Error("Pass the folder of generated takes.");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "master-"));
for (const [cue, [single, longest]] of Object.entries(CUES)) {
  const takes = fs.readdirSync(path.join(source, cue)).filter((file) => file.endsWith(".mp3")).sort();
  takes.forEach((take, index) => {
    const trimmed = path.join(work, `${cue}-${index}.wav`);
    const gap = single ? ":stop_periods=1:stop_threshold=-48dB:stop_duration=0.12" : "";
    // Takes come at very different levels: bring each up first, so the thresholds mean the same for all.
    const raw = Number(/max_volume: (-?[\d.]+) dB/.exec(ffmpeg(["-i", path.join(source, cue, take), "-af", "volumedetect", "-f", "null", "-"]))?.[1] ?? 0);
    ffmpeg(["-i", path.join(source, cue, take), "-ac", "1", "-af", `highpass=f=50,volume=${(-1 - raw).toFixed(1)}dB,silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.004${gap}`, trimmed]);
    // Trailing quiet goes too, measured from the end.
    const length = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", trimmed], { encoding: "utf8" }));
    const quiet = [...ffmpeg(["-i", trimmed, "-af", "silencedetect=n=-45dB:d=0.05", "-f", "null", "-"]).matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1])).pop();
    const ends = /silence_end/.test(ffmpeg(["-i", trimmed, "-af", "silencedetect=n=-45dB:d=0.05", "-f", "null", "-"]).split("silence_start").pop() ?? "") ? length : quiet ?? length;
    const seconds = Math.max(0.05, Math.min(longest, ends + 0.04, length)), fade = Math.min(0.12, seconds / 3);
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(ffmpeg(["-i", trimmed, "-t", String(seconds), "-af", "volumedetect", "-f", "null", "-"]))?.[1] ?? 0);
    const name = `${cue}-${"abcdef"[index]}`;
    ffmpeg(["-i", trimmed, "-t", String(seconds), "-af", `volume=${(-3 - peak).toFixed(1)}dB,afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade.toFixed(3)}`, "-ar", "44100", "-ac", "1", "-b:a", "96k", path.join("public/figurines/audio", `${name}.mp3`)]);
    console.log(name.padEnd(16), `${seconds.toFixed(2)}s`, `(take ${length.toFixed(2)}s, peak ${peak} dB)`);
  });
}
fs.rmSync(work, { recursive: true });
