// electron/preload.ts — shared by every window this app creates (the
// overlay, and the main app shell). Both are first-party pages loaded from
// this app's own bundle, never arbitrary remote content, so exposing a
// slightly wider surface to each than it strictly needs isn't a real
// security concern the way it would be for a window showing untrusted web
// content. Most widget config reads/writes go straight to Supabase from the
// renderer (src/lib/supabase.ts), the same anon-key mechanism the website's
// own settings pages already use — but Overlay Studio, Alert Studio, and
// Pulse Engine (2026-10-16) now embed the real website's own editor in a
// <webview> instead of maintaining a second, independently-drifting native
// re-implementation of each (see each page's own file header for why) — the
// stale claim this comment used to make, that the app "no longer embeds the
// real website at all," is what it's correcting.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  JumpscarePayload,
  DesktopConfig,
  DesktopStatus,
  LocalMediaItem,
  MediaServerInfo,
  ObsStatus,
  ObsSceneItemInfo,
  MeldStatus,
  ScenePlayPayload,
  LightDeviceConfig,
  LightState,
  HueBridgeConfig,
  LightScene,
  LightReaction,
  ViewerInfo,
  UpdaterStatus,
} from './types';
import type { ChatFeedMessage, EventFeedItem } from './chat-feed';
import type { YoutubeStatus, TiktokStatus, BotStatus, DiscordSettings } from './api';
import type { DisplayOption } from './overlay-window';
import type { DiscoveredBridge, HueLightInfo, PairResult } from './lights/hue';
import type { WledDiscoveryResult } from './lights/wled';
import type { GoveeDiscoveryOutcome } from './lights/govee';

contextBridge.exposeInMainWorld('kickpulseOverlay', {
  onPlayJumpscare: (cb: (payload: JumpscarePayload) => void) => {
    ipcRenderer.on('play-jumpscare', (_e, payload: JumpscarePayload) => cb(payload));
  },
  onPlayScene: (cb: (payload: ScenePlayPayload) => void) => {
    ipcRenderer.on('play-scene', (_e, payload: ScenePlayPayload) => cb(payload));
  },
  onHighlight: (cb: (payload: { ms: number }) => void) => {
    ipcRenderer.on('overlay-highlight', (_e, payload: { ms: number }) => cb(payload));
  },
  onPresetSound: (cb: (payload: { url: string; volume: number }) => void) => {
    ipcRenderer.on('play-preset-sound', (_e, payload: { url: string; volume: number }) => cb(payload));
  },
});

// Voice Commands (2026-10-23) — only the hidden listener window
// (electron/voice-window.ts, src/VoiceApp.tsx) actually uses this; exposed
// unconditionally like kickpulseOverlay above since every window shares
// this one preload script. The window now does ONLY mic capture — all
// recognition (Vosk, confidence, partial results) runs in the main process
// (electron/voiceCommands.ts), so this bridge only ever needs to carry raw
// audio frames up, nothing model-related down.
contextBridge.exposeInMainWorld('kickpulseVoice', {
  onSetInputDevice: (cb: (deviceId: string | null) => void) => {
    ipcRenderer.on('voice:set-input-device', (_e, deviceId: string | null) => cb(deviceId));
  },
  sendAudioFrame: (frame: ArrayBuffer) => ipcRenderer.send('voice:audio-frame', frame),
});

