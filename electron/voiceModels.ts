// electron/voiceModels.ts — downloading/managing the real Vosk model used
// for Voice Commands (2026-10-23; collapsed to Small-only 2026-11-06 —
// direct decision after confirming Live Captions' whisper.cpp engine is
// the one that actually needed accuracy. Voice Commands only ever matches
// a short, closed phrase list, which is exactly Small's strict-grammar
// mode's strength — Medium/Large/Extra Large just cost more RAM/CPU for
// open-vocabulary accuracy this feature never uses, and Medium's own
// "-lgraph" lazy-graph tradeoff made it feel laggy live for no benefit
// here). Separate from voiceCommands.ts's own recognition logic so the
// "is it downloaded, download it" concerns don't tangle with the actual
// recognizer/matching code.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import yauzl from 'yauzl';

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const MODEL_DIR_NAME = 'vosk-model-small-en-us-0.15';

function modelsRoot(): string {
  return path.join(app.getPath('userData'), 'voice-models');
}

export function modelDir(): string {
  return path.join(modelsRoot(), MODEL_DIR_NAME);
}

// A Vosk model directory always contains a real "conf" subfolder with its
// pipeline config — checking for that (not just "the folder exists") avoids
// a half-extracted/interrupted download being mistaken for a ready model.
export function isModelReady(): boolean {
  return fs.existsSync(path.join(modelDir(), 'conf'));
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

function downloadZip(url: string, destZipPath: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    httpsGetFollowingRedirects(url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let loaded = 0;
      const file = fs.createWriteStream(destZipPath);
      res.on('data', (chunk) => {
        loaded += chunk.length;
        if (total > 0) onProgress(Math.round((loaded / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
      file.on('error', reject);
    }, reject);
  });
}

// Extracts a downloaded model zip directly into modelsRoot() — Vosk's own
// zip already contains one top-level folder matching MODEL_DIR_NAME,
// confirmed directly against a real downloaded file before this was
// written, so no renaming/restructuring is needed, just a plain extract.
function extractZip(zipPath: string, destRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error('Failed to open model archive'));
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const outPath = path.join(destRoot, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(outPath, { recursive: true });
          zipfile.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        zipfile.openReadStream(entry, (err2, readStream) => {
          if (err2 || !readStream) return reject(err2 || new Error('Failed to read archive entry'));
          const out = fs.createWriteStream(outPath);
          readStream.pipe(out);
          out.on('finish', () => zipfile.readEntry());
          out.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve());
      zipfile.on('error', reject);
    });
  });
}

export async function downloadModel(onProgress: (pct: number) => void): Promise<void> {
  fs.mkdirSync(modelsRoot(), { recursive: true });
  const zipPath = path.join(modelsRoot(), `${MODEL_DIR_NAME}.download.zip`);
  try {
    // Download is 0-90% of the reported progress, extraction the last 10% —
    // extraction has no good native progress signal, this just avoids the
    // progress bar looking stuck at 100% during extraction.
    await downloadZip(MODEL_URL, zipPath, (pct) => onProgress(Math.round(pct * 0.9)));
    onProgress(92);
    await extractZip(zipPath, modelsRoot());
    onProgress(100);
  } finally {
    fs.rm(zipPath, { force: true }, () => {});
  }
}
