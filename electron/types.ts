// electron/types.ts — shapes shared across main/preload/renderer.

export interface JumpscarePayload {
  mediaUrl: string;
  audioUrl?: string;
  duration: number; // seconds
  volume: number;   // 0..1
  // Set when there's no real media AND no real Scene configured yet (a
  // fresh install, or an account that hasn't set Jumpscare Meter up at all)
  // — see main.ts's resolvePayload(). The overlay renders a plain on-brand
  // placeholder instead of trying to play a file that doesn't represent
  // anything the streamer actually configured.
  placeholder?: boolean;
}

export interface LocalMediaItem {
  id: string;
  filePath: string;
  fileName: string;
  addedAt: number;
}

export interface DesktopConfig {
  apiKey: string | null;
  // General-purpose local media library — any file added here gets a
  // stable http://127.0.0.1:<port>/media/<id> URL any widget's own
  // "paste a URL" field (website or embedded) can reference directly.
  localMediaLibrary: LocalMediaItem[];
  obsUrl: string;
  obsPassword: string;
  // Meld Studio (2026-10-25) — "not all users use OBS." Meld's own
  // WebChannel API has no password/auth at all (confirmed from its own
  // docs — trusted-local-network-only by design), so there's no companion
  // meldPassword field the way OBS has one.
  meldUrl: string;
  // Which physical display hosts the always-on overlay window (2026-10-18)
  // — null = always follow whichever display Windows currently calls
  // primary. See electron/overlay-window.ts's own DisplayOption/
  // resolveDisplay for the fallback behavior if this id stops existing.
  overlayDisplayId: number | null;
  // Lights (2026-10-15) — see electron/lights/ for the real provider clients
  // (researched against Lumia Stream's own supported-brands page, per direct
  // request: "look up how lumia handles lights"). Two providers to start,
  // both deliberately chosen for needing NO cloud account at all — just a
  // device/bridge on the same local network: WLED (plain local HTTP JSON,
  // zero auth — the common ESP32/WS2812B DIY-LED-strip firmware) and
  // Philips Hue (a local bridge, one-time physical-button pairing, no login).
  // Each hueBridges entry is paired ONCE (bridgeIp + the local API username
  // Hue's own pairing flow returns); lightDevices is the flat, user-facing
  // list of individually controllable lights — a bridge's own lights are
  // added to this list one at a time after pairing, same model WLED devices
  // already use (each is its own standalone entry, not grouped under a
  // bridge in the UI).
  hueBridges: HueBridgeConfig[];
  lightDevices: LightDeviceConfig[];
  lightScenes: LightScene[];
  activeLightSceneId: string | null; // which Scene is the current baseline — applied on launch, restored after a Reaction ends
  lightReactions: LightReaction[];
  // Voice Commands (2026-10-23) — off by default, real opt-in. inputDeviceId
  // is a browser MediaDeviceInfo.deviceId (picked in the hidden voice
  // listener window's own getUserMedia enumeration) — null = the OS default
  // mic. See electron/voiceCommands.ts.
  voiceEnabled: boolean;
  voiceInputDeviceId: string | null;
  // voiceModelSize — which real Vosk model is in use (electron/voiceModels.ts).
  voiceModelSize: 'small' | 'medium' | 'large' | 'xlarge';
  // voiceStrictVocabulary — "Strict phrase matching" (true, grammar-
  // constrained to your phrases + Recognition Words, much higher accuracy
  // on those, can't make out anything else) vs "Open vocabulary" (false,
  // hears anything, needed for live captions of arbitrary speech).
  voiceStrictVocabulary: boolean;
  // voiceRecognitionWords — extra words/short phrases (names, slang,
  // stream-specific terms) that help recognition accuracy without
  // themselves triggering anything, unless a voice command also happens to
  // be bound to that exact phrase. Only actually biases recognition while
  // voiceStrictVocabulary is on (Vosk's grammar is the only real biasing
  // lever this engine exposes).
  voiceRecognitionWords: string[];
  // voiceLiveCaptionsEnabled — streams recognized text up to the website
  // for the Live Captions OBS widget (routes/pulseRules.js's
  // POST /voice-caption). Off by default — nothing is sent anywhere unless
  // this is explicitly turned on, separate from Voice Commands itself being
  // on.
  voiceLiveCaptionsEnabled: boolean;
}

export type LightProvider = 'wled' | 'hue' | 'govee';