contextBridge.exposeInMainWorld('kickpulseDesktop', {
  // Account / config
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke('config:get'),
  getStatus: (): Promise<DesktopStatus> => ipcRenderer.invoke('status:get'),
  saveApiKey: (apiKey: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('config:save-api-key', apiKey),
  // "Login with Kick/Twitch" (2026-10-20) — an alternative to pasting an
  // API key: opens a real login window, and on success connects this app
  // exactly as if that key had been entered. See electron/oauth-login.ts.
  loginWithKick: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login-kick'),
  loginWithTwitch: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login-twitch'),
  disconnect: (): Promise<void> => ipcRenderer.invoke('config:disconnect'),

  // Custom title bar (2026-10-20) — main window is frame: false now, so
  // TitleBar.tsx drives minimize/maximize/close itself over IPC.
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: (): Promise<void> => ipcRenderer.invoke('window:maximize-toggle'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized-change', (_e, maximized: boolean) => cb(maximized));
  },
  onStatus: (cb: (status: DesktopStatus) => void) => {
    ipcRenderer.on('status-update', (_e, status: DesktopStatus) => cb(status));
  },

  testJumpscare: (): Promise<void> => ipcRenderer.invoke('test-jumpscare'),
  testScene: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('scenes:test'),

  // Overlay display (2026-10-18) — which physical monitor the always-on
  // overlay window is on, with a real confirmation/test mechanism.
  overlayListDisplays: (): Promise<DisplayOption[]> => ipcRenderer.invoke('overlay:list-displays'),
  overlayGetCurrent: (): Promise<{ configuredId: number | null; current: DisplayOption | null }> =>
    ipcRenderer.invoke('overlay:get-current'),
  overlaySetDisplay: (id: number | null): Promise<DisplayOption> => ipcRenderer.invoke('overlay:set-display', id),
  overlayTestHighlight: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('overlay:test-highlight'),

  // General-purpose local media library
  addMediaFile: (): Promise<LocalMediaItem | null> => ipcRenderer.invoke('media:add'),
  listMediaFiles: (): Promise<LocalMediaItem[]> => ipcRenderer.invoke('media:list'),
  removeMediaFile: (id: string): Promise<void> => ipcRenderer.invoke('media:remove', id),
  getMediaServerInfo: (): Promise<MediaServerInfo> => ipcRenderer.invoke('media:get-server-info'),

  // OBS control
  obsGetStatus: (): Promise<ObsStatus> => ipcRenderer.invoke('obs:get-status'),
  obsConnect: (url: string, password: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('obs:connect', url, password),
  obsDisconnect: (): Promise<void> => ipcRenderer.invoke('obs:disconnect'),
  obsSwitchScene: (sceneName: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('obs:switch-scene', sceneName),
  obsGetSceneItems: (sceneName: string): Promise<ObsSceneItemInfo[]> =>
    ipcRenderer.invoke('obs:get-scene-items', sceneName),
  obsToggleSource: (sceneName: string, sceneItemId: number, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('obs:toggle-source', sceneName, sceneItemId, enabled),
  obsStartStream: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('obs:start-stream'),
  obsStopStream: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('obs:stop-stream'),
  obsStartRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('obs:start-record'),
  obsStopRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('obs:stop-record'),
  onObsStatus: (cb: (status: ObsStatus) => void) => {
    ipcRenderer.on('obs-status-update', (_e, status: ObsStatus) => cb(status));
  },

  // Meld Studio control (2026-10-25) — same shape as the OBS bridge above.
  meldGetStatus: (): Promise<MeldStatus> => ipcRenderer.invoke('meld:get-status'),
  meldConnect: (url: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('meld:connect', url),
  meldDisconnect: (): Promise<void> => ipcRenderer.invoke('meld:disconnect'),
  meldSwitchScene: (sceneId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('meld:switch-scene', sceneId),
  meldToggleLayer: (sceneId: string, layerId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('meld:toggle-layer', sceneId, layerId),
  meldSetLayerVisible: (layerId: string, visible: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('meld:set-layer-visible', layerId, visible),
  meldStartStream: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('meld:start-stream'),
  meldStopStream: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('meld:stop-stream'),
  meldStartRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('meld:start-record'),
  meldStopRecord: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('meld:stop-record'),
  onMeldStatus: (cb: (status: MeldStatus) => void) => {
    ipcRenderer.on('meld-status-update', (_e, status: MeldStatus) => cb(status));
  },

  // Lights — WLED (local HTTP, no auth) + Philips Hue (local bridge,
  // physical-button pairing). See electron/lights-manager.ts.
  lightsListDevices: (): Promise<LightDeviceConfig[]> => ipcRenderer.invoke('lights:list-devices'),
  lightsListLiveStates: (): Promise<LightState[]> => ipcRenderer.invoke('lights:list-live-states'),
  lightsAddWled: (ip: string, name?: string): Promise<{ ok: boolean; error?: string; device?: LightDeviceConfig }> =>
    ipcRenderer.invoke('lights:add-wled', ip, name),
  // 2026-10-16 — real local-network discovery, not just manual IP entry.
  lightsDiscoverWled: (): Promise<WledDiscoveryResult[]> => ipcRenderer.invoke('lights:discover-wled'),
  onLightsDiscoverWledProgress: (cb: (p: { scanned: number; total: number }) => void) => {
    ipcRenderer.on('lights:discover-wled-progress', (_e, p) => cb(p));
  },
  lightsDiscoverGovee: (): Promise<GoveeDiscoveryOutcome> => ipcRenderer.invoke('lights:discover-govee'),
  lightsAddGovee: (ip: string, name?: string, sku?: string): Promise<{ ok: boolean; error?: string; device?: LightDeviceConfig }> =>
    ipcRenderer.invoke('lights:add-govee', ip, name, sku),
  lightsDiscoverHueBridges: (): Promise<DiscoveredBridge[]> => ipcRenderer.invoke('lights:discover-hue-bridges'),
  lightsPairHueBridge: (ip: string): Promise<PairResult> => ipcRenderer.invoke('lights:pair-hue-bridge', ip),
  lightsListPairedHueBridges: (): Promise<HueBridgeConfig[]> => ipcRenderer.invoke('lights:list-paired-hue-bridges'),
  lightsListHueBridgeLights: (bridgeIp: string): Promise<{ ok: boolean; error?: string; lights: HueLightInfo[] }> =>
    ipcRenderer.invoke('lights:list-hue-bridge-lights', bridgeIp),
  lightsAddHueLight: (bridgeIp: string, hueLightId: string, name: string): Promise<{ ok: boolean; error?: string; device?: LightDeviceConfig }> =>
    ipcRenderer.invoke('lights:add-hue-light', bridgeIp, hueLightId, name),
  lightsRemoveDevice: (id: string): Promise<void> => ipcRenderer.invoke('lights:remove-device', id),
  lightsRenameDevice: (id: string, name: string): Promise<void> => ipcRenderer.invoke('lights:rename-device', id, name),
  lightsSetState: (target: string, patch: { on?: boolean; brightness?: number; color?: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('lights:set-state', target, patch),

  // Light Scenes (2026-10-18) — see electron/light-scenes.ts.
  lightsListScenes: (): Promise<LightScene[]> => ipcRenderer.invoke('lights:list-scenes'),
  lightsGetActiveSceneId: (): Promise<string | null> => ipcRenderer.invoke('lights:get-active-scene-id'),
  lightsSaveScene: (scene: Partial<LightScene> & { name: string; targets: LightScene['targets'] }): Promise<LightScene> =>
    ipcRenderer.invoke('lights:save-scene', scene),
  lightsDeleteScene: (id: string): Promise<void> => ipcRenderer.invoke('lights:delete-scene', id),
  lightsSetActiveScene: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('lights:set-active-scene', id),

  // Light Reactions (2026-10-18) — see electron/light-reactions.ts.
  lightsListReactions: (): Promise<LightReaction[]> => ipcRenderer.invoke('lights:list-reactions'),
  lightsSaveReaction: (reaction: Partial<LightReaction> & { name: string; playMode: LightReaction['playMode']; steps: LightReaction['steps'] }): Promise<LightReaction> =>
    ipcRenderer.invoke('lights:save-reaction', reaction),
  lightsDeleteReaction: (id: string): Promise<void> => ipcRenderer.invoke('lights:delete-reaction', id),
  lightsFireReaction: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('lights:fire-reaction', id),
  lightsStopReaction: (id: string): Promise<void> => ipcRenderer.invoke('lights:stop-reaction', id),
  lightsListRunningReactions: (): Promise<string[]> => ipcRenderer.invoke('lights:list-running-reactions'),

  // Voice Commands settings page (2026-10-23) — see electron/voiceCommands.ts
  // + electron/voice-window.ts. Device enumeration itself happens in THIS
  // window's own renderer (navigator.mediaDevices.enumerateDevices(), a
  // plain browser API, no IPC needed for that part) — only on/off state,
  // which device id was picked, model status, and the debug "heard" log
  // actually cross into the main process.
  voice: {
    getSettings: (): Promise<{
      enabled: boolean; inputDeviceId: string | null; modelSize: 'small' | 'medium' | 'large' | 'xlarge';
      strictVocabulary: boolean; recognitionWords: string[]; liveCaptionsEnabled: boolean;
    }> => ipcRenderer.invoke('voice:get-settings'),
    setEnabled: (enabled: boolean): Promise<{ ok: boolean; needsModelDownload?: boolean }> => ipcRenderer.invoke('voice:set-enabled', enabled),
    setInputDevice: (deviceId: string | null): Promise<{ ok: boolean }> => ipcRenderer.invoke('voice:set-input-device', deviceId),
    setModelSize: (size: 'small' | 'medium' | 'large' | 'xlarge'): Promise<{ ok: boolean }> => ipcRenderer.invoke('voice:set-model-size', size),
    setStrictVocabulary: (strict: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('voice:set-strict-vocabulary', strict),
    setRecognitionWords: (words: string[]): Promise<{ ok: boolean }> => ipcRenderer.invoke('voice:set-recognition-words', words),
    setLiveCaptionsEnabled: (enabled: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('voice:set-live-captions-enabled', enabled),
    isModelReady: (size: 'small' | 'medium' | 'large' | 'xlarge'): Promise<boolean> => ipcRenderer.invoke('voice:is-model-ready', size),
    downloadModel: (size: 'small' | 'medium' | 'large' | 'xlarge'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('voice:download-model', size),
    onDownloadProgress: (cb: (pct: number) => void) => {
      ipcRenderer.removeAllListeners('voice:download-progress');
      ipcRenderer.on('voice:download-progress', (_e, pct: number) => cb(pct));
    },
    getHeardLog: (): Promise<{ text: string; confidence: number; matchedPhrase: string | null; at: number }[]> =>
      ipcRenderer.invoke('voice:get-heard-log'),
    getLivePartial: (): Promise<string> => ipcRenderer.invoke('voice:get-live-partial'),
    getPhrases: (): Promise<{ id: string; phrase: string; matchMode: 'contains' | 'exact'; minConfidence: number; triggerImmediately: boolean }[]> =>
      ipcRenderer.invoke('voice:get-phrases'),
  },

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  // Webview guest preload (2026-10-18) — see electron/webview-preload.ts.
  getWebviewPreloadUrl: (): Promise<string> => ipcRenderer.invoke('get-webview-preload-url'),
  browseLocalFileForWebview: (): Promise<string | null> => ipcRenderer.invoke('browse-local-file-for-webview'),

  // Pulse Engine — see electron/api.ts's own comment on why this is a real
  // network round-trip (through the main process, which holds the apiKey)
  // rather than a direct Supabase call like every widget config uses.
  pulseRules: {
    list: (): Promise<any[]> => ipcRenderer.invoke('pulse:list'),
    create: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('pulse:create', body),
    update: (id: string, body: Record<string, any>): Promise<any> => ipcRenderer.invoke('pulse:update', id, body),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('pulse:delete', id),

    listJobs: (): Promise<any[]> => ipcRenderer.invoke('pulse:jobs-list'),
    skipJob: (id: string): Promise<void> => ipcRenderer.invoke('pulse:jobs-skip', id),
    cancelJob: (id: string): Promise<void> => ipcRenderer.invoke('pulse:jobs-cancel', id),

    kickRewards: (): Promise<{ data?: any[]; error?: string }> => ipcRenderer.invoke('pulse:kick-rewards'),
    twitchRewards: (): Promise<{ data?: any[]; error?: string }> => ipcRenderer.invoke('pulse:twitch-rewards'),
    pointsRewards: (): Promise<{ data?: any[]; error?: string }> => ipcRenderer.invoke('pulse:points-rewards'),
    counters: (): Promise<string[]> => ipcRenderer.invoke('pulse:counters'),
    ttsVoices: (): Promise<any[]> => ipcRenderer.invoke('pulse:tts-voices'),
    searchCategories: (platform: 'kick' | 'twitch', query: string): Promise<{ id: string | number; name: string }[]> =>
      ipcRenderer.invoke('pulse:search-categories', platform, query),
    runAction: (action: Record<string, unknown>): Promise<{ ok: boolean }> => ipcRenderer.invoke('pulse:run-action', action),
  },

  // Chat Bot (2026-10-18, native rebuild) — same real-network-round-trip
  // reasoning as pulseRules above: every route here already enforces the
  // website's own validation/limits/cooldowns, so this calls those routes
  // directly rather than reimplementing any of that logic a second time.
  chatBot: {
    listCommands: (): Promise<any[]> => ipcRenderer.invoke('chatbot:commands-list'),
    createCommand: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('chatbot:commands-create', body),
    updateCommand: (id: string, body: Record<string, any>): Promise<any> => ipcRenderer.invoke('chatbot:commands-update', id, body),
    deleteCommand: (id: string): Promise<void> => ipcRenderer.invoke('chatbot:commands-delete', id),
    testSendCommand: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('chatbot:commands-test-send', body),

    listCounters: (): Promise<any[]> => ipcRenderer.invoke('chatbot:counters-list'),
    createCounter: (name: string, value?: number): Promise<any> => ipcRenderer.invoke('chatbot:counters-create', name, value),
    adjustCounter: (name: string, patch: { value?: number; delta?: number }): Promise<any> => ipcRenderer.invoke('chatbot:counters-adjust', name, patch),
    deleteCounter: (name: string): Promise<void> => ipcRenderer.invoke('chatbot:counters-delete', name),

    getSpamFilter: (): Promise<any> => ipcRenderer.invoke('chatbot:spam-filter-get'),
    saveSpamFilter: (enabled: boolean, config: Record<string, any>): Promise<any> => ipcRenderer.invoke('chatbot:spam-filter-save', enabled, config),
    getSettings: (): Promise<any> => ipcRenderer.invoke('chatbot:settings-get'),
    saveSettings: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('chatbot:settings-save', body),
  },

  // Chat Alerts (2026-10-18, native rebuild) — the config itself is a
  // direct anon-open Supabase table (chat_alert_configs), read/written from
  // the renderer the same way Scenes/Alert Studio already do; only the two
  // "Send Test" buttons need a real server round-trip.
  chatAlerts: {
    testSend: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('chat-alerts:test-send', body),
    testSendLevelUp: (): Promise<any> => ipcRenderer.invoke('chat-alerts:test-send-level-up'),
  },

  // Moderation (2026-10-18, native rebuild).
  moderation: {
    pending: (): Promise<any> => ipcRenderer.invoke('moderation:pending'),
    resolveSongRequest: (id: string, status: 'approved' | 'denied' | 'played'): Promise<any> => ipcRenderer.invoke('moderation:resolve-song-request', id, status),
    resolveRedemption: (id: string, status: 'fulfilled' | 'rejected'): Promise<any> => ipcRenderer.invoke('moderation:resolve-redemption', id, status),
    approveDonation: (id: string): Promise<any> => ipcRenderer.invoke('moderation:approve-donation', id),
    dismissDonation: (id: string): Promise<any> => ipcRenderer.invoke('moderation:dismiss-donation', id),
    action: (kind: 'timeout' | 'ban' | 'unban', body: Record<string, any>): Promise<any> => ipcRenderer.invoke('moderation:action', kind, body),
    // Twitch-only — Kick has no chat-mode API (see routes/moderation.js on the server).
    getChatSettings: (): Promise<any> => ipcRenderer.invoke('moderation:get-chat-settings'),
    setChatMode: (body: Record<string, any>): Promise<any> => ipcRenderer.invoke('moderation:set-chat-mode', body),
  },

  // Live Chat & Event Feed + Community Bans/Viewer Flags warnings (2026-10-19).
  //
  // onMessage/onEvent each replace any previously-registered listener rather
  // than stacking a new one on top (2026-10-20 fix — direct report: "chat on
  // the dashboard... is also doubling up messages"). DashboardPage.tsx calls
  // these again every time it mounts, and switching tabs in this app's
  // single-page shell (App.tsx conditionally renders pages, so navigating
  // away and back is a real unmount/remount) unmounts and remounts it
  // repeatedly — ipcRenderer.on has no cleanup paired with it, so each
  // remount was piling up ANOTHER listener instead of replacing the last
  // one, and every incoming message/event then fired once per stacked
  // listener. Only one Dashboard can genuinely be mounted at a time, so
  // "the newest registration wins" is the correct behavior here, not a
  // per-caller unsubscribe handle.
  chatFeed: (() => {
    let messageListener: ((e: unknown, msg: ChatFeedMessage) => void) | null = null;
    let eventListener: ((e: unknown, evt: EventFeedItem) => void) | null = null;
    return {
      getRecent: (): Promise<{ chat: ChatFeedMessage[]; events: EventFeedItem[] }> => ipcRenderer.invoke('chat-feed:get-recent'),
      onMessage: (cb: (msg: ChatFeedMessage) => void) => {
        if (messageListener) ipcRenderer.removeListener('chat-feed:message', messageListener as any);
        messageListener = (_e, msg: ChatFeedMessage) => cb(msg);
        ipcRenderer.on('chat-feed:message', messageListener as any);
      },
      onEvent: (cb: (evt: EventFeedItem) => void) => {
        if (eventListener) ipcRenderer.removeListener('chat-feed:event', eventListener as any);
        eventListener = (_e, evt: EventFeedItem) => cb(evt);
        ipcRenderer.on('chat-feed:event', eventListener as any);
      },
      getViewerInfo: (usernames: string[], platform: 'kick' | 'twitch'): Promise<Record<string, ViewerInfo>> =>
        ipcRenderer.invoke('chat-feed:get-viewer-info', usernames, platform),
      getThreatSettings: (): Promise<{ minThreatLevelToWarn: number }> => ipcRenderer.invoke('chat-feed:get-threat-settings'),
      getKickSubscriberBadges: (slug: string): Promise<{ badges: { months: number; badge_image?: { src?: string } }[] }> =>
        ipcRenderer.invoke('chat-feed:get-kick-subscriber-badges', slug),
    };
  })(),

  // Community Bans (2026-10-20, native desktop page).
  communityBans: {
    list: (): Promise<any> => ipcRenderer.invoke('community-bans:list'),
    apply: (opts: { entryIds?: string[] } = {}): Promise<any> => ipcRenderer.invoke('community-bans:apply', opts),
    unban: (entryId: string): Promise<any> => ipcRenderer.invoke('community-bans:unban', entryId),
    unbanAll: (): Promise<any> => ipcRenderer.invoke('community-bans:unban-all'),
    getSettings: (): Promise<{ minThreatLevelToWarn: number }> => ipcRenderer.invoke('community-bans:get-settings'),
    setSettings: (level: number): Promise<any> => ipcRenderer.invoke('community-bans:set-settings', level),
    getFlags: (): Promise<any> => ipcRenderer.invoke('community-bans:get-flags'),
    addFlag: (body: { username: string; category: string; reason?: string }): Promise<any> => ipcRenderer.invoke('community-bans:add-flag', body),
    removeFlag: (id: string): Promise<any> => ipcRenderer.invoke('community-bans:remove-flag', id),
    getSquads: (): Promise<any> => ipcRenderer.invoke('community-bans:get-squads'),
    createSquad: (name: string): Promise<any> => ipcRenderer.invoke('community-bans:create-squad', name),
    joinSquad: (code: string): Promise<any> => ipcRenderer.invoke('community-bans:join-squad', code),
    leaveSquad: (squadId: string): Promise<any> => ipcRenderer.invoke('community-bans:leave-squad', squadId),
  },

  // Connections (2026-10-22, native rebuild — direct feedback: "I want the
  // settings and connections page on the desktop app to be actually on the
  // app. Not loading the site.") — see electron/main.ts's own matching
  // comment for the full reasoning.
  connections: {
    linkKick: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('connections:link-kick'),
    linkTwitch: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('connections:link-twitch'),
    disconnectTwitch: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('connections:disconnect-twitch'),

    getYoutubeStatus: (): Promise<YoutubeStatus> => ipcRenderer.invoke('connections:youtube-status'),
    connectYoutube: (handle: string): Promise<any> => ipcRenderer.invoke('connections:youtube-connect', handle),
    connectYoutubeSecondary: (handle: string): Promise<any> => ipcRenderer.invoke('connections:youtube-connect-secondary', handle),
    disconnectYoutube: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('connections:youtube-disconnect'),
    disconnectYoutubeSecondary: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('connections:youtube-disconnect-secondary'),

    getTiktokStatus: (): Promise<TiktokStatus> => ipcRenderer.invoke('connections:tiktok-status'),
    connectTiktok: (username: string): Promise<any> => ipcRenderer.invoke('connections:tiktok-connect', username),
    disconnectTiktok: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('connections:tiktok-disconnect'),

    getBotStatus: (): Promise<BotStatus> => ipcRenderer.invoke('connections:bot-status'),
    connectBot: (platform: 'kick' | 'twitch'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('connections:bot-connect', platform),
    disconnectBot: (platform: 'kick' | 'twitch'): Promise<{ ok: boolean }> => ipcRenderer.invoke('connections:bot-disconnect', platform),
    setBotPreference: (platform: 'kick' | 'twitch', useOfficialBot: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('connections:bot-set-preference', platform, useOfficialBot),

    getSubscriptionStatus: (): Promise<{ kick: boolean; twitch: boolean }> => ipcRenderer.invoke('connections:subscription-status'),
    subscribeEvents: (platform: 'kick' | 'twitch'): Promise<{ success: boolean }> => ipcRenderer.invoke('connections:subscribe-events', platform),
  },

  // Settings (2026-10-22, native rebuild) — Discord live notification and
  // account deletion. API key management is deliberately left as a website
  // link — see electron/api.ts's own comment on why.
  settings: {
    getDiscordSettings: (): Promise<DiscordSettings> => ipcRenderer.invoke('settings:discord-get'),
    saveDiscordSettings: (body: DiscordSettings): Promise<any> => ipcRenderer.invoke('settings:discord-save', body),
    testDiscordWebhook: (webhookUrl: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('settings:discord-test', webhookUrl),
    deleteAccount: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('settings:delete-account'),
  },

  // Auto-update (2026-10-26) — see electron/updater.ts.
  updater: {
    getStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:get-status'),
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (status: UpdaterStatus) => void) => {
      ipcRenderer.removeAllListeners('updater:status-update');
      ipcRenderer.on('updater:status-update', (_e, status: UpdaterStatus) => cb(status));
    },
  },
});
