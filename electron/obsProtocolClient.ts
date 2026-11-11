// electron/obsProtocolClient.ts — the real obs-websocket v5 client logic,
// factored out of obs-client.ts (2026-11-08) so it can back TWO independent
// connections: real OBS, and Obzidian (kickpulse-streamer-qt, our own
// OBS/Meld competitor) — confirmed directly from that app's own
// engine/src/qt_app/ObsWebSocketServer.h header comment that it deliberately
// implements the real, documented obs-websocket v5 wire protocol (default
// port 4455, same as real OBS) specifically so existing tools built against
// it — this app included — can drive it with no new protocol work. Since
// the wire protocol is byte-identical, this is one real implementation
// shared by both, not two drifting copies — see obs-client.ts and
// obzidian-client.ts, each just a named instance of createObsProtocolClient().
//
// `obs-websocket-js` ships ESM-only ("type": "module" in its own
// package.json) while this file compiles to CommonJS — a plain top-level
// `import` would try to `require()` it and fail at runtime. A dynamic
// `import()` is the standard, correct escape hatch: Node's CommonJS can
// always `import()` an ESM module, and TypeScript preserves a dynamic
// `import()` expression as a real dynamic import even when the surrounding
// file is compiled to CommonJS (it does NOT rewrite it to require()).
//
// Real, found bug (not a guess): the bare `import('obs-websocket-js')`
// this file used to do resolves — per that package's own package.json
// "exports" map, under Node's ESM "import" condition — to dist/msgpack.js,
// NOT dist/json.js, so every connection silently requested the
// "obswebsocket.msgpack" WebSocket subprotocol. Real OBS's own
// obs-websocket plugin answers both msgpack and json, so that stayed
// invisible on the OBS tab — but Obzidian's server (ObsWebSocketServer.cpp)
// only ever advertises "obswebsocket.json", so the subprotocol negotiation
// came back empty and obs-websocket-js threw "Server sent no subprotocol"
// right after the handshake, before Hello/auth ever ran. Importing the
// "/json" subpath explicitly pins the variant actually spoken on the wire
// here, for both OBS and Obzidian — real OBS answers json fine too.

import type { ObsSceneInfo, ObsSceneItemInfo, ObsStatus } from './types';

// Type-only — erased at compile time, so tsc's moduleResolution choking on
// the "/json" subpath (see the real runtime import() below) doesn't apply
// here; the json/msgpack builds share the exact same OBSWebSocket type.
type OBSWebSocketInstance = InstanceType<typeof import('obs-websocket-js').default>;

export interface ObsProtocolClient {
  onStatusChange(cb: (s: ObsStatus) => void): () => void;
  getStatus(): ObsStatus;
  connect(url: string, password: string): Promise<void>;
  disconnect(): Promise<void>;
  switchScene(sceneName: string): Promise<void>;
  getSceneItems(sceneName: string): Promise<ObsSceneItemInfo[]>;
  setSceneItemEnabled(sceneName: string, sceneItemId: number | string, enabled: boolean): Promise<void>;
  toggleSourceVisible(sceneName: string, sourceName: string, visible?: boolean): Promise<void>;
  getSourceFilters(sourceName: string): Promise<{ filterName: string; filterEnabled: boolean }[]>;
  toggleSourceFilterEnabled(sourceName: string, filterName: string, enabled?: boolean): Promise<void>;
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  // canvasKey is Obzidian-only (ignored by real OBS, which has no canvas
  // concept) — see startRecord's own implementation comment.
  startRecord(canvasKey?: string): Promise<void>;
  stopRecord(canvasKey?: string): Promise<void>;
  startReplayBuffer(canvasKey?: string): Promise<void>;
  stopReplayBuffer(canvasKey?: string): Promise<void>;
  saveReplayBuffer(canvasKey?: string): Promise<void>;
  // Aitum Vertical's own Backtrack buffer — a real OBS PLUGIN reached
  // through CallVendorRequest (see obs-client.ts's own header for the full
  // confirmation trail). Not meaningful against Obzidian (no such plugin
  // concept exists there) — obzidian-client.ts simply doesn't export these,
  // but they stay here so OBS's own client keeps working unchanged.
  startAitumBacktrack(): Promise<void>;
  stopAitumBacktrack(): Promise<void>;
  saveAitumBacktrack(): Promise<void>;
}