// Light Scenes & Reactions (2026-10-18 v2 — replaces the single "Light
// Presets" concept from earlier the same day). Direct correction: a Scene
// is the STEADY-STATE baseline a streamer's lights sit at (applied once on
// app launch, and RESTORED automatically whenever a Reaction finishes) — a
// Reaction is a TEMPORARY, timed, event-triggered interruption of that
// baseline. These are genuinely different lifecycles (one persists until
// deliberately changed; one plays through and hands control back), not just
// "1 step vs several steps" as the original design treated them — splitting
// them into two real tabs/pages (and two backend modules,
// electron/light-scenes.ts / electron/light-reactions.ts) makes that
// lifecycle difference explicit instead of folding it into a `loop` flag
// with no real "return to normal after" behavior at all. Both still share
// the exact same per-device target shape below (a Scene with different
// colors per device is still what Lumia calls a "Scene"; a single shared
// color across every device is still what Lumia calls a plain "Color" —
// that part of the original research holds, it's just not conflated with
// the Reaction/Animation timing concept anymore).
export interface LightPresetStepTarget {
  on?: boolean;
  brightness?: number; // 0-100
  color?: string;       // hex, no #
  random?: boolean;     // Reactions only — ignore `color`, pick a fresh random color each time this step plays
  // transitionMs (2026-10-18) — direct feedback: "I do not see a transition
  // field" (comparing against Lumia's own Scenes tab). Real, not cosmetic —
  // see lights/wled.ts (`tt`) and lights/hue.ts (`transitiontime`); Govee's
  // real LAN protocol has no equivalent, silently ignored there (see
  // lights-manager.ts's own LightStatePatch comment).
  transitionMs?: number;
}

// A Scene — exactly ONE target-map, no steps, no loop, no duration. The
// "mood" a streamer's lights return to.
export interface LightScene {
  id: string;
  name: string;
  targets: Record<string, LightPresetStepTarget>; // key: a device id, or 'all'
}

// A Reaction — a timed sequence that plays through (once, or looping) and
// then hands control back to whichever Scene is currently active.
export interface LightReactionStep {
  durationMs: number; // how long this step holds before the next one plays; irrelevant/unused when there's only one step
  targets: Record<string, LightPresetStepTarget>;
}
// playMode (2026-10-18 v2 — replaces the original plain `loop: boolean`).
// Direct request: "it would be nice to be able to set reactions to play for
// a set amount of time, instead of just loop until stopped, or play through
// once." 'timed' cycles the steps exactly like 'loop' does, but the
// playback engine auto-stops it (and restores the active Light Scene, same
// as any other end) once durationSeconds elapses, instead of requiring an
// explicit Stop. Only meaningful for a multi-step reaction — same condition
// the loop/once picker itself has always been shown under, since a single
// step has nothing to cycle back to. A legacy saved reaction only ever has
// `loop: boolean` on disk (no `playMode`) — electron/light-reactions.ts's
// listReactions() normalizes that shape on read, so this type describes
// only the current, already-normalized shape the rest of the app sees.
export type LightReactionPlayMode = 'once' | 'loop' | 'timed';
export interface LightReaction {
  id: string;
  name: string;
  playMode: LightReactionPlayMode;
  durationSeconds?: number; // only used/meaningful when playMode === 'timed'
  steps: LightReactionStep[];
  soundUrl?: string;
  soundVolume?: number; // 0-100
}

export interface HueBridgeConfig {
  bridgeIp: string;
  username: string; // the local API token Hue's own pairing flow returns
}

export interface LightDeviceConfig {
  id: string;
  provider: LightProvider;
  name: string;
  // WLED and Govee (2026-10-16) — both plain IP-addressed local devices,
  // same field for either.
  ip?: string;
  // Hue — which bridge (by ip, matched against hueBridges) and which light
  // id on that bridge (Hue's own numeric light id, as a string).
  bridgeIp?: string;
  hueLightId?: string;
}

// Live, queried state for one configured light — never persisted, always
// fetched fresh (or pushed after a real control call) since a light's own
// on/off/brightness/color can change outside this app entirely (someone
// flips it by hand, another app controls it, WLED's own preset cycling).
export interface LightState {
  id: string;
  provider: LightProvider;
  name: string;
  reachable: boolean;
  on: boolean;
  brightness: number; // 0-100
  color: string;       // hex, no #
}

export interface MeResponse {
  userId: string;
  kickBroadcasterId: string | null;
  username: string | null;
  // twitchUsername (2026-10-19) — the real Twitch username, needed to join
  // the Live Chat feed's own Twitch IRC connection (electron/twitch-irc.ts)
  // — `username` above prefers Kick's own name once both are connected, so
  // it can't be reused for this.
  twitchUsername: string | null;
  displayName: string | null;
  profilePicture: string | null;
  kickConnected: boolean;
  twitchConnected: boolean;
  isPremium: boolean;
  isUltimate: boolean;
}

