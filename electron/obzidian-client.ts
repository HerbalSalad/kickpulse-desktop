// electron/obzidian-client.ts — a persistent connection to Obzidian
// (kickpulse-streamer-qt, our own OBS/Meld competitor) — added just like
// OBS/Meld, 2026-11-08, direct request: "Should be able to switch scenes,
// and everything just like OBS and meld can."
//
// Obzidian's own engine/src/qt_app/ObsWebSocketServer.h deliberately
// implements the real, documented obs-websocket v5 wire protocol (default
// port 4455, same as real OBS) specifically so a tool already built against
// it — this app's existing OBS integration — can drive it with zero new
// protocol work. That's exactly what this file is: a second, independent
// instance of the SAME createObsProtocolClient() implementation obs-client.ts
// uses, just pointed at Obzidian's own connection instead. See
// obsProtocolClient.ts for the real logic — this file only exists so main.ts
// can hold two independent connections (a streamer could theoretically run
// OBS AND Obzidian, even though in practice Obzidian is meant to replace OBS
// outright, same "not every user uses the same tool" reasoning Meld support
// already established) under clearly distinct names.
//
// Deliberately NOT exported here: startAitumBacktrack/stopAitumBacktrack/
// saveAitumBacktrack — Aitum Vertical is a real OBS plugin with no Obzidian
// equivalent at all, so those three obs-client.ts exports have nothing to
// mean against this connection.
import { createObsProtocolClient } from './obsProtocolClient';

const client = createObsProtocolClient('Obzidian');

export const onObzidianStatusChange = client.onStatusChange;
export const getObzidianStatus = client.getStatus;
export const connectObzidian = client.connect;
export const disconnectObzidian = client.disconnect;
export const obzidianSwitchScene = client.switchScene;
export const obzidianGetSceneItems = client.getSceneItems;
export const obzidianSetSceneItemEnabled = client.setSceneItemEnabled;
export const obzidianToggleSourceVisible = client.toggleSourceVisible;
export const obzidianGetSourceFilters = client.getSourceFilters;
export const obzidianToggleSourceFilterEnabled = client.toggleSourceFilterEnabled;
export const obzidianStartStream = client.startStream;
export const obzidianStopStream = client.stopStream;
export const obzidianStartRecord = client.startRecord;
export const obzidianStopRecord = client.stopRecord;
export const obzidianStartReplayBuffer = client.startReplayBuffer;
export const obzidianStopReplayBuffer = client.stopReplayBuffer;
export const obzidianSaveReplayBuffer = client.saveReplayBuffer;
