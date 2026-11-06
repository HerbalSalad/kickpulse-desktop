// electron/whisperCaptions.ts — Live Captions, powered by whisper.cpp
// (2026-11-06, replacing Vosk for this one job — see voiceCommands.ts's own
// header for why Voice Commands itself stays on Vosk). Direct report:
// "vosk is SHIT for captions" — real, confirmed via a 6-model x 2-clip
// benchmark: Vosk's grammar either has to be wide open (poor accuracy) or
// constrained to a fixed phrase list (useless for free speech). whisper.cpp
// trades that for genuinely better open-vocabulary accuracy, at the cost of
// a real, disclosed, accepted tradeoff this file embodies on purpose:
//
// whisper.cpp has NO incremental/streaming decode API the way Vosk does —
// every run is a one-shot batch transcription of a complete audio buffer
// (confirmed via the whisper-cli --help output and real test runs before
// this was built; this is also the same pattern a real shipped product,
// OBS's own LocalVocal plugin, already uses for exactly this problem). So
// this module does energy-based VAD-gated WINDOWING: buffer raw PCM frames
// from the SAME mic stream voiceCommands.ts already consumes (see
// voice-window.ts's registerVoiceIpc, which now forwards each frame to
// BOTH), and flush a window — write it to a temp WAV, spawn whisper-cli.exe
// as a real child process, parse its clean (-nt -np) stdout — once a real
// pause in speech is detected, or a max-duration safety cap is hit.
// Captions arrive in small batches with a few seconds of lag, not
// word-by-word live like Vosk's partials — accepted, not a bug to chase.
//
// NOT a worker_thread like voiceWorker.ts (Vosk) needs — whisper-cli runs
// as a genuine OS child PROCESS (spawn), so it can never block Electron's
// main thread the way Vosk's synchronous in-process FFI calls could; the
// worker_thread fix that file needed doesn't apply here at all.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './store';
import { reportVoiceCaption } from './api';
import { whisperModelPathFor, isWhisperModelReady, type WhisperModelKey } from './whisperModels';

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

// VAD tuning — plain RMS energy, no real "is this speech vs. noise"
// classifier. 500 (out of a possible 32767) sits comfortably above typical
// room/mic noise floor and comfortably below actual speech, confirmed
// against this app's own real TTS test clips during the benchmark. Good
// enough for "is someone talking right now," which is all this needs.
const SILENCE_RMS_THRESHOLD = 500;
// A pause this long after real speech is treated as "they're done with that
// thought" and flushes the window for transcription.
const SILENCE_HANGOVER_MS = 700;
// Hard cap so a long uninterrupted monologue still gets captions
// progressively instead of one giant, increasingly-lagging block.
const MAX_WINDOW_MS = 12_000;
// Shorter than this is almost certainly a click/breath/mic bump, not real
// speech worth spawning a whisper-cli process over.
const MIN_WINDOW_MS = 300;
// Safety valve only — if whisper-cli is still transcribing a previous
// window by the time the buffered audio reaches this (should never happen
// at small.en's real-time factor of ~0.4, only guards against a genuinely
// stuck/hung process), drop the backlog rather than growing it forever.
const MAX_BACKLOG_MS = 30_000;
// Kills a whisper-cli run that's taken far longer than any real model
// should need for a 12s-max window, so a hang can't wedge `busy` forever.
const TRANSCRIBE_TIMEOUT_MS = 20_000;

let modelKey: WhisperModelKey = 'small';
let enabled = false;

let chunks: Buffer[] = [];
let windowMs = 0;
let silenceMs = 0;
let hasSpeech = false;
let busy = false;

export function configureWhisperCaptions(key: WhisperModelKey): void {
  modelKey = key;
}

export function setWhisperCaptionsEnabled(v: boolean): void {
  enabled = v;
  if (!v) resetWindow();
}

function resetWindow(): void {
  chunks = [];
  windowMs = 0;
  silenceMs = 0;
  hasSpeech = false;
}

function rms(buf: Buffer): number {
  const samples = buf.length / 2;
  if (samples === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}

// The real entry point — called by voice-window.ts for every raw PCM frame,
// same frames voiceCommands.ts's Vosk path already gets (16-bit mono
// 16kHz). A no-op whenever Live Captions is off, so a streamer who never
// enables it pays zero extra CPU for this second engine.
export function handleCaptionAudioFrame(buffer: Buffer): void {
  if (!enabled) return;
  const frameMs = (buffer.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  const isSpeech = rms(buffer) >= SILENCE_RMS_THRESHOLD;

  chunks.push(buffer);
  windowMs += frameMs;
  if (isSpeech) { hasSpeech = true; silenceMs = 0; }
  else silenceMs += frameMs;

  if (busy) {
    // Previous window is still transcribing — keep accumulating instead of
    // dropping audio. Only bail if that run has gone on so long the
    // backlog itself is a problem (see MAX_BACKLOG_MS above).
    if (windowMs >= MAX_BACKLOG_MS) resetWindow();
    return;
  }

  const shouldFlush = (hasSpeech && silenceMs >= SILENCE_HANGOVER_MS) || windowMs >= MAX_WINDOW_MS;
  if (shouldFlush) flush();
}

function flush(): void {
  const windowChunks = chunks;
  const totalMs = windowMs;
  const hadSpeech = hasSpeech;
  resetWindow();
  if (!hadSpeech || totalMs < MIN_WINDOW_MS) return;
  transcribe(Buffer.concat(windowChunks)).catch((err: any) =>
    console.error('[captions] transcribe failed:', err?.message || err));
}

function writeWavFile(pcm: Buffer, destPath: string): void {
  // Plain 44-byte canonical PCM WAV header — the exact format whisper-cli
  // expects (confirmed via real test runs), built straight from the same
  // 16kHz mono 16-bit frames VoiceApp.tsx already produces for Vosk, so no
  // new resampling/conversion is needed anywhere in this pipeline.
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(destPath, Buffer.concat([header, pcm]));
}

// assets/ ships alongside dist-electron/ in both dev and packaged layout
// (asar: false, see package.json's build.files) — same resolution
// convention main.ts/tray.ts already use for assets/icon.png.
function whisperCliPath(): string {
  return path.join(__dirname, '../assets/whisper/bin/whisper-cli.exe');
}

function runWhisperCli(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(whisperCliPath(), ['-m', whisperModelPathFor(modelKey), '-f', wavPath, '-nt', '-np']);
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error('whisper-cli timed out'));
    }, TRANSCRIBE_TIMEOUT_MS);
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    proc.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(out.trim()); } });
  });
}

async function transcribe(pcm: Buffer): Promise<void> {
  if (!isWhisperModelReady(modelKey)) return; // not downloaded yet — silently skip rather than erroring every single window
  busy = true;
  const wavPath = path.join(os.tmpdir(), `kickpulse-caption-${crypto.randomUUID()}.wav`);
  try {
    writeWavFile(pcm, wavPath);
    const text = await runWhisperCli(wavPath);
    if (text) report(text);
  } finally {
    busy = false;
    fs.rm(wavPath, { force: true }, () => {});
  }
}

let _lastSent = '';
function report(text: string): void {
  if (!text || text === _lastSent) return;
  _lastSent = text;
  const apiKey = loadConfig().apiKey;
  if (!apiKey) return;
  // Each window IS the complete result for that span — whisper.cpp has no
  // partial/streaming concept the way Vosk does (see this file's own
  // header), so there's no separate "partial" report, only a final one.
  reportVoiceCaption(apiKey, text, true).catch(() => {});
}

export function teardownWhisperCaptions(): void {
  enabled = false;
  resetWindow();
}
