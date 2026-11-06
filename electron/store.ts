// electron/store.ts — local, persisted settings. Plain JSON file in
// Electron's own per-OS userData folder rather than a dependency like
// electron-store — this app has one small config object, so a hand-rolled
// read/write is less risk than pulling in a package whose current major
// version may be ESM-only (a real, known gotcha for several "electron-*"
// helper packages — see obs-websocket-js's own header comment).

import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConfig, LocalMediaItem } from './types';

const DEFAULTS: DesktopConfig = {
  apiKey: null,
  localMediaLibrary: [],
  obsUrl: 'ws://127.0.0.1:4455',
  obsPassword: '',
  meldUrl: 'ws://127.0.0.1:13376',
  overlayDisplayId: null,
  minimizeToTrayOnClose: true,
  trayHintShown: false,
  hueBridges: [],
  lightDevices: [],
  lightScenes: [],
  activeLightSceneId: null,
  lightReactions: [],
  voiceEnabled: false,
  voiceInputDeviceId: null,
  voiceStrictVocabulary: false,
  voiceRecognitionWords: [],
  voiceLiveCaptionsEnabled: false,
  voiceCaptionsModel: 'small',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

// Secrets at rest (2026-11-01) — apiKey and obsPassword used to be written
// to config.json in plain text; both are real credentials (the API key is
// the same bearer token the Stream Deck plugin uses, the OBS password often
// doubles as the one guarding the actual stream). safeStorage encrypts with
// the OS's own credential store (Windows DPAPI, tied to the logged-in user)
// — no key management of our own. ENC_PREFIX marks an already-encrypted
// value so a pre-existing plaintext config.json keeps reading correctly
// (decryptSecret just returns it as-is); the NEXT saveConfig() call
// re-writes it encrypted, so migration is automatic and lazy, no explicit
// migration step needed.
const ENC_PREFIX = 'enc:v1:';

function encryptSecret(value: string | null): string | null {
  if (value == null || value === '') return value;
  if (!safeStorage.isEncryptionAvailable()) return value; // best-effort — never lose the value just because encryption isn't available
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value: string | null): string | null {
  if (value == null || !value.startsWith(ENC_PREFIX)) return value; // plaintext (pre-encryption config, or encryption was unavailable when saved)
  if (!safeStorage.isEncryptionAvailable()) return null; // can't decrypt without the OS keychain that encrypted it — treat as absent, not as ciphertext
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return null;
  }
}

export function loadConfig(): DesktopConfig {
  let raw: Partial<DesktopConfig> = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    raw = {};
  }
  const merged: DesktopConfig = { ...DEFAULTS, ...raw };
  // Decrypted in-memory shape — every existing caller already does
  // `loadConfig().apiKey` etc. expecting the real usable value, so this
  // stays the one place that knows about ENC_PREFIX at all.
  merged.apiKey = decryptSecret(merged.apiKey);
  merged.obsPassword = decryptSecret(merged.obsPassword) ?? '';
  return merged;
}

export function saveConfig(partial: Partial<DesktopConfig>): DesktopConfig {
  const next = { ...loadConfig(), ...partial };
  const onDisk = {
    ...next,
    apiKey: encryptSecret(next.apiKey),
    obsPassword: encryptSecret(next.obsPassword) ?? '',
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(onDisk, null, 2), 'utf8');
  return next;
}

export function addLocalMediaItem(filePath: string): LocalMediaItem {
  const cfg = loadConfig();
  const item: LocalMediaItem = {
    id: crypto.randomUUID(),
    filePath,
    fileName: path.basename(filePath),
    addedAt: Date.now(),
  };
  saveConfig({ localMediaLibrary: [...cfg.localMediaLibrary, item] });
  return item;
}

export function removeLocalMediaItem(id: string): void {
  const cfg = loadConfig();
  saveConfig({ localMediaLibrary: cfg.localMediaLibrary.filter((i) => i.id !== id) });
}
