// electron/voice-window.ts — a hidden, never-shown BrowserWindow that does
// ONLY mic capture (src/VoiceApp.tsx, getUserMedia — a renderer-only API).
// Real recognition (Vosk, for Voice COMMANDS) lives entirely in
// electron/voiceCommands.ts, in THIS (main) process — mirrors
// overlay-window.ts's own "created once, left running" shape, except this
// window is NEVER shown at all.
//
// Every raw PCM frame this window streams up ALSO reaches
// electron/whisperCaptions.ts (2026-11-06) — a second, independent
// consumer for Live Captions specifically, since Vosk is the wrong tool for
// open-vocabulary speech (see that file's own header). It's a genuine no-op
// whenever Live Captions is off, so a streamer who only wants Voice
// Commands pays zero extra cost for it.
//
// Only created when Voice Commands is actually turned on (lazy — nothing
// is downloaded or loaded into memory for a streamer who never touches
// this feature), and destroyed when turned off.
import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { handleAudioFrame, startPolling, stopPolling } from './voiceCommands';
import { handleCaptionAudioFrame, configureWhisperCaptions, setWhisperCaptionsEnabled, teardownWhisperCaptions } from './whisperCaptions';
import { loadConfig } from './store';

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
  const cfg = loadConfig();
  configureWhisperCaptions(cfg.voiceCaptionsModel);
  setWhisperCaptionsEnabled(cfg.voiceLiveCaptionsEnabled);
}

export function stopVoiceListening(): void {
  stopPolling();
  teardownWhisperCaptions();
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
// expects, and handed to BOTH consumers: voiceCommands.ts (Vosk, Voice
// Commands matching) and whisperCaptions.ts (Live Captions — a cheap
// synchronous no-op whenever that's turned off).
export function registerVoiceIpc(): void {
  ipcMain.on('voice:audio-frame', (_e, frame: ArrayBuffer) => {
    const buffer = Buffer.from(frame);
    handleAudioFrame(buffer).catch((err) => console.error('[voice] handleAudioFrame error:', err?.message || err));
    handleCaptionAudioFrame(buffer);
  });
}
