export {};

// Electron's <webview> tag (2026-10-16, Alert Studio/Overlay Studio's
// embedded-editor pivot) — a real HTML element once webviewTag:true is set
// on the BrowserWindow's webPreferences (see electron/main.ts), but React's
// own JSX types don't know about it without Electron's ambient types pulled
// into the renderer's own tsconfig, which this app deliberately doesn't do
// (the renderer is typed as plain sandboxed web content). A small, scoped
// declaration here is simpler and safer than widening the renderer's type
// roots just for one element. Keep this list of attributes to only what
// this app actually sets — `src`/`style`/`partition`.
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      partition?: string;
      allowpopups?: string;
      preload?: string;
    };
  }
}

declare global {
  interface JumpscarePayload {
    mediaUrl: string;
    audioUrl?: string;
    duration: number;
    volume: number;
    placeholder?: boolean;
  }

  interface SceneSummary {
    id: string;
    name: string;
    [key: string]: unknown;
  }

  interface ScenePlayPayload {
    scene: SceneSummary;
    tokens: {
      username?: string;
      amount?: number | string;
      message?: string;
      viewers?: number | string;
      reward?: string;
    };
  }

  interface DisplayOption {
    id: number;
    label: string;
    width: number;
    height: number;
    isPrimary: boolean;
  }

  interface LocalMediaItem {
    id: string;
    filePath: string;
    fileName: string;
    addedAt: number;
  }

  interface DesktopConfig {
    apiKey: string | null;
    localMediaLibrary: LocalMediaItem[];
    obsUrl: string;
    obsPassword: string;
    meldUrl: string;
    overlayDisplayId: number | null;
    hueBridges: HueBridgeConfig[];
    lightDevices: LightDeviceConfig[];
    lightScenes: LightScene[];
    activeLightSceneId: string | null;
    lightReactions: LightReaction[];
    voiceEnabled: boolean;
    voiceInputDeviceId: string | null;
    voiceModelSize: VoiceModelSize;
    voiceStrictVocabulary: boolean;
    voiceRecognitionWords: string[];
    voiceLiveCaptionsEnabled: boolean;
  }

  type VoiceModelSize = 'small' | 'medium' | 'large' | 'xlarge';
  interface VoicePhraseInfo {
    id: string;
    phrase: string;
    matchMode: 'contains' | 'exact';
    minConfidence: number;
    triggerImmediately: boolean;
  }

  type LightProvider = 'wled' | 'hue' | 'govee';

  interface HueBridgeConfig {
    bridgeIp: string;
    username: string;
  }

  interface LightDeviceConfig {
    id: string;
    provider: LightProvider;
    name: string;
    ip?: string;
    bridgeIp?: string;
    hueLightId?: string;
  }

  interface LightState {
    id: string;
    provider: LightProvider;
    name: string;
    reachable: boolean;
    on: boolean;
    brightness: number;
    color: string;
  }

  // Light Scenes & Reactions (2026-10-18) — see electron/types.ts's own
  // LightScene/LightReaction comment for the Scene-vs-Reaction split
  // (steady-state baseline vs a temporary, timed, event-triggered effect
  // that hands control back to whichever Scene is active when it ends).
  interface LightPresetStepTarget {
    on?: boolean;
    brightness?: number;
    color?: string;
    random?: boolean;
    transitionMs?: number;
  }
  interface LightScene {
    id: string;
    name: string;
    targets: Record<string, LightPresetStepTarget>;
  }
  interface LightReactionStep {
    durationMs: number;
    targets: Record<string, LightPresetStepTarget>;
  }
  type LightReactionPlayMode = 'once' | 'loop' | 'timed';
  interface LightReaction {
    id: string;
    name: string;
    playMode: LightReactionPlayMode;
    durationSeconds?: number;
    steps: LightReactionStep[];
    soundUrl?: string;
    soundVolume?: number;
  }

  interface DiscoveredBridge {
    id: string;
    ip: string;
  }

  interface HueLightInfo {
    id: string;
    name: string;
    on: boolean;
    brightness: number;
    color: string;
    reachable: boolean;
  }

  type PairResult = { ok: true; username: string } | { ok: false; needsButtonPress: boolean; error: string };

  interface WledDiscoveryResult {
    ip: string;
    name: string;
  }

  interface GoveeDiscoveryResult {
    ip: string;
    deviceId?: string;
    sku?: string;
  }

  interface GoveeDiscoveryOutcome {
    ok: boolean;
    devices: GoveeDiscoveryResult[];
    error?: string;
  }

  interface MeResponse {
    userId: string;
    kickBroadcasterId: string | null;
    username: string | null;
    twitchUsername: string | null;
    displayName: string | null;
    profilePicture: string | null;
    kickConnected: boolean;
    twitchConnected: boolean;
    isPremium: boolean;
    isUltimate: boolean;
  }

  // Live Chat & Event Feed + Community Bans/Viewer Flags warnings (2026-10-19).
  // platform widened to the real 4-platform union (2026-10-27 fix — this had
  // drifted from electron/chat-feed.ts's own FeedPlatform type, which already
  // included youtube/tiktok via main.ts's real pushChatMessage calls for
  // both; this ambient type just hadn't caught up).
  type FeedPlatform = 'kick' | 'twitch' | 'youtube' | 'tiktok';
  interface ChatFeedMessage {
    id: string;
    platform: FeedPlatform;
    username: string;
    content: string;
    color: string | null;
    badges: { type: string; count?: number }[];
    createdAt: string;
    emotesTag?: string | null;
  }
  interface EventFeedItem {
    id: string;
    platform: FeedPlatform;
    eventType: string;
    summary: string;
    createdAt: string;
  }
  interface ViewerFlagInfo { category: string; reason: string | null; }
  interface ViewerThreatInfo { level: number; label: string; count: number; }
  interface ViewerInfo { threat: ViewerThreatInfo; flags: ViewerFlagInfo[]; }

  interface DesktopStatus {
    connected: boolean;
    me: MeResponse | null;
    error?: string;
  }

  type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';

  interface UpdaterStatus {
    phase: UpdaterPhase;
    version?: string;
    percent?: number;
    error?: string;
  }

  interface MediaServerInfo {
    port: number;
    baseUrl: string;
  }

  interface ObsSceneInfo {
    sceneName: string;
    sceneUuid: string;
  }

  interface ObsSceneItemInfo {
    sceneItemId: number;
    sourceName: string;
    sceneItemEnabled: boolean;
  }

  interface ObsStatus {
    connected: boolean;
    connecting: boolean;
    currentScene: string | null;
    scenes: ObsSceneInfo[];
    error?: string;
    errorCode?: number;
    streaming: boolean;
    recording: boolean;
    streamDurationMs: number;
    recordDurationMs: number;
    sources: { sceneName: string; sourceName: string }[];
    // 2026-10-30 — obs_toggle_filter's own picker data, see electron/types.ts's
    // matching field for the full reasoning (this file duplicates that
    // interface rather than importing it — keep both in sync).
    filters: { sourceName: string; filterName: string; filterEnabled: boolean }[];
  }

  interface IpcResult {
    ok: boolean;
    error?: string;
    code?: number;
  }

  // Meld Studio (2026-10-25) — see electron/meld-client.ts's own header for
  // the full WebChannel API writeup.
  interface MeldSceneInfo {
    sceneId: string;
    sceneName: string;
  }

  interface MeldLayerInfo {
    sceneId: string;
    layerId: string;
    layerName: string;
    visible: boolean;
  }

  // 2026-10-30 — meld_toggle_filter's own picker data, see electron/types.ts's
  // MeldEffectInfo for the full reasoning (confirmed against Meld's own
  // WebChannelAPI.md).
  interface MeldEffectInfo {
    sceneId: string;
    layerId: string;
    effectId: string;
    effectName: string;
    enabled: boolean;
  }

  interface MeldStatus {
    connected: boolean;
    connecting: boolean;
    currentSceneId: string | null;
    scenes: MeldSceneInfo[];
    layers: MeldLayerInfo[];
    effects: MeldEffectInfo[];
    streaming: boolean;
    recording: boolean;
    error?: string;
  }

  interface Window {
    kickpulseOverlay: {
      onPlayJumpscare: (cb: (payload: JumpscarePayload) => void) => void;
      onPlayScene: (cb: (payload: ScenePlayPayload) => void) => void;
      onHighlight: (cb: (payload: { ms: number }) => void) => void;
      onPresetSound: (cb: (payload: { url: string; volume: number }) => void) => void;
    };
    kickpulseDesktop: {
      getConfig: () => Promise<DesktopConfig>;
      getStatus: () => Promise<DesktopStatus>;
      saveApiKey: (apiKey: string) => Promise<IpcResult>;
      loginWithKick: () => Promise<IpcResult>;
      loginWithTwitch: () => Promise<IpcResult>;
      disconnect: () => Promise<void>;
      onStatus: (cb: (status: DesktopStatus) => void) => void;

      windowMinimize: () => Promise<void>;
      windowMaximizeToggle: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      onWindowMaximizedChange: (cb: (maximized: boolean) => void) => void;
      getAppVersion: () => Promise<string>;

      testJumpscare: () => Promise<void>;
      testScene: () => Promise<IpcResult>;

      overlayListDisplays: () => Promise<DisplayOption[]>;
      overlayGetCurrent: () => Promise<{ configuredId: number | null; current: DisplayOption | null }>;
      overlaySetDisplay: (id: number | null) => Promise<DisplayOption>;
      overlayTestHighlight: () => Promise<IpcResult>;

      addMediaFile: () => Promise<LocalMediaItem | null>;
      listMediaFiles: () => Promise<LocalMediaItem[]>;
      removeMediaFile: (id: string) => Promise<void>;
      getMediaServerInfo: () => Promise<MediaServerInfo>;

      obsGetStatus: () => Promise<ObsStatus>;
      obsConnect: (url: string, password: string) => Promise<IpcResult>;
      obsDisconnect: () => Promise<void>;
      obsSwitchScene: (sceneName: string) => Promise<IpcResult>;
      obsGetSceneItems: (sceneName: string) => Promise<ObsSceneItemInfo[]>;
      obsToggleSource: (sceneName: string, sceneItemId: number, enabled: boolean) => Promise<IpcResult>;
      obsStartStream: () => Promise<IpcResult>;
      obsStopStream: () => Promise<IpcResult>;
      obsStartRecord: () => Promise<IpcResult>;
      obsStopRecord: () => Promise<IpcResult>;
      onObsStatus: (cb: (status: ObsStatus) => void) => void;

      meldGetStatus: () => Promise<MeldStatus>;
      meldConnect: (url: string) => Promise<IpcResult>;
      meldDisconnect: () => Promise<void>;
      meldSwitchScene: (sceneId: string) => Promise<IpcResult>;
      meldToggleLayer: (sceneId: string, layerId: string) => Promise<IpcResult>;
      meldSetLayerVisible: (layerId: string, visible: boolean) => Promise<IpcResult>;
      meldStartStream: () => Promise<IpcResult>;
      meldStopStream: () => Promise<IpcResult>;
      meldStartRecord: () => Promise<IpcResult>;
      meldStopRecord: () => Promise<IpcResult>;
      onMeldStatus: (cb: (status: MeldStatus) => void) => void;

      lightsListDevices: () => Promise<LightDeviceConfig[]>;
      lightsListLiveStates: () => Promise<LightState[]>;
      lightsAddWled: (ip: string, name?: string) => Promise<IpcResult & { device?: LightDeviceConfig }>;
      lightsDiscoverWled: () => Promise<WledDiscoveryResult[]>;
      onLightsDiscoverWledProgress: (cb: (p: { scanned: number; total: number }) => void) => void;
      lightsDiscoverGovee: () => Promise<GoveeDiscoveryOutcome>;
      lightsAddGovee: (ip: string, name?: string, sku?: string) => Promise<IpcResult & { device?: LightDeviceConfig }>;
      lightsDiscoverHueBridges: () => Promise<DiscoveredBridge[]>;
      lightsPairHueBridge: (ip: string) => Promise<PairResult>;
      lightsListPairedHueBridges: () => Promise<HueBridgeConfig[]>;
      lightsListHueBridgeLights: (bridgeIp: string) => Promise<{ ok: boolean; error?: string; lights: HueLightInfo[] }>;
      lightsAddHueLight: (bridgeIp: string, hueLightId: string, name: string) => Promise<IpcResult & { device?: LightDeviceConfig }>;
      lightsRemoveDevice: (id: string) => Promise<void>;
      lightsRenameDevice: (id: string, name: string) => Promise<void>;
      lightsSetState: (target: string, patch: { on?: boolean; brightness?: number; color?: string }) => Promise<IpcResult>;

      lightsListScenes: () => Promise<LightScene[]>;
      lightsGetActiveSceneId: () => Promise<string | null>;
      lightsSaveScene: (scene: Partial<LightScene> & { name: string; targets: LightScene['targets'] }) => Promise<LightScene>;
      lightsDeleteScene: (id: string) => Promise<void>;
      lightsSetActiveScene: (id: string) => Promise<IpcResult>;

      lightsListReactions: () => Promise<LightReaction[]>;
      lightsSaveReaction: (reaction: Partial<LightReaction> & { name: string; playMode: LightReactionPlayMode; steps: LightReactionStep[] }) => Promise<LightReaction>;
      lightsDeleteReaction: (id: string) => Promise<void>;
      lightsFireReaction: (id: string) => Promise<IpcResult>;
      lightsStopReaction: (id: string) => Promise<void>;
      lightsListRunningReactions: () => Promise<string[]>;

      voice: {
        getSettings: () => Promise<{
          enabled: boolean; inputDeviceId: string | null; modelSize: VoiceModelSize;
          strictVocabulary: boolean; recognitionWords: string[]; liveCaptionsEnabled: boolean;
        }>;
        setEnabled: (enabled: boolean) => Promise<{ ok: boolean; needsModelDownload?: boolean }>;
        setInputDevice: (deviceId: string | null) => Promise<{ ok: boolean }>;
        setModelSize: (size: VoiceModelSize) => Promise<{ ok: boolean }>;
        setStrictVocabulary: (strict: boolean) => Promise<{ ok: boolean }>;
        setRecognitionWords: (words: string[]) => Promise<{ ok: boolean }>;
        setLiveCaptionsEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
        isModelReady: (size: VoiceModelSize) => Promise<boolean>;
        downloadModel: (size: VoiceModelSize) => Promise<{ ok: boolean; error?: string }>;
        onDownloadProgress: (cb: (pct: number) => void) => void;
        getHeardLog: () => Promise<{ text: string; confidence: number; matchedPhrase: string | null; at: number }[]>;
        getLivePartial: () => Promise<string>;
        getPhrases: () => Promise<VoicePhraseInfo[]>;
      };

      openExternal: (url: string) => Promise<void>;

      getWebviewPreloadUrl: () => Promise<string>;
      browseLocalFileForWebview: () => Promise<string | null>;

      pulseRules: {
        list: () => Promise<any[]>;
        create: (body: Record<string, any>) => Promise<any>;
        update: (id: string, body: Record<string, any>) => Promise<any>;
        remove: (id: string) => Promise<void>;

        listJobs: () => Promise<any[]>;
        skipJob: (id: string) => Promise<void>;
        cancelJob: (id: string) => Promise<void>;

        kickRewards: () => Promise<{ data?: any[]; error?: string }>;
        twitchRewards: () => Promise<{ data?: any[]; error?: string }>;
        pointsRewards: () => Promise<{ data?: any[]; error?: string }>;
        counters: () => Promise<string[]>;
        ttsVoices: () => Promise<any[]>;
        searchCategories: (platform: 'kick' | 'twitch', query: string) => Promise<{ id: string | number; name: string }[]>;
        runAction: (action: Record<string, unknown>) => Promise<{ ok: boolean }>;
      };

      streamInfo: {
        listPresets: () => Promise<any[]>;
        createPreset: (body: Record<string, any>) => Promise<any>;
        deletePreset: (id: string) => Promise<{ ok: boolean }>;
        applyPreset: (id: string) => Promise<{ ok: boolean }>;
      };

      chatBot: {
        listCommands: () => Promise<any[]>;
        createCommand: (body: Record<string, any>) => Promise<any>;
        updateCommand: (id: string, body: Record<string, any>) => Promise<any>;
        deleteCommand: (id: string) => Promise<void>;
        testSendCommand: (body: Record<string, any>) => Promise<any>;

        listCounters: () => Promise<any[]>;
        createCounter: (name: string, value?: number) => Promise<any>;
        adjustCounter: (name: string, patch: { value?: number; delta?: number }) => Promise<any>;
        deleteCounter: (name: string) => Promise<void>;

        getSpamFilter: () => Promise<any>;
        saveSpamFilter: (enabled: boolean, config: Record<string, any>) => Promise<any>;
        getSettings: () => Promise<any>;
        saveSettings: (body: Record<string, any>) => Promise<any>;
      };

      chatAlerts: {
        testSend: (body: Record<string, any>) => Promise<any>;
        testSendLevelUp: () => Promise<any>;
      };

      moderation: {
        pending: () => Promise<any>;
        resolveSongRequest: (id: string, status: 'approved' | 'denied' | 'played') => Promise<any>;
        resolveRedemption: (id: string, status: 'fulfilled' | 'rejected') => Promise<any>;
        approveDonation: (id: string) => Promise<any>;
        dismissDonation: (id: string) => Promise<any>;
        action: (kind: 'timeout' | 'ban' | 'unban', body: Record<string, any>) => Promise<any>;
        getChatSettings: () => Promise<any>;
        setChatMode: (body: Record<string, any>) => Promise<any>;
      };

      chatFeed: {
        getRecent: () => Promise<{ chat: ChatFeedMessage[]; events: EventFeedItem[] }>;
        onMessage: (cb: (msg: ChatFeedMessage) => void) => void;
        onEvent: (cb: (evt: EventFeedItem) => void) => void;
        getViewerInfo: (usernames: string[], platform: 'kick' | 'twitch') => Promise<Record<string, ViewerInfo>>;
        getThreatSettings: () => Promise<{ minThreatLevelToWarn: number }>;
        getKickSubscriberBadges: (slug: string) => Promise<{ badges: { months: number; badge_image?: { src?: string } }[] }>;
      };

      communityBans: {
        list: () => Promise<{ entries: any[]; total: number }>;
        apply: (opts?: { entryIds?: string[] }) => Promise<any>;
        unban: (entryId: string) => Promise<any>;
        unbanAll: () => Promise<any>;
        getSettings: () => Promise<{ minThreatLevelToWarn: number; applyMinDistinctBans: number }>;
        setSettings: (patch: { minThreatLevelToWarn?: number; applyMinDistinctBans?: number }) => Promise<any>;
        getFlags: () => Promise<{ flags: any[] }>;
        addFlag: (body: { username: string; category: string; reason?: string }) => Promise<any>;
        removeFlag: (id: string) => Promise<any>;
        getSquads: () => Promise<{ squads: any[] }>;
        createSquad: (name: string) => Promise<any>;
        joinSquad: (code: string) => Promise<any>;
        leaveSquad: (squadId: string) => Promise<any>;
      };

      // Connections (2026-10-22, native rebuild — direct feedback: "I want
      // the settings and connections page on the desktop app to be actually
      // on the app. Not loading the site.")
      connections: {
        linkKick: () => Promise<{ ok: boolean; error?: string }>;
        linkTwitch: () => Promise<{ ok: boolean; error?: string }>;
        disconnectTwitch: () => Promise<{ ok: boolean }>;

        getYoutubeStatus: () => Promise<{ connected: boolean; channelTitle?: string; avatar?: string | null; secondary?: { channelTitle: string; avatar: string | null } | null }>;
        connectYoutube: (handle: string) => Promise<{ ok: boolean; channelTitle: string; avatar: string | null }>;
        connectYoutubeSecondary: (handle: string) => Promise<{ ok: boolean; channelTitle: string; avatar: string | null }>;
        disconnectYoutube: () => Promise<{ ok: boolean }>;
        disconnectYoutubeSecondary: () => Promise<{ ok: boolean }>;

        getTiktokStatus: () => Promise<{ connected: boolean; username?: string | null }>;
        connectTiktok: (username: string) => Promise<{ ok: boolean; username: string }>;
        disconnectTiktok: () => Promise<{ ok: boolean }>;

        // preferences/setBotPreference removed 2026-10-29 — see api.ts's own
        // comment on BotStatus for why (the official bot became mandatory;
        // this type had drifted out of sync with preload.ts's real runtime
        // object, which no longer has setBotPreference at all).
        getBotStatus: () => Promise<{
          isUltimate: boolean;
          custom: { platform: string; username: string; display_name: string; needs_reauth: boolean }[];
          official: { platform: string; username: string; display_name: string; needs_reauth: boolean }[];
        }>;
        connectBot: (platform: 'kick' | 'twitch') => Promise<{ ok: boolean; error?: string }>;
        disconnectBot: (platform: 'kick' | 'twitch') => Promise<{ ok: boolean }>;

        // Kick web session for Clips (2026-10-29) — see electron/kickWebLogin.ts.
        getKickWebSessionStatus: () => Promise<{ loggedIn: boolean }>;
        openKickWebLogin: () => Promise<{ loggedIn: boolean }>;

        getSubscriptionStatus: () => Promise<{ kick: boolean; twitch: boolean }>;
        subscribeEvents: (platform: 'kick' | 'twitch') => Promise<{ success: boolean }>;
      };

      // !clip / kick_clip_create settings (2026-10-29) — who can use the
      // chat command and what the bot replies.
      clipSettings: {
        get: () => Promise<{
          permission: 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';
          onRequestMessage: string;
          onSuccessMessage: string;
          onFailureMessage: string;
        }>;
        set: (settings: {
          permission: 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';
          onRequestMessage: string;
          onSuccessMessage: string;
          onFailureMessage: string;
        }) => Promise<any>;
      };

      // Settings (2026-10-22, native rebuild) — API key management stays a
      // website link, see electron/api.ts's own comment on why.
      settings: {
        getDiscordSettings: () => Promise<{ webhookUrl: string; enabled: boolean }>;
        saveDiscordSettings: (body: { webhookUrl: string; enabled: boolean }) => Promise<any>;
        testDiscordWebhook: (webhookUrl: string) => Promise<{ ok: boolean }>;
        deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
      };

      updater: {
        getStatus: () => Promise<UpdaterStatus>;
        check: () => Promise<{ ok: boolean; error?: string }>;
        install: () => Promise<void>;
        onStatus: (cb: (status: UpdaterStatus) => void) => void;
      };
    };
  }
}
