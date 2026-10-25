// electron/store.ts — local, persisted settings. Plain JSON file in
// Electron's own per-OS userData folder rather than a dependency like
// electron-store — this app has one small config object, so a hand-rolled
// read/write is less risk than pulling in a package whose current major
// version may be ESM-only (a real, known gotcha for several "electron-*"
// helper packages — see obs-websocket-js's own header comment).

import { app } from 'electron';
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
  hueBridges: [],
  lightDevices: [],
  lightScenes: [],
  activeLightSceneId: null,
  lightReactions: [],
  voiceEnabled: false,
  voiceInputDeviceId: null,
  voiceModelSize: 'small',
  voiceStrictVocabulary: false,
  voiceRecognitionWords: [],
  voiceLiveCaptionsEnabled: false,
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig(): DesktopConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial: Partial<DesktopConfig>): DesktopConfig {
  const next = { ...loadConfig(), ...partial };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
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
