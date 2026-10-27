// electron/obs-client.ts — a persistent connection to OBS's own built-in
// WebSocket server (OBS 28+, Tools -> obs-websocket Settings). Browse
// scenes/sources, switch the current scene, show/hide a source, and
// start/stop streaming+recording. Chat-triggered OBS control (a Pulse
// Engine action broadcasting an event this module reacts to — see
// main.ts's handleWsMessage) is real and wired up: obs.switchScene has
// been live since 2026-10-15, obs.startStream/stopStream/startRecord/
// stopRecord the same day right alongside the stream/record controls below.
//
// `obs-websocket-js` ships ESM-only ("type": "module" in its own
// package.json) while this file compiles to CommonJS — a plain top-level
// `import` would try to `require()` it and fail at runtime. A dynamic
// `import()` is the standard, correct escape hatch: Node's CommonJS can
// always `import()` an ESM module, and TypeScript preserves a dynamic
// `import()` expression as a real dynamic import even when the surrounding
// file is compiled to CommonJS (it does NOT rewrite it to require()).

import type { ObsSceneInfo, ObsSceneItemInfo, ObsStatus } from './types';

type OBSWebSocketInstance = InstanceType<typeof import('obs-websocket-js').default>;

let obs: OBSWebSocketInstance | null = null;
let status: ObsStatus = {
  connected: false, connecting: false, currentScene: null, scenes: [],
  streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0,
  sources: [],
};
let listeners: Array<(s: ObsStatus) => void> = [];

function setStatus(next: Partial<ObsStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((cb) => cb(status));
}

export function onObsStatusChange(cb: (s: ObsStatus) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getObsStatus(): ObsStatus {
  return status;
}

async function refreshSceneList(): Promise<void> {
  if (!obs) return;
  const { scenes, currentProgramSceneName } = await obs.call('GetSceneList');
  const sceneInfos: ObsSceneInfo[] = (scenes as any[])
    .map((s) => ({ sceneName: String(s.sceneName), sceneUuid: String(s.sceneUuid) }))
    .reverse(); // OBS returns scenes top-of-stack-first; reverse reads top-to-bottom like OBS's own UI list
  setStatus({ scenes: sceneInfos, currentScene: currentProgramSceneName || null });
  await refreshAllSceneItems();
}

// Every (scene, source) pair across every known scene — for the
// obs_toggle_source Pulse Engine action's own picker (2026-10-16). One
// GetSceneItemList call per scene; cheap enough to re-run in full on any of
// the triggers below rather than trying to patch the list incrementally.
// A scene with items obs-websocket can't enumerate (a rare malformed scene)
// just contributes nothing for that one scene — never fails the whole pass.
async function refreshAllSceneItems(): Promise<void> {
  if (!obs) return;
  const scenes = status.scenes;
  const pairs: { sceneName: string; sourceName: string }[] = [];
  for (const scene of scenes) {
    try {
      const items = await getSceneItems(scene.sceneName);
      for (const item of items) pairs.push({ sceneName: scene.sceneName, sourceName: item.sourceName });
    } catch (err) {
      console.error('[obs] failed to list items for scene', scene.sceneName, (err as any)?.message || err);
    }
  }
  setStatus({ sources: pairs });
}

export async function connectObs(url: string, password: string): Promise<void> {
  await disconnectObs();
  setStatus({ connecting: true, error: undefined });

  try {
    const { default: OBSWebSocket } = await import('obs-websocket-js');
    const client = new OBSWebSocket();
    obs = client;

    client.on('ConnectionClosed', () => {
      setStatus({ connected: false, connecting: false, currentScene: null, scenes: [], sources: [], streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0 });
    });
    client.on('CurrentProgramSceneChanged', (data) => {
      setStatus({ currentScene: data.sceneName });
    });
    client.on('SceneListChanged', () => {
      refreshSceneList().catch((err) => console.error('[obs] scene list refresh failed', err));
    });
    // A source added/removed/reordered anywhere — re-run the full (scene,
    // source) pass (2026-10-16). Debounced lightly isn't worth the added
    // complexity here: these fire on a deliberate user action in OBS
    // (dragging a new source in, deleting one), not continuously.
    client.on('SceneItemCreated', () => {
      refreshAllSceneItems().catch((err) => console.error('[obs] source list refresh failed', err));
    });
    client.on('SceneItemRemoved', () => {
      refreshAllSceneItems().catch((err) => console.error('[obs] source list refresh failed', err));
    });
    client.on('SceneItemListReindexed', () => {
      refreshAllSceneItems().catch((err) => console.error('[obs] source list refresh failed', err));
    });
    client.on('StreamStateChanged', (data) => {
      setStatus({ streaming: Boolean(data.outputActive) });
    });
    client.on('RecordStateChanged', (data) => {
      setStatus({ recording: Boolean(data.outputActive) });
    });

    await client.connect(url, password || undefined);
    setStatus({ connected: true, connecting: false, error: undefined, errorCode: undefined });
    await refreshSceneList();
    await refreshOutputStatus();
  } catch (err: any) {
    obs = null;
    setStatus({
      connected: false,
      connecting: false,
      error: err?.message || 'Failed to connect to OBS',
      errorCode: typeof err?.code === 'number' ? err.code : undefined,
    });
    throw err;
  }
}

async function refreshOutputStatus(): Promise<void> {
  if (!obs) return;
  try {
    const [stream, record] = await Promise.all([obs.call('GetStreamStatus'), obs.call('GetRecordStatus')]);
    setStatus({
      streaming: Boolean(stream.outputActive), streamDurationMs: Number(stream.outputDuration) || 0,
      recording: Boolean(record.outputActive), recordDurationMs: Number(record.outputDuration) || 0,
    });
  } catch (err) {
    // Non-fatal — scenes/sources still work even if this specific call fails
    // (e.g. an older OBS build with a partial obs-websocket implementation).
    console.error('[obs] output status refresh failed', err);
  }
}

export async function disconnectObs(): Promise<void> {
  if (obs) {
    try {
      await obs.disconnect();
    } catch {
      // already gone
    }
  }
  obs = null;
  setStatus({ connected: false, connecting: false, currentScene: null, scenes: [], sources: [], error: undefined, errorCode: undefined, streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0 });
}

export async function switchScene(sceneName: string): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('SetCurrentProgramScene', { sceneName });
}

