// electron/meld-client.ts — a connection to Meld Studio's own built-in
// WebChannel API (not all streamers use OBS — 2026-10-25, direct request).
//
// Meld's control protocol is genuinely different from OBS's: OBS exposes a
// plain JSON-RPC-style WebSocket (obs-websocket-js talks to it directly);
// Meld instead uses Qt's QWebChannel protocol over a WebSocket, which needs
// Qt's own `qwebchannel` client library to speak (raw request/response
// framing isn't publicly documented, only the resulting JS object API is).
// `qwebchannel` ships no TypeScript types and is pure CommonJS — a plain
// `require()` (returns `any`) is the correct, deliberate choice here, not an
// oversight; this file compiles to CommonJS the same as every other
// electron/*.ts file.
//
// Source for everything below: Meld's own WebChannelAPI.md
// (github.com/MeldStudio/streamdeck) — confirmed, not guessed:
//   - Connect: ws://127.0.0.1:13376, QWebChannel protocol, object `meld`.
//   - No password/auth at all — trusted-local-network-only by design
//     (same posture OBS's own websocket had before it added one).
//   - Properties: isStreaming, isRecording, session ({ items: { id: item } }).
//   - Signals: sessionChanged, isStreamingChanged, isRecordingChanged.
//   - Functions: showScene(sceneId), toggleLayer(sceneId, layerId),
//     sendCommand('meld.startStreamingAction' | 'stopStreamingAction' |
//     'startRecordingAction' | 'stopRecordingAction').
//
// NOT INDEPENDENTLY CONFIRMED (the one real gap, flagged rather than
// hidden): Meld's own docs never spell out the exact field names on a
// `session.items` entry beyond a `type` field ('scene' | 'layer' | 'track' |
// 'effect'). `name`/`parent`/`current` below are the standard, most likely
// field names for "display label" / "which scene a layer belongs to" /
// "which scene is live" — but this is inferred, not confirmed from Meld's
// own text. parseSession() degrades safely if any of these guesses are
// wrong (falls back to the raw id as a display name, and a layer with no
// resolvable parent is just dropped rather than crashing) — this is
// specifically the kind of thing a real tester against a real running Meld
// Studio instance (see the app's own testing notes) needs to verify; don't
// treat this mapping as settled until that happens.
import type { MeldSceneInfo, MeldLayerInfo, MeldStatus } from './types';
import WebSocket from 'ws';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QWebChannel } = require('qwebchannel');

let socket: WebSocket | null = null;
let meld: any = null;
let status: MeldStatus = {
  connected: false, connecting: false, currentSceneId: null,
  scenes: [], layers: [], streaming: false, recording: false,
};
let listeners: Array<(s: MeldStatus) => void> = [];

function setStatus(next: Partial<MeldStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((cb) => cb(status));
}

export function onMeldStatusChange(cb: (s: MeldStatus) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getMeldStatus(): MeldStatus {
  return status;
}

function parseSession(session: any): { scenes: MeldSceneInfo[]; layers: MeldLayerInfo[]; currentSceneId: string | null } {
  const items: Record<string, any> = session?.items || {};
  const scenes: MeldSceneInfo[] = [];
  const layers: MeldLayerInfo[] = [];
  let currentSceneId: string | null = null;

  for (const [id, item] of Object.entries(items)) {
    if (item?.type === 'scene') {
      scenes.push({ sceneId: id, sceneName: typeof item.name === 'string' && item.name.trim() ? item.name : id });
      if (item.current) currentSceneId = id;
    }
  }
  for (const [id, item] of Object.entries(items)) {
    if (item?.type !== 'layer') continue;
    const parentId = item.parent ?? item.sceneId;
    const scene = scenes.find((s) => s.sceneId === parentId);
    if (!scene) continue; // can't place this layer under a known scene — drop it rather than guess
    // visible (2026-10-26) — the exact, confirmed property name from Meld's
    // own docs ("meld.setProperty(layerId, 'visible', false)"), not a
    // guess like name/parent/current above. Defaults true if genuinely
    // absent rather than hiding a layer we have no real signal about.
    layers.push({
      sceneId: scene.sceneId, layerId: id,
      layerName: typeof item.name === 'string' && item.name.trim() ? item.name : id,
      visible: item.visible !== false,
    });
  }
  return { scenes, layers, currentSceneId };
}

function applySession(): void {
  if (!meld) return;
  const parsed = parseSession(meld.session);
  setStatus({ scenes: parsed.scenes, layers: parsed.layers, currentSceneId: parsed.currentSceneId });
}

export async function connectMeld(url: string): Promise<void> {
  await disconnectMeld();
  setStatus({ connecting: true, error: undefined });

  try {
    const sock = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      sock.onopen = () => resolve();
      sock.onerror = (e: any) => reject(new Error(e?.message || "Couldn't reach Meld Studio"));
    });
    socket = sock;

    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line no-new
      new QWebChannel(sock, (channel: any) => {
        meld = channel.objects.meld;
        if (!meld) {
          reject(new Error("Meld Studio didn't expose its control object — check Settings → WebChannel API is enabled."));
          return;
        }
        resolve();
      });
    });

    sock.onclose = () => {
      meld = null;
      setStatus({ connected: false, connecting: false, currentSceneId: null, scenes: [], layers: [], streaming: false, recording: false });
    };

    meld.sessionChanged.connect(applySession);
    meld.isStreamingChanged.connect(() => setStatus({ streaming: !!meld.isStreaming }));
    meld.isRecordingChanged.connect(() => setStatus({ recording: !!meld.isRecording }));

    applySession();
    setStatus({ connected: true, connecting: false, error: undefined, streaming: !!meld.isStreaming, recording: !!meld.isRecording });
  } catch (err: any) {
    try { socket?.close(); } catch { /* already gone */ }
    socket = null;
    meld = null;
    setStatus({ connected: false, connecting: false, error: err?.message || "Couldn't reach Meld Studio" });
    throw err;
  }
}

export async function disconnectMeld(): Promise<void> {
  try { socket?.close(); } catch { /* already gone */ }
  socket = null;
  meld = null;
  setStatus({ connected: false, connecting: false, currentSceneId: null, scenes: [], layers: [], error: undefined, streaming: false, recording: false });
}

export async function switchScene(sceneId: string): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.showScene(sceneId);
}

export async function toggleLayer(sceneId: string, layerId: string): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.toggleLayer(sceneId, layerId);
}

// Explicit show/hide (2026-10-26) — the Broadcast Software page's own Toggle
// switch needs to set a KNOWN target state, the same way OBS's own
// setSceneItemEnabled does, rather than always flipping whatever it
// currently is (toggleLayer above, kept for Pulse Engine's own action).
export async function setLayerVisible(layerId: string, visible: boolean): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.setProperty(layerId, 'visible', visible);
}

// Explicit start/stop (not toggleStream/toggleRecord) — matches the OBS
// action set's own shape (obs_start_stream/obs_stop_stream are two separate,
// idempotent actions, not one toggle), and Meld's docs give an explicit
// command name for each direction rather than only a toggle.
export async function startStream(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.startStreamingAction');
}
export async function stopStream(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.stopStreamingAction');
}
export async function startRecord(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.startRecordingAction');
}
export async function stopRecord(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.stopRecordingAction');
}
