// electron/voiceCommands.ts — Voice Commands' real recognition engine
// (2026-10-23 rewrite, Whisper-WASM -> Vosk via vosk-koffi; 2026-10-27:
// the actual Vosk Model/Recognizer calls moved into a worker_thread — see
// electron/voiceWorker.ts's own header for why, it's a real fix for a real
// reported bug, not a refactor for its own sake). vosk-koffi is a native
// module (via Koffi, which ships real prebuilt binaries, no node-gyp/
// Electron-rebuild needed, confirmed with a real standalone proof-of-concept
// before this was built). The hidden listener window (electron/voice-window.ts,
// src/VoiceApp.tsx) does ONLY mic capture (getUserMedia, a renderer-only
// API) and streams raw 16kHz mono PCM frames up over IPC to THIS file
// (still running in the main process) — which now just forwards each frame
// into the worker and reacts to its results; the grammar/word-list
// building, per-phrase matching, cooldowns, caption reporting, and the
// heard-log all stay here unchanged, since none of that is the expensive
// blocking part.
import { app } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { loadConfig } from './store';
import { fetchVoicePhrases, reportVoiceTrigger, reportVoiceCaption } from './api';
import { MODEL_SOURCES, modelDirFor, isModelReady, downloadModel, type VoiceModelSize } from './voiceModels';

export type { VoiceModelSize };
export { MODEL_SOURCES, isModelReady };

export interface VoicePhrase {
  id: string;
  phrase: string;
  // matchMode/minConfidence/triggerImmediately (2026-10-23) — authored on
  // either front door (the dedicated Voice Commands page, or the generic
  // Pulse Engine trigger editor — both write the same pulse_rules row, see
  // routes/pulseRules.js's /targets/voice-phrases). Defaults mirror
  // PulseTriggerEditor.tsx's own DEFAULT_TRIGGERS.voice_command.
  matchMode: 'contains' | 'exact';
  minConfidence: number; // 0-100
  triggerImmediately: boolean;
}

// ── Worker lifecycle — the actual Model/Recognizer now lives in
// voiceWorker.ts, on its own thread. This main-process side just tracks
// "does the worker already have the right model+grammar loaded" (same
// recognizerKey idea the old inline version used) so a 'configure' message
// is only sent when something genuinely changed, and routes the worker's
// 'partial'/'final' results into the exact same matching/logging/caption
// pipeline that used to run right after a direct recognizer call. ──────────
let worker: InstanceType<typeof Worker> | null = null;
let workerConfigKey = ''; // detects when the grammar/model actually needs rebuilding

function getWorker(): InstanceType<typeof Worker> {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, 'voiceWorker.js'));
  w.on('message', handleWorkerMessage);
  w.on('error', (err) => console.error('[voice] worker error:', err?.message || err));
  // Self-heals against a crashed worker — the next handleAudioFrame call
  // (or configure) will lazily spin up a fresh one via getWorker() again,
  // same "no standalone recovery timer" convention the rest of this file
  // already follows for its own 60s poll.
  w.on('exit', (code) => {
    if (code !== 0) console.error(`[voice] worker exited unexpectedly (code ${code})`);
    if (worker === w) { worker = null; workerConfigKey = ''; }
  });
  worker = w;
  return w;
}

function handleWorkerMessage(msg: any): void {
  if (msg?.type === 'partial') {
    const partial = msg.raw?.partial || '';
    if (partial && partial !== livePartialText) {
      livePartialText = partial;
      maybeReportCaption(partial, false);
      checkMatches(partial, 0, false, false);
    }
    return;
  }
  if (msg?.type === 'final') {
    const { text, words } = extractFlat(msg.raw);
    livePartialText = '';
    if (text.trim()) {
      const confidencePct = avgConfidencePct(words);
      const matchedPhrase = checkMatches(text, confidencePct, true, true);
      heardLog = [{ text, confidence: confidencePct, matchedPhrase, at: Date.now() }, ...heardLog].slice(0, MAX_HEARD_LOG);
      maybeReportCaption(text, true);
    }
    return;
  }
  if (msg?.type === 'error') {
    console.error('[voice] recognizer error (worker):', msg.message);
  }
}