export async function getSceneItems(sceneName: string): Promise<ObsSceneItemInfo[]> {
  if (!obs) throw new Error('Not connected to OBS');
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  return (sceneItems as any[]).map((i) => ({
    sceneItemId: Number(i.sceneItemId),
    sourceName: String(i.sourceName),
    sceneItemEnabled: Boolean(i.sceneItemEnabled),
  }));
}

export async function setSceneItemEnabled(sceneName: string, sceneItemId: number, enabled: boolean): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
}

// obs_toggle_source (2026-10-16) — resolves the real numeric sceneItemId by
// (sceneName, sourceName) at fire time rather than requiring one to be
// tracked/reported up to the website at all (same "matched by name, not a
// stored id" reasoning switchScene's own sceneName already uses — see
// PulseAction's own comment on obsSourceScene/obsSourceName). `visible`
// undefined means "toggle": flip whatever the source's current state is.
export async function toggleSourceVisible(sceneName: string, sourceName: string, visible?: boolean): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  const items = await getSceneItems(sceneName);
  const item = items.find((i) => i.sourceName === sourceName);
  if (!item) throw new Error(`No source named "${sourceName}" in scene "${sceneName}"`);
  const next = visible === undefined ? !item.sceneItemEnabled : visible;
  await setSceneItemEnabled(sceneName, item.sceneItemId, next);
}

// Stream/record controls (2026-10-15) — each call just fires the request;
// the real resulting state comes back through the StreamStateChanged/
// RecordStateChanged event handlers above (and from OBS itself, if the
// streamer starts/stops it manually from the OBS UI instead), not from the
// response of these calls — same "server/source of truth pushes state,
// caller doesn't assume" pattern the scene list already uses.
export async function startStream(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StartStream');
}
export async function stopStream(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StopStream');
}
export async function startRecord(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StartRecord');
}
export async function stopRecord(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StopRecord');
}

// Replay Buffer controls (2026-10-18, direct request: "a clip option that
// saves replay buffer... make a !clip command do it"). Same fire-the-
// request shape as start/stop stream/record above. SaveReplayBuffer only
// actually writes a file if the buffer is already running — either OBS's
// own "Automatically start when streaming" setting, or startReplayBuffer
// below; a plain `obs.call` rejection (buffer not active) surfaces as a
// console error one level up (main.ts's handleWsMessage), same as every
// other obs.* handler here has no way to report a failure back to the rule
// that fired it.
export async function startReplayBuffer(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StartReplayBuffer');
}
export async function stopReplayBuffer(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('StopReplayBuffer');
}
export async function saveReplayBuffer(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('SaveReplayBuffer');
}

// Aitum Vertical's own Backtrack buffer (2026-10-27, direct request: "can we
// get aitum vertical working with OBS clipping"). Aitum Vertical is an OBS
// PLUGIN, not a separate app with its own connection — it rides over this
// same obs-websocket connection and registers itself as a "vendor"
// (CallVendorRequest, a standard, documented obs-websocket RPC — not a
// custom protocol). Confirmed directly from Aitum's own plugin source
// (github.com/Aitum/obs-vertical-canvas, vertical-canvas.cpp) rather than
// guessed from a forum post: vendor name "aitum-vertical-canvas", with
// start_backtrack/stop_backtrack literally invoking OBS's own
// StartReplayBuffer/StopReplayBuffer slots, and save_backtrack invoking
// ReplayButtonClicked (the same save-the-buffer action OBS's own Save
// Replay Buffer button fires) — Backtrack genuinely IS "OBS's replay
// buffer, running a second time for the vertical canvas," not a separate
// mechanism, matching what several real users independently reported.
// Throws (same as every obs.call above) if Aitum Vertical isn't installed/
// loaded in the connected OBS — CallVendorRequest rejects when no vendor
// with that name has registered.
export async function startAitumBacktrack(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'start_backtrack', requestData: {} });
}
export async function stopAitumBacktrack(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'stop_backtrack', requestData: {} });
}
export async function saveAitumBacktrack(): Promise<void> {
  if (!obs) throw new Error('Not connected to OBS');
  await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'save_backtrack', requestData: {} });
}
