// electron/obs-client.ts — a persistent connection to OBS's own built-in
// WebSocket server (OBS 28+, Tools -> obs-websocket Settings). Browse
// scenes/sources, switch the current scene, show/hide a source, and
// start/stop streaming+recording. Chat-triggered OBS control (a Pulse
// Engine action broadcasting an event this module reacts to — see
// main.ts's handleWsMessage) is real and wired up: obs.switchScene has
// been live since 2026-10-15, obs.startStream/stopStream/startRecord/
// stopRecord the same day right alongside the stream/record controls below.
//
// 2026-11-08 — the real connection logic was factored out into
// obsProtocolClient.ts's createObsProtocolClient() so the exact same
// implementation can also back a second, independent connection to Obzidian
// (kickpulse-streamer-qt, our own OBS/Meld competitor — see
// obzidian-client.ts), which deliberately speaks the same real obs-websocket
// v5 wire protocol. This file is now just a thin, named 'obs' instance —
// every export below keeps its original name/signature, so nothing calling
// into this module (main.ts) needed to change.
import { createObsProtocolClient } from './obsProtocolClient';

const client = createObsProtocolClient('OBS');

export const onObsStatusChange = client.onStatusChange;
export const getObsStatus = client.getStatus;
export const connectObs = client.connect;
export const disconnectObs = client.disconnect;
export const switchScene = client.switchScene;
export const getSceneItems = client.getSceneItems;
export const setSceneItemEnabled = client.setSceneItemEnabled;
export const toggleSourceVisible = client.toggleSourceVisible;
export const getSourceFilters = client.getSourceFilters;
export const toggleSourceFilterEnabled = client.toggleSourceFilterEnabled;
export const startStream = client.startStream;
export const stopStream = client.stopStream;
export const startRecord = client.startRecord;
export const stopRecord = client.stopRecord;
export const startReplayBuffer = client.startReplayBuffer;
export const stopReplayBuffer = client.stopReplayBuffer;
export const saveReplayBuffer = client.saveReplayBuffer;

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
// Throws (same as every other client.* call above) if Aitum Vertical isn't
// installed/loaded in the connected OBS — CallVendorRequest rejects when no
// vendor with that name has registered. OBS-only — Obzidian has no such
// plugin concept, so obzidian-client.ts doesn't export these.
export const startAitumBacktrack = client.startAitumBacktrack;
export const stopAitumBacktrack = client.stopAitumBacktrack;
export const saveAitumBacktrack = client.saveAitumBacktrack;