// logTag — used only in console.error prefixes, so a failure in the
// Obzidian connection is never confused with a real OBS one in the logs.
export function createObsProtocolClient(logTag: string): ObsProtocolClient {
  let obs: OBSWebSocketInstance | null = null;
  // Auto-reconnect (2026-11-01, reliability fix) — OBS/Obzidian restarting or
  // crashing mid-stream used to just leave this app disconnected until
  // someone manually hit Connect again, silently breaking every Pulse
  // Engine action in the meantime. lastUrl/lastPassword remember what to
  // reconnect TO; explicitlyDisconnected is set by disconnect() (the user's
  // own Disconnect button, or app shutdown) so THAT kind of close never
  // triggers a reconnect loop; wasConnected only turns on after a connection
  // actually SUCCEEDED, so a bad URL/password on the very first attempt
  // fails once and surfaces to the caller instead of retrying forever in
  // the background against a typo.
  let lastUrl: string | null = null;
  let lastPassword = '';
  let explicitlyDisconnected = false;
  let wasConnected = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(delayMs = 3000): void {
    if (reconnectTimer || explicitlyDisconnected || !lastUrl) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (explicitlyDisconnected || !lastUrl) return;
      connect(lastUrl, lastPassword).catch(() => {
        // Still down — keep trying with backoff, capped at 30s, until it
        // either reconnects or the user explicitly disconnects.
        scheduleReconnect(Math.min(delayMs * 2, 30000));
      });
    }, delayMs);
  }

  let status: ObsStatus = {
    connected: false, connecting: false, currentScene: null, scenes: [],
    streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0,
    sources: [], filters: [],
  };
  let listeners: Array<(s: ObsStatus) => void> = [];

  function setStatus(next: Partial<ObsStatus>): void {
    status = { ...status, ...next };
    listeners.forEach((cb) => cb(status));
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
  // obs_toggle_source Pulse Engine action's own picker. One GetSceneItemList
  // call per scene; cheap enough to re-run in full on any of the triggers
  // below rather than trying to patch the list incrementally. A scene with
  // items obs-websocket can't enumerate (a rare malformed scene) just
  // contributes nothing for that one scene — never fails the whole pass.
  async function refreshAllSceneItems(): Promise<void> {
    if (!obs) return;
    const scenes = status.scenes;
    const pairs: { sceneName: string; sourceName: string }[] = [];
    for (const scene of scenes) {
      try {
        const items = await getSceneItems(scene.sceneName);
        for (const item of items) pairs.push({ sceneName: scene.sceneName, sourceName: item.sourceName });
      } catch (err) {
        console.error(`[${logTag}] failed to list items for scene`, scene.sceneName, (err as any)?.message || err);
      }
    }
    setStatus({ sources: pairs });
    await refreshAllFilters(pairs);
  }

  // Every (source, filter) pair across every known source — for the
  // obs_toggle_filter Pulse Engine action's own picker. Filters belong to
  // the SOURCE, not the scene-item, so this dedupes by sourceName first
  // (the same source dragged into two scenes has one shared filter list,
  // unlike scene-item visibility above which genuinely is per-scene) before
  // issuing one GetSourceFilterList call per unique source.
  async function refreshAllFilters(pairs: { sceneName: string; sourceName: string }[]): Promise<void> {
    if (!obs) return;
    const uniqueSourceNames = [...new Set(pairs.map((p) => p.sourceName))];
    const filters: { sourceName: string; filterName: string; filterEnabled: boolean }[] = [];
    for (const sourceName of uniqueSourceNames) {
      try {
        const list = await getSourceFilters(sourceName);
        for (const f of list) filters.push({ sourceName, filterName: f.filterName, filterEnabled: f.filterEnabled });
      } catch {
        // A source with no filters support (some source types) just throws —
        // contributes nothing for that one source, never fails the whole pass.
      }
    }
    setStatus({ filters });
  }

  async function connect(url: string, password: string): Promise<void> {
    await disconnect();
    // disconnect() above (cleaning up any previous connection) sets
    // explicitlyDisconnected — reset it here, now that we're actually trying
    // to connect again, whether this call came from the user clicking
    // Connect or from scheduleReconnect() retrying in the background.
    lastUrl = url;
    lastPassword = password;
    explicitlyDisconnected = false;
    clearReconnectTimer();
    setStatus({ connecting: true, error: undefined });

    try {
      // tsconfig's moduleResolution ("Node", classic) predates package.json
      // "exports" subpath maps, so tsc can't resolve "./json" even though
      // Node's real runtime resolver (what actually executes this) honors
      // it fine — confirmed by running it. Narrow, targeted suppression of
      // exactly that resolution gap, not the whole import.
      // @ts-ignore
      const { default: OBSWebSocketCtor } = await import('obs-websocket-js/json');
      // Explicit annotation restores real typing for `client` (and so every
      // .on() callback below) — the @ts-ignore above only needed to cover
      // the unresolvable specifier, not the whole construction.
      const client: OBSWebSocketInstance = new (OBSWebSocketCtor as unknown as new () => OBSWebSocketInstance)();
      obs = client;

      client.on('ConnectionClosed', () => {
        setStatus({ connected: false, connecting: false, currentScene: null, scenes: [], sources: [], filters: [], streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0 });
        if (wasConnected && !explicitlyDisconnected) {
          wasConnected = false;
          scheduleReconnect();
        }
      });
      client.on('CurrentProgramSceneChanged', (data) => {
        setStatus({ currentScene: data.sceneName });
      });
      client.on('SceneListChanged', () => {
        refreshSceneList().catch((err) => console.error(`[${logTag}] scene list refresh failed`, err));
      });
      // A source added/removed/reordered anywhere — re-run the full (scene,
      // source) pass. Debounced lightly isn't worth the added complexity
      // here: these fire on a deliberate user action (dragging a new source
      // in, deleting one), not continuously.
      client.on('SceneItemCreated', () => {
        refreshAllSceneItems().catch((err) => console.error(`[${logTag}] source list refresh failed`, err));
      });
      client.on('SceneItemRemoved', () => {
        refreshAllSceneItems().catch((err) => console.error(`[${logTag}] source list refresh failed`, err));
      });
      client.on('SceneItemListReindexed', () => {
        refreshAllSceneItems().catch((err) => console.error(`[${logTag}] source list refresh failed`, err));
      });
      // A filter added/removed/reordered on any source — same "re-run the
      // full pass on a deliberate user action" reasoning as the SceneItem*
      // listeners above.
      client.on('SourceFilterListReindexed', () => {
        refreshAllFilters(status.sources).catch((err) => console.error(`[${logTag}] filter list refresh failed`, err));
      });
      client.on('SourceFilterCreated', () => {
        refreshAllFilters(status.sources).catch((err) => console.error(`[${logTag}] filter list refresh failed`, err));
      });
      client.on('SourceFilterRemoved', () => {
        refreshAllFilters(status.sources).catch((err) => console.error(`[${logTag}] filter list refresh failed`, err));
      });
      client.on('SourceFilterEnableStateChanged', (data) => {
        setStatus({
          filters: status.filters.map((f) =>
            f.sourceName === data.sourceName && f.filterName === data.filterName
              ? { ...f, filterEnabled: Boolean(data.filterEnabled) }
              : f
          ),
        });
      });
      client.on('StreamStateChanged', (data) => {
        setStatus({ streaming: Boolean(data.outputActive) });
      });
      client.on('RecordStateChanged', (data) => {
        setStatus({ recording: Boolean(data.outputActive) });
      });

      await client.connect(url, password || undefined);
      wasConnected = true;
      setStatus({ connected: true, connecting: false, error: undefined, errorCode: undefined });
      await refreshSceneList();
      await refreshOutputStatus();
    } catch (err: any) {
      obs = null;
      setStatus({
        connected: false,
        connecting: false,
        error: err?.message || `Failed to connect to ${logTag}`,
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
      // Non-fatal — scenes/sources still work even if this specific call
      // fails (e.g. a build with a partial obs-websocket implementation).
      console.error(`[${logTag}] output status refresh failed`, err);
    }
  }

  async function disconnect(): Promise<void> {
    explicitlyDisconnected = true;
    wasConnected = false;
    clearReconnectTimer();
    if (obs) {
      try {
        await obs.disconnect();
      } catch {
        // already gone
      }
    }
    obs = null;
    setStatus({ connected: false, connecting: false, currentScene: null, scenes: [], sources: [], filters: [], error: undefined, errorCode: undefined, streaming: false, recording: false, streamDurationMs: 0, recordDurationMs: 0 });
  }

  async function switchScene(sceneName: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('SetCurrentProgramScene', { sceneName });
  }

  async function getSceneItems(sceneName: string): Promise<ObsSceneItemInfo[]> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
    return (sceneItems as any[]).map((i) => ({
      // Real, found bug this used to cause: Number()-coercing this always
      // assumed the real-OBS-spec numeric id. Obzidian's own ids are
      // strings like "src_1" (documented deviation in its own
      // GetSceneItemList handler) — Number("src_1") is NaN, which
      // JSON.stringify()'d to null on the next SetSceneItemEnabled call,
      // and Obzidian's handler correctly rejected that as a missing
      // sceneItemId. Passing the raw value through, whatever type the
      // server actually sent, fixes both targets at once.
      sceneItemId: i.sceneItemId,
      sourceName: String(i.sourceName),
      sceneItemEnabled: Boolean(i.sceneItemEnabled),
    }));
  }

  async function setSceneItemEnabled(sceneName: string, sceneItemId: number | string, enabled: boolean): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    // obs-websocket-js's generated request types declare sceneItemId as
    // strictly number (real-OBS-spec shape) — Obzidian's server genuinely
    // accepts its own string ids on the wire here (it's JSON either way),
    // so this cast only overrides the library's type, not real behavior.
    await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled } as any);
  }

  // obs_toggle_source — resolves the real numeric sceneItemId by
  // (sceneName, sourceName) at fire time rather than requiring one to be
  // tracked/reported up to the website at all (same "matched by name, not a
  // stored id" reasoning switchScene's own sceneName already uses).
  // `visible` undefined means "toggle": flip whatever the source's current
  // state is.
  async function toggleSourceVisible(sceneName: string, sourceName: string, visible?: boolean): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    const items = await getSceneItems(sceneName);
    const item = items.find((i) => i.sourceName === sourceName);
    if (!item) throw new Error(`No source named "${sourceName}" in scene "${sceneName}"`);
    const next = visible === undefined ? !item.sceneItemEnabled : visible;
    await setSceneItemEnabled(sceneName, item.sceneItemId, next);
  }

  async function getSourceFilters(sourceName: string): Promise<{ filterName: string; filterEnabled: boolean }[]> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    const { filters } = await obs.call('GetSourceFilterList', { sourceName });
    return (filters as any[]).map((f) => ({ filterName: String(f.filterName), filterEnabled: Boolean(f.filterEnabled) }));
  }

  // obs_toggle_filter. `enabled` undefined means "toggle": read the
  // filter's own current state (obs-websocket's SetSourceFilterEnabled
  // takes an explicit boolean, there's no bare toggle call) and flip it —
  // same "resolve the real target at fire time" shape toggleSourceVisible
  // above already uses for scene items.
  async function toggleSourceFilterEnabled(sourceName: string, filterName: string, enabled?: boolean): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    let next = enabled;
    if (next === undefined) {
      const { filterEnabled } = await obs.call('GetSourceFilter', { sourceName, filterName });
      next = !filterEnabled;
    }
    await obs.call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: next });
  }

  // Stream/record controls — each call just fires the request; the real
  // resulting state comes back through the StreamStateChanged/
  // RecordStateChanged event handlers above (and from the tool itself, if
  // the streamer starts/stops it manually from its own UI instead), not
  // from the response of these calls — same "server/source of truth pushes
  // state, caller doesn't assume" pattern the scene list already uses.
  async function startStream(): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StartStream');
  }
  async function stopStream(): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StopStream');
  }
  // canvasKey (2026-11-09, direct request: "whether or not we can take
  // just horizontal or just vertical clips... make sure most things can
  // be controlled one way or another") — optional, undefined for real OBS
  // (which has no canvas concept at all) and for an Obzidian caller that
  // doesn't care which canvas. Obzidian's own ObsWebSocketServer defaults
  // to activeCanvasKey_ when this field is absent (see HandleWsRequest's
  // own comment), so omitting it is always safe — only pass it to target
  // a SPECIFIC canvas regardless of which one is currently active there.
  async function startRecord(canvasKey?: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StartRecord', canvasKey ? ({ canvasKey } as any) : undefined);
  }
  async function stopRecord(canvasKey?: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StopRecord', canvasKey ? ({ canvasKey } as any) : undefined);
  }

  // Replay Buffer controls — same fire-the-request shape as start/stop
  // stream/record above. SaveReplayBuffer only actually writes a file if
  // the buffer is already running — either the tool's own "autostart"
  // setting, or startReplayBuffer below; a plain `obs.call` rejection
  // (buffer not active) surfaces as a console error one level up (main.ts's
  // handleWsMessage), same as every other handler here has no way to
  // report a failure back to the rule that fired it.
  async function startReplayBuffer(canvasKey?: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StartReplayBuffer', canvasKey ? ({ canvasKey } as any) : undefined);
  }
  async function stopReplayBuffer(canvasKey?: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('StopReplayBuffer', canvasKey ? ({ canvasKey } as any) : undefined);
  }
  async function saveReplayBuffer(canvasKey?: string): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('SaveReplayBuffer', canvasKey ? ({ canvasKey } as any) : undefined);
  }

  // Aitum Vertical's own Backtrack buffer — see this file's own top-of-file
  // comment and ObsProtocolClient's interface comment for why this only
  // ever means anything against real OBS.
  async function startAitumBacktrack(): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'start_backtrack', requestData: {} });
  }
  async function stopAitumBacktrack(): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'stop_backtrack', requestData: {} });
  }
  async function saveAitumBacktrack(): Promise<void> {
    if (!obs) throw new Error(`Not connected to ${logTag}`);
    await obs.call('CallVendorRequest', { vendorName: 'aitum-vertical-canvas', requestType: 'save_backtrack', requestData: {} });
  }

  return {
    onStatusChange(cb) {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    getStatus() { return status; },
    connect,
    disconnect,
    switchScene,
    getSceneItems,
    setSceneItemEnabled,
    toggleSourceVisible,
    getSourceFilters,
    toggleSourceFilterEnabled,
    startStream,
    stopStream,
    startRecord,
    stopRecord,
    startReplayBuffer,
    stopReplayBuffer,
    saveReplayBuffer,
    startAitumBacktrack,
    stopAitumBacktrack,
    saveAitumBacktrack,
  };
}