export interface JumpscareConfigResponse {
  configId: string;
  // 'scenes' mode (2026-10-19) — mirrors the website's own Jumpscare Meter
  // mode: the real configured reaction may be a Pulse Scene, not uploaded
  // media at all, in which case mediaUrl is always empty. See
  // routes/desktop.js's own comment on /jumpscare-config for the incident
  // this fixes (the app used to always fall through to a bundled
  // placeholder whenever mediaUrl was empty, regardless of mode).
  mode: 'overlay' | 'scenes';
  targetSceneId: string | null;
  mediaUrl: string;
  audioUrl: string;
  volume: number;
  duration: number;
}

export interface DesktopStatus {
  connected: boolean;
  me: MeResponse | null;
  error?: string;
}

// Auto-update (2026-10-26) — see electron/updater.ts. 'idle' covers both
// "haven't checked yet" and "checked, already on the latest version" —
// the UI has nothing useful to show a user in either case, so they're
// deliberately not split into separate states.
export type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';

export interface UpdaterStatus {
  phase: UpdaterPhase;
  version?: string; // the available/downloaded version, once known
  percent?: number; // 0-100, only meaningful while phase === 'downloading'
  error?: string;
}

export interface ObsSceneInfo {
  sceneName: string;
  sceneUuid: string;
}

export interface ObsSceneItemInfo {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
}

export interface ObsStatus {
  connected: boolean;
  connecting: boolean;
  currentScene: string | null;
  scenes: ObsSceneInfo[];
  error?: string;
  // errorCode (2026-10-16) — obs-websocket's own real numeric close code
  // when connectObs() fails, e.g. 4009 (AuthenticationFailed) — lets the
  // renderer show a specific, actionable message instead of a raw string.
  // See ObsControlPage.tsx's friendlyObsError.
  errorCode?: number;
  // Stream/record state (2026-10-15) — fetched on connect via
  // GetStreamStatus/GetRecordStatus, kept live via the StreamStateChanged/
  // RecordStateChanged events obs-websocket already sends unprompted.
  streaming: boolean;
  recording: boolean;
  streamDurationMs: number;
  recordDurationMs: number;
  // Every (scene, source) pair across every scene (2026-10-16, for the
  // obs_toggle_source Pulse Engine action's own picker — see main.ts's
  // reportObsSources and obs-client.ts's refreshAllSceneItems). Refreshed
  // on connect and whenever a scene or scene-item is added/removed.
  sources: { sceneName: string; sourceName: string }[];
}

// Meld Studio (2026-10-25) — see electron/meld-client.ts's own header for
// the full WebChannel API writeup and what's confirmed vs. inferred.
export interface MeldSceneInfo {
  sceneId: string;
  sceneName: string;
}

export interface MeldLayerInfo {
  sceneId: string;
  layerId: string;
  layerName: string;
  visible: boolean;
}

export interface MeldStatus {
  connected: boolean;
  connecting: boolean;
  currentSceneId: string | null;
  scenes: MeldSceneInfo[];
  layers: MeldLayerInfo[];
  streaming: boolean;
  recording: boolean;
  error?: string;
}

// Threat level + flags for a chatter (2026-10-19) — GET /desktop/viewer-info,
// combines lib/communityBans.js's threat-level count and lib/viewerFlags.js's
// recorded categories into one response for the Live Chat feed's own
// warning badge. threat.level 0 = none; see the website's
// lib/communityBans.js THREAT_TIERS for the real level->label mapping this
// mirrors.
export interface ViewerFlagInfo { category: string; reason: string | null; }
export interface ViewerThreatInfo { level: number; label: string; count: number; }
export interface ViewerInfo { threat: ViewerThreatInfo; flags: ViewerFlagInfo[]; }

export interface MediaServerInfo {
  port: number;
  baseUrl: string;
}

// Scenes (Pulse Scenes, "scenes_configs" on the website) — a full
// text/media/light/shape/fill/counter/container scene composer, fired by a
// Pulse Engine `trigger_scene` action (among other triggers). The main
// process only ever needs to look a scene up by id and hand the whole
// object to the overlay renderer — it has no opinion on what's actually
// inside one, so it stays loosely typed here; the renderer (src/) defines
// its own strict element types (ported from the website's useAlertStudio.ts/
// useScenes.ts) for the JSX that actually draws it.
export interface SceneSummary {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ScenesConfigResponse {
  broadcasterId?: string | null;
  scenes: SceneSummary[];
}

// The resolved "play this scene now" payload sent to the overlay window —
// the full scene object (background/elements/transitions/etc, whatever
// shape the website's own PulseScene type has) plus the {username}/{amount}/
// {message}/{viewers}/{reward} tokens it should substitute, same vocabulary
// Pulse Engine's own bot_message action already uses.
export interface ScenePlayPayload {
  scene: SceneSummary;
  tokens: {
    username?: string;
    amount?: number | string;
    message?: string;
    viewers?: number | string;
    reward?: string;
  };
}
