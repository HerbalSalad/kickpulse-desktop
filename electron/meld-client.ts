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
// Clip/replay (2026-10-26) — confirmed live against Meld's own
// WebChannelAPI.md (github.com/MeldStudio/streamdeck), not guessed: there's
// no dedicated recordClip()/showReplay() method on the `meld` object itself
// (unlike showScene/toggleLayer above) — both go through the same generic
// sendCommand/sendCommandWithArgs dispatch startStream/stopStream already
// use. `meld.recordClip` takes at most one optional arg, a clip duration in
// seconds (0-90; omitted or 0 = the max available, same as Meld's own UI
// button with no hotkey-configured length). `meld.replay.show` plays the
// most recent clip back as a temporary overlay on the current scene (Meld's
// own "Instant Replay"); `meld.replay.dismiss` removes it. This directly
// answers a real open question from the file's own original 2026-10-25
// header: Meld DOES have a replay-buffer-equivalent, it was just never
// looked up before — confirmed via Mix It Up's own published Meld action
// list (which already ships a "Record Clip" action using this exact
// command) before trusting the raw API doc text.
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
import type { MeldSceneInfo, MeldLayerInfo, MeldEffectInfo, MeldStatus } from './types';
import WebSocket from 'ws';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QWebChannel } = require('qwebchannel');

let socket: WebSocket | null = null;
let meld: any = null;
let status: MeldStatus = {
  connected: false, connecting: false, currentSceneId: null,
  scenes: [], layers: [], effects: [], streaming: false, recording: false,
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

function parseSession(session: any): { scenes: MeldSceneInfo[]; layers: MeldLayerInfo[]; effects: MeldEffectInfo[]; currentSceneId: string | null } {
  const items: Record<string, any> = session?.items || {};
  const scenes: MeldSceneInfo[] = [];
  const layers: MeldLayerInfo[] = [];
  const effects: MeldEffectInfo[] = [];
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
  // Effect items (2026-10-30, for meld_toggle_filter — direct request:
  // "trigger and control filters for OBS and meld") — confirmed against
  // Meld's own WebChannelAPI.md: { type: 'effect', parent: <layerId>,
  // name, enabled }, unlike layers above this one IS fully documented,
  // not inferred.
  for (const [id, item] of Object.entries(items)) {
    if (item?.type !== 'effect') continue;
    const layer = layers.find((l) => l.layerId === item.parent);
    if (!layer) continue; // can't place this effect under a known layer — drop it rather than guess
    effects.push({
      sceneId: layer.sceneId, layerId: layer.layerId, effectId: id,
      effectName: typeof item.name === 'string' && item.name.trim() ? item.name : id,
      enabled: item.enabled !== false,
    });
  }
  return { scenes, layers, effects, currentSceneId };
}

function applySession(): void {
  if (!meld) return;
  const parsed = parseSession(meld.session);
  setStatus({ scenes: parsed.scenes, layers: parsed.layers, effects: parsed.effects, currentSceneId: parsed.currentSceneId });
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
      setStatus({ connected: false, connecting: false, currentSceneId: null, scenes: [], layers: [], effects: [], streaming: false, recording: false });
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
  setStatus({ connected: false, connecting: false, currentSceneId: null, scenes: [], layers: [], effects: [], error: undefined, streaming: false, recording: false });
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

// meld_toggle_filter (2026-10-30, direct request: "trigger and control
// filters for OBS and meld"). Meld's WebChannelAPI only has
// toggleEffect(sceneId, layerId, effectId) — a bare flip, no explicit
// on/off setter (confirmed against Meld's own WebChannelAPI.md, see this
// file's header). enabled undefined means "just toggle, whatever it is" —
// calls toggleEffect unconditionally. enabled true/false means "make sure
// it ends up in this state" — only calls toggleEffect if this app's own
// already-tracked state (status.effects, kept live via sessionChanged)
// doesn't already match, since calling it when already correct would flip
// it the WRONG way.
export async function toggleEffect(sceneId: string, layerId: string, effectId: string, enabled?: boolean): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  if (enabled === undefined) {
    meld.toggleEffect(sceneId, layerId, effectId);
    return;
  }
  const current = status.effects.find((e) => e.effectId === effectId && e.layerId === layerId);
  if (!current || current.enabled !== enabled) meld.toggleEffect(sceneId, layerId, effectId);
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

// recordClip/showReplay/dismissReplay (2026-10-26) — see this file's header
// for how these were confirmed. durationSeconds is optional and clamped to
// Meld's own documented 0-90 range; omitted entirely records the max
// available length, same as pressing Meld's own Clip button with no custom
// hotkey length configured.
export async function recordClip(durationSeconds?: number): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  if (typeof durationSeconds === 'number' && durationSeconds > 0) {
    meld.sendCommandWithArgs('meld.recordClip', [Math.max(0, Math.min(90, Math.round(durationSeconds)))]);
  } else {
    meld.sendCommand('meld.recordClip');
  }
}
export async function showReplay(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.replay.show');
}
export async function dismissReplay(): Promise<void> {
  if (!meld) throw new Error('Not connected to Meld Studio');
  meld.sendCommand('meld.replay.dismiss');
}