function normalize(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Vosk's grammar is fixed at Recognizer-construction time (no live
// "setGrammar" exists) — "Strict phrase matching" mode constrains
// recognition to just your bound phrases + Recognition Words (much higher
// accuracy on those, can't make out anything outside that list — including
// live captions of arbitrary speech). "Open vocabulary" hears anything, at
// the cost of some accuracy on your specific phrases. Confirmed both modes
// work via a real proof-of-concept before this was built.
function buildGrammar(strict: boolean, phrases: VoicePhrase[], recognitionWords: string[]): string[] | undefined {
  if (!strict) return undefined;
  const words = new Set<string>();
  for (const p of phrases) if (p.phrase.trim()) words.add(p.phrase.trim().toLowerCase());
  for (const w of recognitionWords) if (w.trim()) words.add(w.trim().toLowerCase());
  words.add('[unk]'); // lets it fall back to "unknown" instead of forcing a wrong guess
  return [...words];
}

// Tells the worker to (re)build its model/recognizer if the effective
// config actually changed — same recognizerKey comparison the old inline
// version did, just sent as a message instead of done in-process. Posting
// 'configure' doesn't block THIS thread at all; the worker's own mailbox
// guarantees any 'frame' messages sent right after are processed only once
// it's actually done loading, same ordering the old synchronous version had
// — the difference is Electron's main process is free to do everything
// else while that happens now, instead of being frozen for it.
function ensureRecognizerConfigured(size: VoiceModelSize, strict: boolean, phrases: VoicePhrase[], recognitionWords: string[]): void {
  const grammar = buildGrammar(strict, phrases, recognitionWords);
  const key = `${size}:${JSON.stringify(grammar)}`;
  if (key === workerConfigKey) return;
  workerConfigKey = key;
  getWorker().postMessage({ type: 'configure', modelDir: modelDirFor(size), size, grammar });
}

// ── Phrase list (polled from the website — rules are authored on either the
// dedicated Voice Commands page or the generic Pulse Engine editor, both
// write the same pulse_rules row) ───────────────────────────────────────────
let phrases: VoicePhrase[] = [];
let refreshTimer: ReturnType<typeof setInterval> | undefined;

async function refreshPhrasesNow(): Promise<void> {
  const apiKey = loadConfig().apiKey;
  if (!apiKey) return;
  try {
    phrases = await fetchVoicePhrases(apiKey);
  } catch (err: any) {
    console.error('[voice] failed to refresh phrase list:', err?.message || err);
  }
}

export function getCachedPhrases(): VoicePhrase[] {
  return phrases;
}

export function startPolling(): void {
  if (refreshTimer) return;
  refreshPhrasesNow();
  refreshTimer = setInterval(refreshPhrasesNow, 60_000);
}

export function stopPolling(): void {
  clearInterval(refreshTimer);
  refreshTimer = undefined;
  // Fully tears down the worker (not just its model/recognizer) — matches
  // this function's existing "turning this off fully tears it down, not
  // just pausing it" contract (see voice-window.ts's stopVoiceListening).
  if (worker) { worker.postMessage({ type: 'teardown' }); worker.terminate().catch(() => {}); worker = null; }
  workerConfigKey = '';
}

// ── Debug state for the dedicated Voice Commands page ──────────────────────
export interface HeardEntry { text: string; confidence: number; matchedPhrase: string | null; at: number }
const MAX_HEARD_LOG = 20;
let heardLog: HeardEntry[] = [];
let livePartialText = '';

export function getHeardLog() { return heardLog; }
export function getLivePartialText() { return livePartialText; }

// ── Per-phrase fire cooldown — same reasoning as the first pass: a short
// utterance containing the phrase twice, or an immediate-mode rule matching
// on a partial AND again on the final a moment later, shouldn't double-fire.
const FIRE_COOLDOWN_MS = 3000;
const _lastFired = new Map<string, number>(); // rule id -> last fired timestamp

function phraseMatches(text: string, confidencePct: number, hasConfidence: boolean, p: VoicePhrase): boolean {
  const target = normalize(p.phrase);
  if (!target) return false;
  const clean = normalize(text);
  const textMatches = p.matchMode === 'exact' ? clean === target : clean.includes(target);
  if (!textMatches) return false;
  // Partial (streaming) results carry no per-word confidence at all — an
  // immediate-mode rule trades confidence-awareness for speed on those;
  // confidence is only ever enforced once real word-level data exists.
  if (hasConfidence && confidencePct < (p.minConfidence ?? 50)) return false;
  return true;
}

function fireMatch(p: VoicePhrase, confidencePct: number): void {
  const last = _lastFired.get(p.id) ?? 0;
  if (Date.now() - last < FIRE_COOLDOWN_MS) return;
  _lastFired.set(p.id, Date.now());
  const apiKey = loadConfig().apiKey;
  if (apiKey) {
    reportVoiceTrigger(apiKey, p.phrase).catch((err: any) =>
      console.error('[voice] failed to report trigger:', err?.message || err));
  }
}

function checkMatches(text: string, confidencePct: number, hasConfidence: boolean, finalPass: boolean): string | null {
  for (const p of phrases) {
    if (!finalPass && !p.triggerImmediately) continue; // partials only ever check "trigger immediately" rules
    if (!phraseMatches(text, confidencePct, hasConfidence, p)) continue;
    fireMatch(p, confidencePct);
    return p.phrase;
  }
  return null;
}

function avgConfidencePct(words: { conf?: number }[]): number {
  if (!words.length) return 0;
  return Math.round((words.reduce((s, w) => s + (w.conf ?? 0), 0) / words.length) * 100);
}

// Normalizes vosk-koffi's real observed result shape (a flat {text, result}
// object) while tolerating the {alternatives:[...]} wrapper its own .d.ts
// also documents (seen when setMaxAlternatives is used) — confirmed the
// flat shape via a real proof-of-concept before this was written; this
// stays defensive rather than assuming only one of the two.
function extractFlat(raw: any): { text: string; words: { word: string; conf?: number }[] } {
  const r = raw?.alternatives?.[0] ?? raw;
  return { text: r?.text || '', words: Array.isArray(r?.result) ? r.result : [] };
}

// ── Live captions (both the in-app monitor AND the on-stream widget read
// off this same data — the widget via reportVoiceCaption below, gated on
// the desktop's own Live Captions toggle so nothing is sent for a streamer
// who never added that widget) ──────────────────────────────────────────
let _lastSentCaption = '';
function maybeReportCaption(text: string, isFinal: boolean): void {
  if (!loadConfig().voiceLiveCaptionsEnabled) return;
  if (!text || text === _lastSentCaption) return;
  _lastSentCaption = text;
  const apiKey = loadConfig().apiKey;
  if (!apiKey) return;
  reportVoiceCaption(apiKey, text, isFinal).catch(() => {});
}

// ── The real entry point — called by main.ts for every raw PCM frame the
// hidden listener window streams up (16-bit mono 16kHz, matching how
// VoiceApp.tsx captures and resamples it). Posts the frame straight into
// the worker (electron/voiceWorker.ts) and returns immediately — the
// actual blocking Vosk decode now happens on that thread, not this one, so
// a slow/large model can no longer freeze the rest of the app. Results
// come back asynchronously via handleWorkerMessage above, which runs the
// exact same matching/logging/caption logic this function used to run
// inline right after a direct recognizer call. ─────────────────────────────
export async function handleAudioFrame(buffer: Buffer): Promise<void> {
  const cfg = loadConfig();
  // Always goes through ensureRecognizerConfigured — its own key comparison
  // is what actually makes this cheap (a string compare, no real work) when
  // nothing changed, every ~256ms. A real, previously-confirmed bug used to
  // gate this behind `if (!recognizer)` instead: once a recognizer existed
  // at all, invalidateRecognizer() only ever reset the comparison key — this
  // function never re-checked it, so the OLD model just kept running
  // forever regardless of what the user picked afterward. That's already
  // fixed (this always re-checks the key); what's NEW in this pass is that
  // the (re)configure + decode work itself no longer blocks this process.
  try {
    ensureRecognizerConfigured(cfg.voiceModelSize, cfg.voiceStrictVocabulary, phrases, cfg.voiceRecognitionWords);
  } catch (err: any) {
    console.error('[voice] recognizer configure failed:', err?.message || err);
    return;
  }
  getWorker().postMessage({ type: 'frame', buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
}

// Re-configures the worker's recognizer on its next frame if the model
// size, vocabulary mode, or recognition words changed — called by main.ts's IPC handlers
// whenever a setting actually changes, rather than polling for drift.
export function invalidateRecognizer(): void {
  workerConfigKey = '';
}

export async function ensureModelDownloaded(size: VoiceModelSize, onProgress: (pct: number) => void): Promise<void> {
  if (isModelReady(size)) { onProgress(100); return; }
  await downloadModel(size, onProgress);
}
