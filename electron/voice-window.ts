// electron/voice-window.ts — a hidden, never-shown BrowserWindow that does
// ONLY mic capture (src/VoiceApp.tsx, getUserMedia — a renderer-only API).
// Real recognition (Vosk) lives entirely in electron/voiceCommands.ts, in
// THIS (main) process — mirrors overlay-window.ts's own "created once, left
// running" shape, except this window is NEVER shown at all.
//
// Only created when Voice Commands is actually turned on (lazy — nothing
// is downloaded or loaded into memory for a streamer who never touches
// this feature), and destroyed when turned off.
import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { handleAudioFrame, startPolling, stopPolling } from './voiceCommands';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let voiceWindow: BrowserWindow | null = null;

export function isVoiceListening(): boolean {
  return !!voiceWindow;
}

export function startVoiceListening(preferredInputDeviceId: string | null): void {
  if (voiceWindow) {
    voiceWindow.webContents.send('voice:set-input-device', preferredInputDeviceId);
    return;
  }

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}voice.html`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/voice.html'));
  }

  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[voice console]', message);
  });

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('voice:set-input-device', preferredInputDeviceId);
  });

  voiceWindow = win;
  win.on('closed', () => { voiceWindow = null; });

  startPolling();
}

export function stopVoiceListening(): void {
  stopPolling();
  if (!voiceWindow) return;
  voiceWindow.destroy();
  voiceWindow = null;
}

export function setVoiceInputDevice(deviceId: string | null): void {
  voiceWindow?.webContents.send('voice:set-input-device', deviceId);
}

// Registered once, globally (not per-window) — only the hidden voice
// window ever actually sends this channel. Each frame is a plain
// ArrayBuffer of 16-bit PCM samples (src/VoiceApp.tsx) — wrapped into a
// real Node Buffer here since that's what vosk-koffi's acceptWaveform
// expects, and handed straight to voiceCommands.ts's recognition pipeline.
export function registerVoiceIpc(): void {
  ipcMain.on('voice:audio-frame', (_e, frame: ArrayBuffer) => {
    handleAudioFrame(Buffer.from(frame)).catch((err) => console.error('[voice] handleAudioFrame error:', err?.message || err));
  });
}
