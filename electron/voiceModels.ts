// electron/voiceModels.ts — downloading/managing real Vosk model files
// (2026-10-23). Separate from voiceCommands.ts's own recognition logic so
// the "which model, is it downloaded, download it" concerns don't tangle
// with the actual recognizer/matching code.
//
// Four real, verified-live model sizes spanning the same range Lumia Stream
// offers (0.15 through 0.42) — every URL below was confirmed with a real
// HEAD request before being hardcoded here, not guessed:
//   small  ~40MB   vosk-model-small-en-us-0.15      fastest, least accurate
//   medium ~130MB  vosk-model-en-us-0.22-lgraph     a real middle ground
//   large  ~1.8GB  vosk-model-en-us-0.22            Vosk's standard "big" US English model
//   xlarge ~2.3GB  vosk-model-en-us-0.42-gigaspeech most accurate, slowest/most RAM
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import yauzl from 'yauzl';

export type VoiceModelSize = 'small' | 'medium' | 'large' | 'xlarge';

interface ModelSource { url: string; dirName: string; label: string; sizeHint: string }

export const MODEL_SOURCES: Record<VoiceModelSize, ModelSource> = {
  small: {
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',
    dirName: 'vosk-model-small-en-us-0.15',
    label: 'Small', sizeHint: '~40MB — fastest, least accurate',
  },
  medium: {
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip',
    dirName: 'vosk-model-en-us-0.22-lgraph',
    // 2026-10-27: the hint now flags the real "-lgraph" tradeoff — direct
    // report that medium specifically felt laggy, confirmed as a genuine
    // Vosk characteristic (lazy graph expansion during decode, not a bug)
    // rather than something fixable here — see VoiceCommandsPage.tsx's
    // matching MODEL_OPTIONS hint for the fuller explanation.
    label: 'Medium', sizeHint: '~130MB — smaller download, but can decode slower live than Large',
  },
  large: {
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip',
    dirName: 'vosk-model-en-us-0.22',
    label: 'Large', sizeHint: '~1.8GB — Vosk\'s standard "big" English model',
  },
  xlarge: {
    url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.42-gigaspeech.zip',
    dirName: 'vosk-model-en-us-0.42-gigaspeech',
    label: 'Extra Large', sizeHint: '~2.3GB — most accurate, slowest',
  },
};

function modelsRoot(): string {
  return path.join(app.getPath('userData'), 'voice-models');
}

export function modelDirFor(size: VoiceModelSize): string {
  return path.join(modelsRoot(), MODEL_SOURCES[size].dirName);
}

// A Vosk model directory always contains a real "conf" subfolder with its
// pipeline config — checking for that (not just "the folder exists") avoids
// a half-extracted/interrupted download being mistaken for a ready model.
export function isModelReady(size: VoiceModelSize): boolean {
  return fs.existsSync(path.join(modelDirFor(size), 'conf'));
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
// zips already contain one top-level folder matching MODEL_SOURCES[size]
// .dirName, confirmed directly against a real downloaded file before this
// was written, so no renaming/restructuring is needed, just a plain extract.
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

export async function downloadModel(size: VoiceModelSize, onProgress: (pct: number) => void): Promise<void> {
  fs.mkdirSync(modelsRoot(), { recursive: true });
  const zipPath = path.join(modelsRoot(), `${MODEL_SOURCES[size].dirName}.download.zip`);
  try {
    // Download is 0-90% of the reported progress, extraction the last 10% —
    // extraction has no good native progress signal, this just avoids the
    // progress bar looking stuck at 100% for the (sometimes lengthy, for
    // the 1.8-2.3GB models) extraction step.
    await downloadZip(MODEL_SOURCES[size].url, zipPath, (pct) => onProgress(Math.round(pct * 0.9)));
    onProgress(92);
    await extractZip(zipPath, modelsRoot());
    onProgress(100);
  } finally {
    fs.rm(zipPath, { force: true }, () => {});
  }
}
