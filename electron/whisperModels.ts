// electron/whisperModels.ts — downloading/managing the whisper.cpp ggml
// model files used for Live Captions (2026-11-06). Separate from
// electron/whisperCaptions.ts's own windowing/transcription logic, same
// split electron/voiceModels.ts already keeps from voiceCommands.ts.
//
// Two real, benchmarked options (see the full accuracy/timing writeup —
// 6 models x 2 real TTS test clips, CPU timing from whisper-cli's own
// printed diagnostics): larger "medium"/"large-v3-turbo" models both came
// back with a real-time factor well over 1 (9-18s of CPU time to transcribe
// 7-11s of audio) — dead on arrival for a LIVE captioning feature, so
// they're deliberately not offered here at all, even though whisper.cpp can
// run them. "small.en" quantized (q5_1) botched the one tricky proper noun
// in testing three different ways; the full-precision "small.en" got it
// right at virtually identical speed (quantization bought nothing here) —
// so the accurate tier intentionally skips the quantized small variant.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

export type WhisperModelKey = 'base' | 'small';

interface WhisperModelSource { url: string; fileName: string; label: string; sizeHint: string }

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_MODEL_SOURCES: Record<WhisperModelKey, WhisperModelSource> = {
  base: {
    url: `${HF_BASE}/ggml-base.en-q5_1.bin`,
    fileName: 'ggml-base.en-q5_1.bin',
    label: 'Base (fast)',
    sizeHint: '~57MB — real-time factor ~0.1, lowest CPU cost, misses less-common names/words more often',
  },
  small: {
    url: `${HF_BASE}/ggml-small.en.bin`,
    fileName: 'ggml-small.en.bin',
    label: 'Small (accurate)',
    sizeHint: '~465MB — real-time factor ~0.4, still comfortably faster than real time, noticeably better at names/brands/usernames',
  },
};

function modelsRoot(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

export function whisperModelPathFor(key: WhisperModelKey): string {
  return path.join(modelsRoot(), WHISPER_MODEL_SOURCES[key].fileName);
}

export function isWhisperModelReady(key: WhisperModelKey): boolean {
  try {
    return fs.statSync(whisperModelPathFor(key)).size > 0;
  } catch {
    return false;
  }
}

function httpsGetFollowingRedirects(url: string, onResponse: (res: import('http').IncomingMessage) => void, onError: (err: Error) => void): void {
  https.get(url, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      httpsGetFollowingRedirects(res.headers.location, onResponse, onError);
      return;
    }
    if (res.statusCode !== 200) {
      onError(new Error(`Download failed: HTTP ${res.statusCode}`));
      return;
    }
    onResponse(res);
  }).on('error', onError);
}

export async function downloadWhisperModel(key: WhisperModelKey, onProgress: (pct: number) => void): Promise<void> {
  fs.mkdirSync(modelsRoot(), { recursive: true });
  const dest = whisperModelPathFor(key);
  const tmpDest = `${dest}.download`;
  await new Promise<void>((resolve, reject) => {
    httpsGetFollowingRedirects(WHISPER_MODEL_SOURCES[key].url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let loaded = 0;
      const file = fs.createWriteStream(tmpDest);
      res.on('data', (chunk) => {
        loaded += chunk.length;
        if (total > 0) onProgress(Math.round((loaded / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
      file.on('error', reject);
    }, reject);
  });
  fs.renameSync(tmpDest, dest);
  onProgress(100);
}
