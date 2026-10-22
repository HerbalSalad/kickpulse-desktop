// electron/voiceCommands.ts — Voice Commands' real recognition engine
// (2026-10-23 rewrite, Whisper-WASM -> Vosk via vosk-koffi). Runs entirely
// in THIS process (Electron's main/Node process) — vosk-koffi is a native
// module (via Koffi, which ships real prebuilt binaries, no node-gyp/
// Electron-rebuild needed, confirmed with a real standalone proof-of-concept
// before this was built) — unlike the WASM approach, which had to run
// inside a renderer. The hidden listener window (electron/voice-window.ts,
// src/VoiceApp.tsx) now does ONLY mic capture (getUserMedia, a
// renderer-only API) and streams raw 16kHz mono PCM frames up over IPC;
// everything ML-related — the recognizer, the grammar/word-list, per-word
// confidence, partial/streaming results — lives here.
import { app } from 'electron';
import vosk from 'vosk-koffi';
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

vosk.setLogLevel(-1);

// ── Model + recognizer lifecycle ────────────────────────────────────────────
let model: InstanceType<typeof vosk.Model> | null = null;
let modelLoadedSize: VoiceModelSize | null = null;
let recognizer: InstanceType<typeof vosk.Recognizer> | null = null;
let recognizerKey = ''; // detects when the grammar/model actually needs rebuilding

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

async function ensureRecognizer(size: VoiceModelSize, strict: boolean, phrases: VoicePhrase[], recognitionWords: string[]): Promise<void> {
  const grammar = buildGrammar(strict, phrases, recognitionWords);
  const key = `${size}:${JSON.stringify(grammar)}`;
  if (recognizer && key === recognizerKey) return;

  if (!model || modelLoadedSize !== size) {
    model?.free();
    model = new vosk.Model(modelDirFor(size));
    modelLoadedSize = size;
  }
  recognizer?.free();
  recognizer = grammar
    ? new vosk.Recognizer({ model, sampleRate: 16000, grammar })
    : new vosk.Recognizer({ model, sampleRate: 16000 });
  recognizer.setWords(true);
  recognizer.setPartialWords(true);
  recognizerKey = key;
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
  recognizer?.free(); recognizer = null; recognizerKey = '';
  model?.free(); model = null; modelLoadedSize = null;
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
// VoiceApp.tsx captures and resamples it). ─────────────────────────────────
export async function handleAudioFrame(buffer: Buffer): Promise<void> {
  const cfg = loadConfig();
  // Always goes through ensureRecognizer — its own key comparison
  // (`key === recognizerKey`) is what actually makes this cheap (a string
  // compare, no real work) when nothing changed, every ~256ms. A real,
  // confirmed bug used to gate this behind `if (!recognizer)` instead: once
  // a recognizer existed at all, invalidateRecognizer() (called by every
  // model-size/vocabulary/recognition-words IPC handler in main.ts) only
  // ever reset recognizerKey — this function never re-checked it, so the
  // OLD model/recognizer just kept running forever regardless of what the
  // user picked afterward. Exact match for the reported symptom: a big
  // model (medium/large/xlarge) tested once stayed loaded and doing real
  // full-size inference on every frame even after switching back to
  // "small" in the UI — nothing short of fully disabling and re-enabling
  // Voice Commands (which tears down and rebuilds via stopPolling/
  // startPolling) ever actually freed it.
  try {
    await ensureRecognizer(cfg.voiceModelSize, cfg.voiceStrictVocabulary, phrases, cfg.voiceRecognitionWords);
  } catch (err: any) {
    console.error('[voice] recognizer init failed:', err?.message || err);
    return;
  }
  if (!recognizer) return;

  const isUtteranceEnd = recognizer.acceptWaveform(buffer);

  const partial = recognizer.partialResult()?.partial || '';
  if (partial && partial !== livePartialText) {
    livePartialText = partial;
    maybeReportCaption(partial, false);
    checkMatches(partial, 0, false, false);
  }

  if (isUtteranceEnd) {
    const raw = recognizer.result();
    const { text, words } = extractFlat(raw);
    livePartialText = '';
    if (text.trim()) {
      const confidencePct = avgConfidencePct(words);
      const matchedPhrase = checkMatches(text, confidencePct, true, true);
      heardLog = [{ text, confidence: confidencePct, matchedPhrase, at: Date.now() }, ...heardLog].slice(0, MAX_HEARD_LOG);
      maybeReportCaption(text, true);
    }
  }
}

// Re-inits the recognizer on its next frame if the model size, vocabulary
// mode, or recognition words changed — called by main.ts's IPC handlers
// whenever a setting actually changes, rather than polling for drift.
export function invalidateRecognizer(): void {
  recognizerKey = '';
}

export async function ensureModelDownloaded(size: VoiceModelSize, onProgress: (pct: number) => void): Promise<void> {
  if (isModelReady(size)) { onProgress(100); return; }
  await downloadModel(size, onProgress);
}
